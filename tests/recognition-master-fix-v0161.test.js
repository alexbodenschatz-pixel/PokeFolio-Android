'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Recognition = require('../app/src/main/assets/recognition-core.js');

test('deutsches Pikachu 049/195 bleibt ein praktisch eindeutiger strukturierter Treffer', () => {
  const hints = Recognition.extractHints({passes: [
    {variant: 'kopfzeile-0', region: 'TOP_HEADER', text: 'Pikachu\nKP 70',
      lines: [{text: 'Pikachu', y: 0.12}, {text: 'KP 70', y: 0.22}]},
    {variant: 'unterkante-0', region: 'BOTTOM_METADATA', text: '049/195',
      lines: [{text: '049/195', y: 0.72}]}
  ]});
  const ranked = Recognition.rankPokemonCandidates([
    {id: 'pikachu-049', tcg: 'pokemon', name: 'Pikachu', number: '49', printedTotal: 195,
      hp: '70', language: 'de'},
    {id: 'pikachu-other', tcg: 'pokemon', name: 'Pikachu', number: '27', printedTotal: 195,
      hp: '70', language: 'de'}
  ], hints, '');
  assert.equal(ranked[0].id, 'pikachu-049');
  assert.ok(ranked[0].identificationScore >= 0.98);
  assert.ok(ranked[0].identificationScore > ranked[1].identificationScore + 0.45);
});

test('asiatische Pokémon-Identität priorisiert Nummer plus Artwork auch ohne lesbaren Namen', () => {
  for (const fixture of [
    {language: 'ja', scriptText: 'ポケモン', number: '198', total: '193', rarity: 'AR'},
    {language: 'zh-CN', scriptText: '宝可梦', number: '151', total: '208', rarity: 'R'}
  ]) {
    const hints = Recognition.extractHints({language: fixture.language, passes: [{
      variant: 'unterkante-metadata-scharf-0', region: 'BOTTOM_METADATA',
      text: `${fixture.number}/${fixture.total} ${fixture.rarity}\n${fixture.scriptText}`,
      lines: [{text: `${fixture.number}/${fixture.total} ${fixture.rarity}`, y: 0.55},
        {text: fixture.scriptText, y: 0.8}]
    }]});
    const base = Recognition.rankPokemonCandidates([
      {id: 'right', tcg: 'pokemon', name: 'Unknown localized card', number: fixture.number,
        printedTotal: Number(fixture.total), language: fixture.language},
      {id: 'wrong', tcg: 'pokemon', name: 'Wrong card', number: '12',
        printedTotal: Number(fixture.total), language: fixture.language}
    ], hints, '');
    const right = Recognition.combineVisualSimilarity(base.find(card => card.id === 'right'), {
      similarity: 0.9, artwork: 0.94, whole: 0.86, header: 0.5, text: 0.4, footer: 0.91,
      reliable: true
    });
    const wrong = Recognition.combineVisualSimilarity(base.find(card => card.id === 'wrong'), {
      similarity: 0.45, artwork: 0.35, whole: 0.42, header: 0.4, text: 0.4, footer: 0.3,
      reliable: true
    });
    assert.ok(right.identificationScore >= 0.9);
    assert.ok(right.identificationScore > wrong.identificationScore + 0.45);
  }
});

test('Yu-Gi-Oh!-Passcode identifiziert Keltischen Wächter auch ohne lesbaren Titel', () => {
  const hints = Recognition.extractHints({passes: [{
    variant: 'unterkante-yugioh-passcode-0', region: 'BOTTOM_METADATA',
    text: 'SDY-G008\n91152256\nATK 1400 DEF 1200', lines: [
      {text: 'SDY-G008', y: 0.2}, {text: '91152256', y: 0.8},
      {text: 'ATK 1400 DEF 1200', y: 0.55}
    ]
  }]});
  hints.yugiohFeatures = Recognition.parseYuGiOhFeatures(hints);
  const ranked = Recognition.rankYuGiOhCandidates([
    {tcg: 'yugioh', id: 91152256, passcode: '91152256', name: 'Keltischer Wächter',
      number: 'SDY-G008', setCodes: ['SDY-G008'], atk: 1400, def: 1200},
    {tcg: 'yugioh', id: 46986414, passcode: '46986414', name: 'Dunkler Magier',
      number: 'SDY-G005', setCodes: ['SDY-G005'], atk: 2500, def: 2100}
  ], hints, '', 7);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 91152256);
  assert.ok(ranked[0].identificationScore >= 0.98);
});

test('Live-Pipeline enthält ausschließlich Kontur, Tracking und messbare Drosselung', () => {
  const root = path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app');
  const camera = fs.readFileSync(path.join(root, 'CameraActivity.java'), 'utf8');
  const detector = fs.readFileSync(path.join(root, 'FastCardDetector.java'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'MainActivity.java'), 'utf8');
  assert.match(camera, /setTargetResolution\(new Size\(480, 640\)\)/);
  assert.match(camera, /STRATEGY_KEEP_ONLY_LATEST/);
  assert.match(camera, /CARD_PERF PreviewFPS=.*DetectionFPS=.*CardDetectorMs=.*TrackingMs=/);
  assert.match(detector, /CardImageProcessor\.analyzePhysicalCard/);
  assert.match(detector, /MOVING_INTERVAL_MS = 66L/);
  assert.match(detector, /STABLE_INTERVAL_MS = 92L/);
  assert.doesNotMatch(camera, /recognizeCard|nativeGet|httpGet|compareCardImage/);
  assert.match(main, /bridgeExecutor\.execute\(\(\) -> startCardRecognition/);
});

test('Post-Capture-Pipeline besitzt Profile, Orientation-first und strukturierte Early Exits', () => {
  const root = path.join(__dirname, '..');
  const processor = fs.readFileSync(path.join(root,
    'app/src/main/java/de/pokefolio/app/CardImageProcessor.java'), 'utf8');
  const main = fs.readFileSync(path.join(root,
    'app/src/main/java/de/pokefolio/app/MainActivity.java'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app/src/main/assets/app.js'), 'utf8');
  assert.match(processor, /createOrientationOcrVariants/);
  assert.match(processor, /createProfileOcrVariants/);
  assert.match(processor, /addYuGiOhMetadataOcrVariants/);
  assert.match(processor, /addOnePieceNameOcrVariants/);
  assert.match(main, /OCR_STAGE orientation_complete/);
  assert.match(app, /EARLY_EXIT TCG=YUGIOH Strategy=PASSCODE/);
  assert.match(app, /EARLY_EXIT TCG=ONE_PIECE Strategy=CARD_CODE/);
  assert.match(app, /hasExactStructuredIdentity/);
  assert.match(app, /RECOGNITION_PERF/);
});
