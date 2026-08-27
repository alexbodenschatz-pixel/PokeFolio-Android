'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Grading = require('../app/src/main/assets/grading-core.js');
const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(assets, 'styles.css'), 'utf8');

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

function visionMetrics(overrides = {}) {
  return {
    ...goodMetrics(),
    centering: {left: 52, right: 48, top: 51, bottom: 49, confidence: 0.9},
    corners: 94,
    edges: 92,
    surface: 91,
    cornerDetails: {
      topLeft: {score: 94, confidence: 0.8}, topRight: {score: 95, confidence: 0.8},
      bottomRight: {score: 92, confidence: 0.82}, bottomLeft: {score: 94, confidence: 0.8}
    },
    edgeDetails: {
      top: {score: 93, confidence: 0.78}, right: {score: 92, confidence: 0.78},
      bottom: {score: 91, confidence: 0.8}, left: {score: 93, confidence: 0.78}
    },
    defects: [],
    preview: 'data:image/jpeg;base64,preview',
    ...overrides
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

test('berechnet gutes und deutlich schlechtes Centering geometrisch statt pauschal', () => {
  assert.ok(Grading.centeringScore({left: 52, right: 48, top: 51, bottom: 49}) >= 93);
  assert.ok(Grading.centeringScore({left: 64, right: 36, top: 58, bottom: 42}) <= 66);
});

test('erstellt nachvollziehbare Gesamt- und Subgrades aus Front und Back', () => {
  const result = Grading.buildAssessment({front: visionMetrics(), back: visionMetrics({surface: 88})});
  assert.ok(result.pregrade >= 8.8);
  assert.deepEqual(Object.keys(result.aggregateSubgrades), ['centering', 'corners', 'edges', 'surface']);
  assert.ok(result.analysisConfidence >= 0.7);
  assert.equal(result.defects.length, 0);
});

test('abgeschnittene Karte wird vor jeder Grade-Ausgabe abgelehnt', () => {
  const quality = Grading.evaluateImageQuality(visionMetrics({cardComplete: false, cropReliable: false}));
  assert.equal(quality.eligible, false);
  assert.ok(quality.reasons.some(reason => reason.includes('vollständig')));
});

test('starke Reflexion senkt Surface-Confidence und erzwingt keine Defektbehauptung', () => {
  const reflected = Grading.buildAssessment({
    front: visionMetrics({reflectionRatio: 0.19}),
    back: visionMetrics({reflectionRatio: 0.18})
  });
  const clear = Grading.buildAssessment({front: visionMetrics(), back: visionMetrics()});
  assert.ok(reflected.categoryConfidence.front.surface < clear.categoryConfidence.front.surface);
  assert.equal(reflected.surfaceAnalysis.front.limited, true);
});

test('Mehrwinkelaufnahmen erhöhen Surface-Sicherheit ohne das Hauptbild zu überschreiben', () => {
  const single = Grading.buildAssessment({front: visionMetrics(), back: visionMetrics()});
  const multi = Grading.buildAssessment({
    front: visionMetrics(), back: visionMetrics(),
    frontAngles: [visionMetrics({surface: 90}), visionMetrics({surface: 89})],
    backAngles: [visionMetrics({surface: 90})]
  });
  assert.ok(multi.surfaceAnalysis.front.confidence > single.surfaceAnalysis.front.confidence);
  assert.equal(multi.surfaceAnalysis.front.framesUsed, 3);
  assert.ok(multi.subscores.front.surface <= 91);
});

test('Corner-, Edge- und Surface-Defekte bleiben lokalisiert und nach Schwere sortiert', () => {
  const result = Grading.buildAssessment({
    front: visionMetrics({defects: [
      {side: 'front', region: 'bottomRight', type: 'CORNER_WEAR', severity: 'HIGH', confidence: 0.91, label: 'Whitening unten rechts', box: {x: .85, y: .85, width: .15, height: .15}},
      {side: 'front', region: 'center', type: 'SURFACE_ANOMALY', severity: 'LOW', confidence: 0.62, label: 'Kratzer im Holo-Bereich', box: {x: .3, y: .3, width: .2, height: .2}}
    ]}),
    back: visionMetrics({defects: [
      {side: 'back', region: 'bottom', type: 'EDGE_WEAR', severity: 'MEDIUM', confidence: 0.78, label: 'Untere Kante auffällig', box: {x: .14, y: .925, width: .72, height: .075}}
    ]})
  });
  assert.equal(result.defects.length, 3);
  assert.equal(result.defects[0].severity, 'HIGH');
  assert.equal(result.defects[0].positioned, true);
});

test('Gesamtgrade wird durch einen schweren Einzelbereich begrenzt', () => {
  const score = Grading.scoreFromSubscores({
    front: {centering: 98, corners: 45, edges: 96, surface: 96},
    back: {centering: 98, corners: 48, edges: 96, surface: 96}
  });
  assert.ok(score <= 620);
});

test('nicht-offizielle PSA-Prognose erscheint nur bei ausreichender Analysequalität', () => {
  assert.equal(Grading.externalGradeForecast(9.2, 0.4), null);
  const forecast = Grading.externalGradeForecast(9.2, 0.9);
  assert.equal(Object.values(forecast.psa).reduce((sum, value) => sum + value, 0), 100);
  assert.match(forecast.disclaimer, /kein offizielles/);
});

test('Schema 2 speichert Aufnahmen, Confidence und Detailregionen getrennt von quantity', () => {
  const original = card({quantity: 5});
  const model = Grading.buildAssessment({front: visionMetrics(), back: visionMetrics()});
  const result = Grading.addRecord(Grading.createState(), original, {
    ...model,
    captures: [
      {type: 'FRONT_STRAIGHT', side: 'front', preview: 'front', qualityScore: .9},
      {type: 'BACK_STRAIGHT', side: 'back', preview: 'back', qualityScore: .9},
      {type: 'FRONT_LEFT', side: 'front', preview: 'angle', qualityScore: .8}
    ]
  });
  assert.equal(Grading.SCHEMA_VERSION, 2);
  assert.equal(result.record.captures.length, 3);
  assert.ok(result.record.analysisConfidence > 0);
  assert.equal(original.quantity, 5);
});

test('Grading-UI besitzt Pflichtseiten, Mehrwinkelaufnahme, Defekt-Overlay und Variantenbestätigung', () => {
  for (const id of ['gradingFront', 'gradingBack', 'gradingFrontLeft', 'gradingFrontRight', 'gradingFrontTop', 'gradingBackAngle', 'gradingVariant']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(app, /Grading\.buildAssessment/);
  assert.match(app, /defect-marker/);
  assert.match(app, /Analysequalität/);
  assert.match(styles, /grading-angle-photos/);
  assert.match(styles, /grading-overlay-card/);
});
