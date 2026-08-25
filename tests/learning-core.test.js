'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Learning = require('../app/src/main/assets/learning-core.js');

const bits = (character = '1') => character.repeat(64);
function fingerprint(overrides = {}) {
  return {
    perceptualHash: bits('1'),
    differenceHash: '10'.repeat(32),
    artworkHash: '1100'.repeat(16),
    histogram: Array.from({length: 16}, (_, index) => index === 7 ? 1 : 0.02),
    layout: Array.from({length: 24}, (_, index) => (index % 7) / 7),
    ...overrides
  };
}

function card(overrides = {}) {
  return {
    id: 'swsh10-134',
    tcg: 'pokemon',
    name: 'Damythir V',
    set: 'Astralglanz',
    setId: 'swsh10',
    number: '134/189',
    language: 'de',
    printingVariant: 'holo',
    ...overrides
  };
}

function outcome(overrides = {}) {
  return {
    eventType: 'CONFIRMED',
    predictedCard: card(),
    confirmedCard: card(),
    confidenceBefore: 0.75,
    confidenceAfter: 0.75,
    source: 'single-save',
    fingerprint: fingerprint(),
    qualityScore: 0.88,
    quality: {sharpness: 0.9, crop: 1},
    ocrFeatures: {name: 'Damythir V', number: '134/189', set: 'swsh10', language: 'de'},
    signalResults: {number: 'match', set: 'match', name: 'match', artwork: 'match'},
    ...overrides
  };
}

const context = {tcg: 'pokemon', setId: 'swsh10', number: '134/189', language: 'de'};

test('lernt erst nach bestätigtem Scan und erhöht beim zweiten ähnlichen Scan sinnvoll die Confidence', () => {
  const learned = Learning.recordOutcome(Learning.createState(), outcome());
  assert.equal(learned.referenceAction, 'ADDED');
  const matches = Learning.findMatches(learned.state, fingerprint(), context);
  const [candidate] = Learning.enrichCandidates(learned.state, [{...card(), confidence: 0.75,
    finalConfidence: 0.75, identificationScore: 0.75}], matches, context);
  assert.equal(matches.referencesChecked, 1);
  assert.ok(candidate.confidence >= 0.9);
  assert.ok(candidate.learnedVisualScore >= 0.95);
});

test('priorisiert eine eindeutige Nutzerkorrektur Gaunux gegenüber der alten Vorhersage Kleptifux', () => {
  const kleptifux = card({id: 'sv1-125', name: 'Kleptifux', setId: 'sv1', set: 'Set 1', number: '125/198'});
  const gaunux = card({id: 'sv1-126', name: 'Gaunux', setId: 'sv1', set: 'Set 1', number: '126/198'});
  const corrected = Learning.recordOutcome(Learning.createState(), outcome({
    eventType: 'CORRECTED', predictedCard: kleptifux, confirmedCard: gaunux,
    ocrFeatures: {name: 'Kleptifux', number: '126/198', set: 'sv1', language: 'de'}
  }));
  const scanContext = {tcg: 'pokemon', setId: 'sv1', number: '126/198', language: 'de'};
  const matches = Learning.findMatches(corrected.state, fingerprint(), scanContext);
  const ranked = Learning.enrichCandidates(corrected.state, [
    {...kleptifux, confidence: 0.79}, {...gaunux, confidence: 0.72}
  ], matches, scanContext);
  assert.equal(ranked[0].name, 'Gaunux');
  assert.ok(ranked[0].correctionConfidence > 0);
  assert.ok(ranked.find(item => item.name === 'Kleptifux').confidence < 0.79);
});

test('begrenzt adaptive Gewichte und lässt eine einzelne falsche Korrektur keine Basisregel zerstören', () => {
  const result = Learning.recordOutcome(Learning.createState(), outcome({
    eventType: 'CORRECTED', signalResults: {number: 'mismatch', name: 'mismatch', artwork: 'match'}
  }));
  Object.values(result.state.adaptiveSignals).forEach(signal => {
    assert.ok(signal.multiplier >= 0.92 && signal.multiplier <= 1.08);
  });
  assert.ok(result.state.adaptiveSignals.number.multiplier > 0.98);
});

test('speichert unscharfe Bestätigung als Ereignis, aber nicht als starke visuelle Referenz', () => {
  const result = Learning.recordOutcome(Learning.createState(), outcome({qualityScore: 0.31}));
  assert.equal(result.referenceAction, 'LOW_QUALITY');
  assert.equal(result.state.events.length, 1);
  assert.equal(result.state.references.length, 0);
});

test('speichert einen sauberen perspektivisch korrigierten Crop als hochwertige Referenz', () => {
  const result = Learning.recordOutcome(Learning.createState(), outcome({qualityScore: 0.94}));
  assert.equal(result.state.references.length, 1);
  assert.equal(result.state.references[0].qualityScore, 0.94);
  assert.equal(result.state.references[0].perceptualHash, bits('1'));
});

test('verhindert nahezu identische doppelte Lernreferenzen', () => {
  const first = Learning.recordOutcome(Learning.createState(), outcome());
  const second = Learning.recordOutcome(first.state, outcome({timestamp: Date.now() + 1000}));
  assert.equal(second.referenceAction, 'SKIPPED_DUPLICATE');
  assert.equal(second.state.references.length, 1);
  assert.equal(second.state.events.length, 2);
});

test('liefert für Bulk nur bei starker lokaler Referenz und passender Nummer einen Fast-Match', () => {
  const learned = Learning.recordOutcome(Learning.createState(), outcome());
  const exact = Learning.findMatches(learned.state, fingerprint(), context);
  const wrongNumber = Learning.findMatches(learned.state, fingerprint(), {...context, number: '135/189'});
  assert.equal(Learning.isFastBulkMatch(exact), true);
  assert.equal(Learning.isFastBulkMatch(wrongNumber), false);
});

test('erzeugt offline einen klar gekennzeichneten lokalen Kandidaten', () => {
  const learned = Learning.recordOutcome(Learning.createState(), outcome());
  const matches = Learning.findMatches(learned.state, fingerprint(), context);
  const [offline] = Learning.offlineCandidates(matches, context);
  assert.equal(offline.name, 'Damythir V');
  assert.equal(offline.offline, true);
  assert.match(offline.source, /offline/);
});

test('nutzt bestätigte japanische Referenzen trotz schwächerer OCR sprachgetrennt', () => {
  const japanese = card({id: 'sv2a-025', name: 'ピカチュウ', setId: 'sv2a', set: 'ポケモンカード151',
    number: '025/165', language: 'ja'});
  const learned = Learning.recordOutcome(Learning.createState(), outcome({
    predictedCard: japanese, confirmedCard: japanese,
    ocrFeatures: {name: '', number: '025/165', set: 'sv2a', language: 'ja'}
  }));
  const matches = Learning.findMatches(learned.state, fingerprint(), {
    tcg: 'pokemon', setId: 'sv2a', number: '025/165', language: 'ja'
  });
  assert.equal(matches.matches[0].card.name, 'ピカチュウ');
});

test('Zurücksetzen betrifft ausschließlich Lernzustand und niemals die Sammlung', () => {
  const collection = [card({quantity: 4})];
  const learned = Learning.recordOutcome(Learning.createState(), outcome()).state;
  assert.equal(learned.references.length, 1);
  const reset = Learning.createState();
  assert.equal(reset.references.length, 0);
  assert.equal(collection[0].quantity, 4);
});

test('lehnt unbestätigte Vorhersagen als Trainingsereignis ab', () => {
  const result = Learning.recordOutcome(Learning.createState(), outcome({eventType: 'PREDICTED'}));
  assert.equal(result.stored, false);
  assert.equal(result.state.references.length, 0);
  assert.equal(result.state.events.length, 0);
});

test('lokale Referenz darf widersprüchliche strukturierte Kartennummer nicht überstimmen', () => {
  const learned = Learning.recordOutcome(Learning.createState(), outcome()).state;
  const matches = Learning.findMatches(learned, fingerprint(), {...context, number: '999/189'});
  assert.equal(matches.matches.length, 0);
});

test('trennt neues Lernen von der Nutzung bereits bestätigter Referenzen', () => {
  const learned = Learning.recordOutcome(Learning.createState(), outcome()).state;
  learned.config.learnFromConfirmed = false;
  const disabled = Learning.recordOutcome(learned, outcome({
    confirmedCard: card({id: 'swsh10-135', number: '135/189'}),
    predictedCard: card({id: 'swsh10-135', number: '135/189'}),
    timestamp: Date.now() + 2000
  }));
  assert.equal(disabled.referenceAction, 'DISABLED');
  assert.equal(disabled.state.references.length, 1);
  assert.equal(Learning.findMatches(disabled.state, fingerprint(), context).matches.length, 1);
});

test('begrenzt unterschiedliche Aufnahmen pro Kartenvariante', () => {
  let state = Learning.createState();
  for (let sample = 0; sample < 12; sample++) {
    const pseudoBits = length => Array.from({length}, (_, index) =>
      ((index * 17 + sample * 29 + Math.floor(index / 3) * sample) % 11) < 5 ? '1' : '0'
    ).join('');
    state = Learning.recordOutcome(state, outcome({
      timestamp: Date.now() + sample * 1000,
      fingerprint: fingerprint({
        perceptualHash: pseudoBits(64),
        differenceHash: pseudoBits(64).split('').reverse().join(''),
        artworkHash: pseudoBits(64).slice(9) + pseudoBits(64).slice(0, 9)
      }),
      qualityScore: 0.7 + sample / 100
    })).state;
  }
  assert.ok(state.references.length <= state.config.maxReferencesPerVariant);
});
