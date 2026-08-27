const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Recognition = require('../app/src/main/assets/recognition-core.js');
const Api = require('../app/src/main/assets/api-core.js');

function ygoHints(rotation = 0) {
  return Recognition.extractHints({passes: [
    {variant: `kopfzeile-${rotation}`, text: 'Keltischer W\u00e4chter',
      lines: [{text: 'Keltischer W\u00e4chter', y: 0.12}]},
    {variant: `untertext-${rotation}`, text: 'SDY-G008\nATK 1400 / DEF 1200',
      lines: [{text: 'SDY-G008', y: 0.65}, {text: 'ATK 1400 / DEF 1200', y: 0.86}]},
    {variant: `unterkante-${rotation}`, text: '91152256', lines: [{text: '91152256', y: 0.82}]}
  ]});
}

function onePieceHints(rotation = 0) {
  return Recognition.extractHints({passes: [
    {variant: `kopfzeile-${rotation}`, text: 'Baby 5', lines: [{text: 'Baby 5', y: 0.1}]},
    {variant: `mitteltext-${rotation}`, text: 'COST 1\nPOWER 1000\nCOUNTER +2000\nCHARACTER',
      lines: [{text: 'COST 1', y: 0.1}, {text: 'POWER 1000', y: 0.2},
        {text: 'COUNTER +2000', y: 0.4}, {text: 'CHARACTER', y: 0.65}]},
    {variant: `unterkante-${rotation}`, text: 'OP04-032', lines: [{text: 'OP04-032', y: 0.8}]}
  ]});
}

test('Yu-Gi-Oh!-Profil liest Keltischer Wächter mit Setcode, Passcode sowie ATK/DEF', () => {
  const hints = ygoHints();
  const parsed = Recognition.parseYuGiOhFeatures(hints);
  assert.equal(Recognition.classifyTcg(hints, 'auto'), 'yugioh');
  assert.equal(parsed.name, 'Keltischer W\u00e4chter');
  assert.equal(parsed.setCode, 'SDY-G008');
  assert.equal(parsed.passcode, '91152256');
  assert.equal(parsed.atk, '1400');
  assert.equal(parsed.def, '1200');
});

test('Yu-Gi-Oh!-Ranking priorisiert exakten Setcode und Passcode und verwirft Widerspruch', () => {
  const hints = ygoHints();
  hints.yugiohFeatures = Recognition.parseYuGiOhFeatures(hints);
  const ranked = Recognition.rankYuGiOhCandidates([
    {tcg: 'yugioh', id: 91152256, name: 'Keltischer W\u00e4chter', number: 'SDY-G008', atk: 1400, def: 1200},
    {tcg: 'yugioh', id: 91152256, name: 'Keltischer W\u00e4chter', number: 'LOB-G005', atk: 1400, def: 1200},
    {tcg: 'yugioh', id: 46986414, name: 'Dunkler Magier', number: 'SDY-G008', atk: 2500, def: 2100}
  ], hints, '', 7);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 91152256);
  assert.ok(ranked[0].confidence >= 0.98);
});

test('One-Piece-Profil liest Baby 5 samt Cardcode und Layoutmerkmalen', () => {
  const hints = onePieceHints();
  const parsed = Recognition.parseOnePieceFeatures(hints);
  assert.equal(Recognition.classifyTcg(hints, 'auto'), 'onepiece');
  assert.equal(parsed.name, 'Baby 5');
  assert.equal(parsed.cardCode, 'OP04-032');
  assert.equal(parsed.cardType, 'CHARACTER');
  assert.equal(parsed.cost, '1');
  assert.equal(parsed.power, '1000');
  assert.equal(parsed.counter, '2000');
});

test('One Piece bleibt bei 0, 90, 180 und 270 Grad dieselbe Kartenidentität', () => {
  [0, 90, 180, 270].forEach(rotation => {
    const hints = onePieceHints(rotation);
    const parsed = Recognition.parseOnePieceFeatures(hints);
    assert.equal(parsed.cardCode, 'OP04-032');
    assert.equal(Recognition.classifyTcg(hints, 'auto'), 'onepiece');
    assert.ok(Recognition.orientationScore('onepiece', hints) >= 8);
  });
});

test('manuelle TCG-Auswahl ist verbindlich und Auto-Modus liefert Wahrscheinlichkeiten', () => {
  const hints = onePieceHints();
  assert.equal(Recognition.classifyTcg(hints, 'pokemon'), 'pokemon');
  const probabilities = Recognition.tcgProbabilities(hints);
  assert.ok(probabilities.onepiece > probabilities.pokemon);
  assert.ok(Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('YGOPRODeck-v7-Builder nutzt nur dokumentierte, nichtleere Parameter', () => {
  const urls = Api.buildYuGiOhUrls({setCode: 'SDY-G008', passcode: '91152256',
    name: 'Keltischer W\u00e4chter'}, '', 'de');
  assert.equal(urls.length, 3);
  assert.match(urls[0], /cardsetsinfo\.php\?setcode=SDY-G008/);
  assert.match(urls[1], /cardinfo\.php\?id=91152256&language=de/);
  assert.match(urls[2], /fname=Keltischer\+W%C3%A4chter.*language=de/);
  urls.forEach(url => assert.doesNotMatch(url, /=(&|$)|undefined|null/));
});

test('ein HTTP 400 der Setcode-Variante blockiert Passcode- und Namensfallback nicht', async () => {
  const urls = Api.buildYuGiOhUrls({setCode: 'SDY-G008', passcode: '91152256',
    name: 'Keltischer W\u00e4chter'}, '', 'de');
  const result = await Api.settleSearchVariants(urls, async url => {
    if (url.includes('cardsetsinfo')) throw Api.createHttpError({url, status: 400, body: '{"error":"not found"}', kind: 'http'});
    return {data: [{id: 91152256}]};
  }, {attempts: 1});
  assert.equal(result.successCount, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.resultCount, 2);
});

test('dynamischer Live-Rahmen analysiert latest-only und glättet vier physische Ecken', () => {
  const root = path.join(__dirname, '..');
  const camera = fs.readFileSync(path.join(root, 'app/src/main/java/de/pokefolio/app/CameraActivity.java'), 'utf8');
  const overlay = fs.readFileSync(path.join(root, 'app/src/main/java/de/pokefolio/app/CardOverlayView.java'), 'utf8');
  const tracker = fs.readFileSync(path.join(root, 'app/src/main/java/de/pokefolio/app/CardDetectionTracker.java'), 'utf8');
  assert.match(camera, /ImageAnalysis\.STRATEGY_KEEP_ONLY_LATEST/);
  assert.match(camera, /\.addUseCase\(imageAnalysis\)/);
  assert.match(camera, /mapPreviewQuadToCrop/);
  assert.match(overlay, /Path polygon/);
  assert.match(tracker, /SMOOTHING_ALPHA/);
  assert.match(tracker, /stability >= 0\.82f/);
});
