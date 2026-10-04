const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../app/src/main/assets/recognition-core');
const Ref = require('../app/src/main/assets/reference-core');

function header(text, index = 0) {
  return {variant: `kopfzeile-${index}-0`, region: 'TOP_HEADER', text,
    lines: text.split('\n').map((text, i) => ({text, y: 0.1 + i * 0.32}))};
}
function hints(title, source, marker = 'Entwickelt sich aus') {
  return R.extractHints({language: 'de', passes: [header(`${title}\n${marker} ${source}`),
    header(`${marker}\n${source}`, 1), header(`${marker}\n${source}`, 2),
    {variant: 'unterkante-idzone-original-0', region: 'BOTTOM_METADATA', text: '074/091',
      lines: [{text: '074/091', y: 0.5}]}]});
}

for (const [title, source] of [['Famieps', 'Zwieps'], ['Raichu', 'Pikachu'], ['Glurak', 'Glutexo'], ['Bisaflor', 'Bisaknosp']]) {
  test(`${title}: wiederholte Evolutionszeilen dürfen ${source} nicht zum Titel machen`, () => {
    for (const marker of ['Entwickelt sich aus', 'Entwickelt sich zu', 'Entwickelt aus', 'Evolves from', 'Evolves into']) {
      const h = hints(title, source, marker);
      assert.equal(h.mainTitle, title, marker);
      assert.ok(!h.nameHints.some(item => item.value === source), marker);
    }
  });
}

test('zusammengeführte Titel-/Evolutionszeile behält Famieps', () => {
  const h = R.extractHints({passes: [header('Famieps KP 90 Entwickelt sich aus Zwieps'), header('Zwieps', 1)]});
  assert.equal(h.mainTitle, 'Famieps');
  assert.ok(!h.nameHints.some(item => item.value === 'Zwieps'));
});

test('über drei OCR-Zeilen umbrochener Evolutionshinweis wird ausgeschlossen', () => {
  const h = R.extractHints({passes: [header('Famieps\nEntwickelt sich\naus Zwieps'), header('Zwieps', 1)]});
  assert.equal(h.mainTitle, 'Famieps');
  assert.ok(!h.nameHints.some(item => item.value === 'Zwieps'));
});

test('falsche Spezies gewinnt nicht durch passende Nummer oder starkes Artwork', () => {
  const h = hints('Famieps', 'Zwieps');
  const cards = [
    {id: 'wrong', tcg: 'pokemon', name: 'Zwieps', number: '074', setId: 'test', language: 'de'},
    {id: 'right', tcg: 'pokemon', name: 'Famieps', number: '074', setId: 'test', language: 'de'}
  ];
  const ranked = R.rankPokemonCandidates(cards, h);
  assert.equal(ranked[0].name, 'Famieps');
  const wrong = R.combineVisualSimilarity(R.rankPokemonCandidates([cards[0]], h)[0], {similarity: 0.99, artwork: 0.99, reliable: true});
  assert.equal(R.confidenceDecision([wrong]).autoAccept, false);
  assert.deepEqual(R.prefilterPokemonCandidates(cards, h).map(c => c.id), ['right']);
});

test('Collector kommt aus Footer; KP, Schaden, Pokédex, Jahr und nackte 13 sind keine ID', () => {
  for (const text of ['13', 'KP 130', 'Schaden 123/198', 'HP 120/198', 'Pokédex Nr. 13', '2025', '1995/2025']) {
    const h = R.extractHints({passes: [{variant: 'unterkante-idzone-original-0', region: 'BOTTOM_METADATA', text,
      lines: [{text, y: 0.5}]}]});
    assert.equal(h.collectorNumbers.length, 0, text);
  }
  for (const text of ['123/198', '013/091', 'TG01/TG30', 'SV001/SV122']) {
    assert.ok(R.parsePokemonCollectorText(text, {y: 0.9}), text);
    assert.equal(R.parsePokemonCollectorText(text, {y: 0.55}), null, text);
  }
});

test('Referenzbild in der Oberfläche versucht Alternative und zeigt erst danach Platzhalter', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../app/src/main/assets/app.js'), 'utf8');
  const ctx = vm.createContext({window: {}, recognitionRun: 1, candidates: [], displayedRecognitionHints: null});
  vm.runInContext(source.slice(source.indexOf('window.candidateImageFailed ='), source.indexOf('window.openCandidateImage =')), ctx);
  let placeholder = false;
  const image = {hidden: false, dataset: {scanId: '1', referenceUrls: '["https://example.com/high.webp"]'},
    parentElement: {querySelector: () => ({classList: {add: () => { placeholder = true; }}})}};
  ctx.window.candidateImageFailed(image);
  assert.equal(image.src, 'https://example.com/high.webp');
  assert.equal(image.hidden, false);
  ctx.window.candidateImageFailed(image);
  assert.equal(image.hidden, true);
  assert.equal(placeholder, true);
  assert.match(source, /candidateFocusIndex === 0 && confident \? 'Bester Treffer'/);
  assert.match(source, /Keine sichere Zuordnung – bitte Treffer auswählen oder erneut scannen/);
});

test('55 Prozent bleiben auch bei einzelnen starken Teilmerkmalen unsicher', () => {
  const result = R.confidenceDecision([{tcg: 'pokemon', identificationScore: 0.55,
    matchDetails: {name: 1, collector: 'match', artwork: 0.99}}]);
  assert.equal(result.identityConfirmed, false);
  assert.equal(result.autoAccept, false);
  assert.equal(result.status, 'candidates');
});

test('Ranking dedupliziert Karten-IDs, behält unterschiedliche Sets und Bilder', () => {
  const h = hints('Famieps', 'Zwieps');
  const card = {id: 'set-074', name: 'Famieps', number: '074', setId: 'set', language: 'de'};
  const ranked = R.rankPokemonCandidates([card, {...card, imageSmall: 'https://example.com/card.webp'},
    {...card, id: 'other-074', setId: 'other'}], h);
  assert.equal(ranked.length, 2);
  assert.ok(ranked.find(c => c.setId === 'set').imageSmall);
});

test('Referenzvergleich verwendet Ersatzauflösung bei Bildfehler, genau einmal pro URL', async () => {
  const calls = [];
  const result = await Ref.compareWithFallback({imageSmall: 'https://example.com/low.webp', imageLarge: 'https://example.com/high.webp'}, async url => {
    calls.push(url);
    if (url.includes('low')) throw Error('HTTP 404');
    return {similarity: 0.91};
  });
  assert.equal(calls.length, 2);
  assert.equal(result.similarity, 0.91);
  await assert.rejects(Ref.compareWithFallback({imageSmall: calls[0], imageLarge: calls[0]}, async () => {throw Error('offline');}), /offline/);
});
