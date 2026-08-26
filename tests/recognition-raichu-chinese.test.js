const test = require('node:test');
const assert = require('node:assert/strict');
const recognition = require('../app/src/main/assets/recognition-core.js');
const learning = require('../app/src/main/assets/learning-core.js');

test('akzeptiert keine beliebige Einzelzahl als Collector Number', () => {
  for (const value of ['3', '90', '120', '150', '230']) {
    assert.equal(recognition.parsePokemonCollectorText(value, {simpleInput: true}), null);
    assert.equal(recognition.extractHints(value).collectorNumbers.length, 0);
  }
  assert.deepEqual(
    recognition.parsePokemonCollectorText('151/208', {simpleInput: true}),
    {number: '151', total: '208', prefix: ''}
  );
  assert.deepEqual(
    recognition.parsePokemonCollectorText('055/159 R', {simpleInput: true}),
    {number: '55', total: '159', prefix: ''}
  );
});

test('liest chinesische Footer-Metadaten per Consensus und verwendet HP nie als Titel', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0', region: 'WHOLE_CARD',
      text: 'HP 150\n\u96f7\u4e18',
      lines: [{text: 'HP 150', y: 0.08}, {text: '\u96f7\u4e18', y: 0.12}]
    },
    {
      variant: 'unterkante-metadata-normal-0', region: 'BOTTOM_METADATA',
      text: '151/2O8 R', lines: [{text: '151/2O8 R', y: 0.5}]
    },
    {
      variant: 'unterkante-metadata-scharf-0', region: 'BOTTOM_METADATA',
      text: '151/208 R', lines: [{text: '151/208 R', y: 0.5}]
    }
  ]});

  assert.equal(hints.script, 'Chinese');
  assert.equal(hints.language, 'zh-CN');
  assert.equal(hints.cardType, 'pokemon');
  assert.equal(hints.mainTitle, '');
  assert.equal(hints.hp, '150');
  assert.equal(hints.collectorNumbers[0].number, '151');
  assert.equal(hints.collectorNumbers[0].total, '208');
  assert.equal(hints.rarity, 'R');
});

test('stellt Raichu trotz eines einzelnen OCR-Glyphenfehlers über Kopfzeilen-Consensus her', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'kopfzeile-normal-0', region: 'TOP_HEADER', text: 'Roichu\nKP 120',
      lines: [{text: 'Roichu', y: 0.12}, {text: 'KP 120', y: 0.3}]
    },
    {
      variant: 'kopfzeile-kontrast-0', region: 'TOP_HEADER', text: 'Roichu\nKP 120',
      lines: [{text: 'Roichu', y: 0.12}, {text: 'KP 120', y: 0.3}]
    }
  ]});

  assert.equal(hints.pokemonIdentity.baseName, 'Raichu');
  assert.equal(hints.mainTitle, 'Raichu');
  assert.equal(hints.pokemonIdentity.reliable, true);
});

test('behält OCR-Merkmale bei manueller Eingabe und markiert Raichu nur als USER_HINT', () => {
  const original = recognition.extractHints('KP 120\n055/159');
  const hinted = recognition.withManualTitleHint(original, 'Raichu');

  assert.equal(hinted.mainTitle, '');
  assert.equal(hinted.manualTitleHint, 'Raichu');
  assert.equal(hinted.manualTitleSource, 'USER_HINT');
  assert.equal(hinted.collectorNumbers[0].number, '55');
  assert.equal(hinted.hp, '120');

  const ranked = recognition.rankPokemonCandidates([
    {id: 'right', tcg: 'pokemon', name: 'Raichu', number: '55', printedTotal: 159, hp: '120', setId: 'set-a'},
    {id: 'wrong-set', tcg: 'pokemon', name: 'Raichu', number: '19', printedTotal: 159, hp: '120', setId: 'set-b'},
    {id: 'wrong-hp', tcg: 'pokemon', name: 'Raichu', number: '7', printedTotal: 100, hp: '90', setId: 'set-c'}
  ], hinted, 'Raichu');

  assert.equal(ranked[0].id, 'right');
  assert.equal(ranked[0].matchDetails.nameSource, 'USER_HINT');
  assert.equal(ranked[0].matchDetails.collector, 'match');
  assert.ok(ranked[0].identificationScore > ranked[1].identificationScore + 0.3);
});

test('trennt gleichnamige Raichu-Karten über kandidatenspezifisches Artwork und Layout', () => {
  const hints = recognition.withManualTitleHint(recognition.extractHints('KP 120'), 'Raichu');
  const base = recognition.rankPokemonCandidates([
    {id: 'matching-art', tcg: 'pokemon', name: 'Raichu', number: '10', setId: 'set-a', hp: '120'},
    {id: 'wrong-art', tcg: 'pokemon', name: 'Raichu', number: '20', setId: 'set-b', hp: '120'}
  ], hints, 'Raichu', 10);
  const scored = [
    recognition.combineVisualSimilarity(base.find(card => card.id === 'matching-art'), {
      similarity: 0.91, artwork: 0.94, whole: 0.88, header: 0.86, text: 0.80, footer: 0.82, layout: 0.90,
      reliable: true
    }),
    recognition.combineVisualSimilarity(base.find(card => card.id === 'wrong-art'), {
      similarity: 0.48, artwork: 0.31, whole: 0.45, header: 0.62, text: 0.50, footer: 0.44, layout: 0.43,
      reliable: true
    })
  ].sort((left, right) => recognition.visualCandidatePriority(right) - recognition.visualCandidatePriority(left));

  assert.equal(scored[0].id, 'matching-art');
  assert.ok(scored[0].identificationScore >= 0.84);
  assert.ok(scored[0].identificationScore > scored[1].identificationScore + 0.35);
  assert.notEqual(scored[0].confidence, scored[1].confidence);
});

test('dedupliziert Karten nur bei gleicher Set-, Nummer-, Sprach- und Variantenidentität', () => {
  const cards = recognition.deduplicateCandidates([
    {id: 'api', tcg: 'pokemon', name: 'Raichu', setId: 'sv1', number: '55', language: 'de', variant: 'normal'},
    {id: 'tcgdex', tcg: 'pokemon', name: 'Raichu', setId: 'sv1', number: '055', language: 'de', variant: 'normal', imageSmall: 'de.jpg'},
    {id: 'reverse', tcg: 'pokemon', name: 'Raichu', setId: 'sv1', number: '55', language: 'de', variant: 'reverse-holo'},
    {id: 'english', tcg: 'pokemon', name: 'Raichu', setId: 'sv1', number: '55', language: 'en', variant: 'normal'}
  ]);
  assert.equal(cards.length, 3);
  assert.ok(cards.some(card => card.imageSmall === 'de.jpg'));
});

test('speichert eine manuell bestätigte Karte als USER_CORRECTION mit Hinweismerkmalen', () => {
  const result = learning.recordOutcome(learning.createState(), {
    eventType: 'CORRECTED',
    correctionReason: 'USER_HINT_CONFIRMED',
    confirmedCard: {id: 'raichu-a', tcg: 'pokemon', name: 'Raichu', setId: 'sv1', number: '55', language: 'de'},
    ocrFeatures: {name: '', manualTitleHint: 'Raichu', manualTitleSource: 'USER_HINT', number: '', language: 'de'},
    fingerprint: {perceptualHash: '0000', differenceHash: '0000', artworkHash: '0000', histogram: [1], layout: [1]},
    qualityScore: 0.8
  });
  assert.equal(result.event.learningEventType, 'USER_CORRECTION');
  assert.equal(result.event.ocrFeatures.manualTitleHint, 'Raichu');
  assert.equal(result.event.ocrFeatures.manualTitleSource, 'USER_HINT');
});
