'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Grading = require('../app/src/main/assets/grading-core.js');
const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');

function card(overrides = {}) {
  return {
    id: 7,
    collectionKey: 'pokemon|swsh10|134189|de|holo',
    tcg: 'pokemon',
    name: 'Damythir V',
    set: 'Astralglanz',
    setId: 'swsh10',
    number: '134/189',
    language: 'de',
    printingVariant: 'holo',
    quantity: 1,
    ...overrides
  };
}

function goodMetrics(overrides = {}) {
  return {
    originalWidth: 1000,
    originalHeight: 1400,
    sharpness: 84,
    quality: 86,
    mean: 132,
    reflectionRatio: 0.02,
    shadowRatio: 0.03,
    cropReliable: true,
    cardComplete: true,
    perspectiveConfidence: 0.91,
    ...overrides
  };
}

function assessment(specimenIndex = 1, changes = {}) {
  return {
    specimenIndex,
    subscores: {
      front: {centering: 92, corners: 90, edges: 88, surface: 86},
      back: {centering: 91, corners: 89, edges: 87, surface: 85}
    },
    authenticity: {status: 'INCONCLUSIVE', confidence: 0},
    quality: {front: Grading.evaluateImageQuality(goodMetrics()), back: Grading.evaluateImageQuality(goodMetrics())},
    ...changes
  };
}

test('normaler Kartenscan identifiziert nur über die Vorderseite und bietet bewusste Folgeaktionen', () => {
  assert.match(index, /id="front"/);
  assert.doesNotMatch(index, /id="back"/);
  assert.match(index, /id="saveIdentifiedCard"/);
  assert.match(index, /id="inspectIdentifiedCard"/);
  assert.match(index, /id="gradeIdentifiedCard"/);
  assert.doesNotMatch(index, /id="analyze"/);
});

test('bestätigte Identifikation kann zur Sammlung gespeichert werden ohne GradingRecord', () => {
  const block = app.match(/\$\('#saveIdentifiedCard'\)\.onclick[\s\S]*?\n};/)[0];
  assert.match(block, /Collection\.upsertCollection/);
  assert.match(block, /persistCollection/);
  assert.doesNotMatch(block, /Grading\.addRecord|persistGradingState/);
});

test('Nur prüfen verwirft den Scan ohne Sammlung oder Grading zu speichern', () => {
  const block = app.match(/\$\('#inspectIdentifiedCard'\)\.onclick[\s\S]*?\n};/)[0];
  assert.match(block, /recordScanHistory\('CHECKED'/);
  assert.match(block, /reset\(\)/);
  assert.doesNotMatch(block, /persistCollection|persistGradingState|Grading\.addRecord/);
});

test('Grading startet nach Identifikation mit übernommener Kartenidentität und Vorderseite', () => {
  assert.match(app, /startGradingWithCard\(entry, \{[\s\S]*source: 'scan'/);
  assert.match(app, /frontDataUrl: previewUrls\.get\('front'\)/);
  assert.match(app, /Identifizierte Karte/);
});

test('Grading aus Sammlung übernimmt Identität ohne erneute OCR', () => {
  assert.match(app, /window\.selectGradingCard/);
  assert.match(app, /startGradingWithCard\(card, \{source: 'collection'\}\)/);
  assert.doesNotMatch(app, /selectGradingCard[\s\S]{0,500}nativeOcr/);
});

test('Bulk-Scan bleibt ohne Front-Back-Grading und verwendet weiter Quantity', () => {
  const bulk = index.match(/<div id="bulkScanPanel"[\s\S]*?<section id="collection"/)[0];
  assert.doesNotMatch(bulk, /gradingBack|PokéFolio Vorgrading starten/);
  assert.match(app, /Collection\.upsertCollection\(loadCollection\(\), entry\)/);
});

test('eine Karte mit quantity 5 und einem Grading behält quantity 5', () => {
  const original = card({quantity: 5});
  const result = Grading.addRecord(Grading.createState(), original, assessment(1));
  assert.equal(original.quantity, 5);
  assert.equal(result.record.specimenIndex, 1);
  assert.equal(result.state.records.length, 1);
  assert.equal(Grading.gradedSpecimenCount(result.state, original), 1);
});

test('ein zweites physisches Exemplar erzeugt getrennten Historieneintrag', () => {
  const original = card({quantity: 5});
  const first = Grading.addRecord(Grading.createState(), original, assessment(1));
  const second = Grading.addRecord(first.state, original, assessment(2));
  assert.equal(second.state.records.length, 2);
  assert.deepEqual(new Set(second.state.records.map(item => item.specimenIndex)), new Set([1, 2]));
  assert.equal(Grading.gradedSpecimenCount(second.state, original), 2);
});

test('ungeeignete Aufnahme wird durch die Qualitätsprüfung abgelehnt', () => {
  const quality = Grading.evaluateImageQuality(goodMetrics({sharpness: 49, reflectionRatio: 0.3}));
  assert.equal(quality.eligible, false);
  assert.ok(quality.reasons.includes('Aufnahme zu unscharf'));
  assert.ok(quality.reasons.includes('Zu starke Reflexion'));
});

test('nur eine Seite reicht für den Grading-Flow ausdrücklich nicht aus', () => {
  assert.match(app, /const backAvailable = Boolean\(\$\('#gradingBack'\)\.files\[0\]\)/);
  assert.match(app, /if \(!frontAvailable \|\| !backAvailable\)/);
  assert.match(app, /Beide Seiten erforderlich/);
});

test('geeignete Vorder- und Rückseite ergeben alle acht Zustandskategorien', () => {
  const normalized = Grading.normalizeSubscores(assessment().subscores);
  assert.deepEqual(Object.keys(normalized), ['front', 'back']);
  assert.deepEqual(Object.keys(normalized.front), ['centering', 'corners', 'edges', 'surface']);
  assert.deepEqual(Object.keys(normalized.back), ['centering', 'corners', 'edges', 'surface']);
  assert.equal(Grading.evaluateImageQuality(goodMetrics()).eligible, true);
  assert.ok(Grading.scoreFromSubscores(normalized) > 800);
});

test('Echtheits-Screening bleibt separat und standardmäßig nicht eindeutig', () => {
  const result = Grading.addRecord(Grading.createState(), card(), assessment());
  assert.equal(result.record.authenticity.status, 'INCONCLUSIVE');
  assert.equal(result.record.authenticity.confidence, 0);
  assert.match(index, /Zustand &amp; Echtheits-Screening/);
  assert.match(app, /Echtheits-Screening · separat vom Zustand/);
});

test('mehrere Gradings derselben Karte bleiben als unabhängige Historie erhalten', () => {
  let state = Grading.createState();
  state = Grading.addRecord(state, card(), assessment(1, {createdAt: '2026-08-20T10:00:00Z'})).state;
  state = Grading.addRecord(state, card(), assessment(1, {createdAt: '2026-08-21T10:00:00Z'})).state;
  const records = Grading.recordsForCard(state, card());
  assert.equal(records.length, 2);
  assert.equal(records[0].createdAt, '2026-08-21T10:00:00Z');
});

test('Legacy-Pregrades migrieren separat und Sammlung sowie quantity bleiben unverändert', () => {
  const collection = [card({quantity: 3, specimens: [{
    id: 'old-copy',
    grade: 'NM',
    score: 870,
    front: {centering: 90, corners: 86, edges: 87, surface: 85},
    back: {centering: 88, corners: 85, edges: 86, surface: 84}
  }]})];
  const migration = Grading.migrateLegacyCollection(null, collection);
  assert.equal(migration.migratedCount, 1);
  assert.equal(migration.state.records.length, 1);
  assert.equal(migration.state.records[0].source, 'LEGACY_MIGRATION');
  assert.equal(collection[0].quantity, 3);
  assert.equal(collection[0].specimens.length, 1);
  const repeated = Grading.migrateLegacyCollection(migration.state, collection);
  assert.equal(repeated.migratedCount, 0);
  assert.equal(repeated.state.records.length, 1);
});
