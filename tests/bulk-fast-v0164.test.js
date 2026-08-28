'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'app', 'src', 'main', 'assets');
const Bulk = require(path.join(assets, 'bulk-fast-core.js'));
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(assets, 'styles.css'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app', 'MainActivity.java'), 'utf8');
const processor = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app', 'CardImageProcessor.java'), 'utf8');

function pokemonHints(number = '040', total = '086', setId = 'M3') {
  return {
    collectorNumbers: [{number, total, votes: 2.2}],
    pokemonSetCodes: setId ? [{value: setId, votes: 1.5}] : []
  };
}

function card(name, number, total, setId, tcg = 'pokemon') {
  return {tcg, id: `${setId}-${number}`, name, number, printedTotal: total,
    setId, set: setId, language: 'de', printingVariant: 'unknown'};
}

test('BULK_FAST besitzt TCG-spezifische Primary Identifier', () => {
  assert.equal(Bulk.RecognitionMode.BULK_FAST, 'BULK_FAST');
  assert.deepEqual(Bulk.primaryIdentifier('pokemon', pokemonHints()), {
    tcg: 'pokemon', type: 'SET_COLLECTOR', value: '40/86', setId: 'M3',
    key: 'pokemon|M3|40/86', exact: true
  });
  assert.equal(Bulk.primaryIdentifier('yugioh', {
    rawText: 'SDY-G008 91152256', yugiohFeatures: {passcode: '91152256', setCode: 'SDY-G008'}
  }).key, 'yugioh|91152256');
  assert.equal(Bulk.primaryIdentifier('onepiece', {
    rawText: 'OP04-032', onePieceFeatures: {cardCode: 'OP04-032'}
  }).key, 'onepiece|OP04032');
});

test('exakte Nummer trennt gleichnamige Prints und erlaubt Early Exit', () => {
  const identifier = Bulk.primaryIdentifier('pokemon', pokemonHints('040', '086', 'M3'));
  const irrbis = card('Irrbis', '040', '086', 'M3');
  const otherSet = card('Irrbis', '040', '086', 'XY1');
  assert.equal(Bulk.isExactCandidate(identifier, irrbis), true);
  assert.equal(Bulk.isExactCandidate(identifier, otherSet), false);
  assert.equal(Bulk.uniqueExactCandidate(identifier, [irrbis, otherSet]).id, irrbis.id);
});

test('Session- und Local-Cache liefern dieselbe Karte ohne neue API-Abfrage', () => {
  const identifier = Bulk.primaryIdentifier('pokemon', pokemonHints());
  const irrbis = card('Irrbis', '040', '086', 'M3');
  const session = Bulk.createSession();
  const local = Bulk.loadLocalCache('');
  Bulk.sessionPut(session, identifier, irrbis);
  Bulk.localPut(local, identifier, irrbis, 42);
  assert.equal(Bulk.sessionGet(session, identifier).name, 'Irrbis');
  assert.equal(Bulk.localGet(Bulk.loadLocalCache(Bulk.serializeLocalCache(local)), identifier).name, 'Irrbis');
});

test('A → B → A zählt drei Scans, zwei Identitäten und drei Mengenänderungen', () => {
  const session = Bulk.createSession();
  Bulk.beginScan(session);
  Bulk.recordAccepted(session, 'pokemon|m3|040|de|unknown', true);
  Bulk.beginScan(session);
  Bulk.recordAccepted(session, 'pokemon|m3|041|de|unknown', true);
  Bulk.beginScan(session);
  Bulk.recordAccepted(session, 'pokemon|m3|040|de|unknown', true);
  assert.deepEqual(session.stats, {scanned: 3, uniqueCards: 2, quantityAdded: 3,
    automatic: 3, manual: 0, uncertain: 0, failed: 0});
});

test('fehlgeschlagene und unsichere Aufnahmen bleiben in der Scan-Statistik sichtbar', () => {
  const session = Bulk.createSession();
  Bulk.beginScan(session);
  Bulk.recordFailed(session);
  Bulk.beginScan(session);
  Bulk.recordUncertain(session);
  assert.equal(session.stats.scanned, 2);
  assert.equal(session.stats.failed, 1);
  assert.equal(session.stats.uncertain, 1);
  assert.equal(session.stats.quantityAdded, 0);
});

test('100 simulierte Cache-Scans bleiben begrenzt und messbar schnell', () => {
  const session = Bulk.createSession();
  const identifier = Bulk.primaryIdentifier('pokemon', pokemonHints());
  Bulk.sessionPut(session, identifier, card('Irrbis', '040', '086', 'M3'));
  const startedAt = performance.now();
  for (let index = 0; index < 100; index++) {
    assert.equal(Bulk.sessionGet(session, identifier).name, 'Irrbis');
    Bulk.beginScan(session);
    Bulk.recordAccepted(session, 'pokemon|m3|040|de|unknown', true);
  }
  const elapsedMs = performance.now() - startedAt;
  console.log(`[BULK_FAST_TEST] 100 session-cache scans=${elapsedMs.toFixed(3)}ms average=${(elapsedMs / 100).toFixed(4)}ms`);
  assert.equal(session.stats.scanned, 100);
  assert.ok(elapsedMs < 100, `Der reine Cache-Pfad war mit ${elapsedMs.toFixed(2)} ms unerwartet langsam.`);
});

test('persistenter Cache begrenzt seinen Speicher auf die festgelegte Maximalgröße', () => {
  const local = Bulk.loadLocalCache('');
  for (let index = 0; index < Bulk.MAX_LOCAL_IDENTITIES + 30; index++) {
    const identifier = {tcg: 'onepiece', type: 'CARD_CODE', value: `OP01-${index}`,
      setId: 'OP01', key: `onepiece|OP01${index}`, exact: true};
    Bulk.localPut(local, identifier, {tcg: 'onepiece', id: String(index), name: `Karte ${index}`,
      number: identifier.value}, index + 1);
  }
  assert.equal(local.byKey.size, Bulk.MAX_LOCAL_IDENTITIES);
  assert.equal(local.byKey.has('onepiece|OP010'), false);
});

test('native BULK_FAST-OCR liest nur Identifier-ROIs und bleibt vom FULL-Modus getrennt', () => {
  assert.match(activity, /recognizeBulkIdentifier/);
  assert.match(activity, /identifierOnly\s*\?\s*CardImageProcessor\.createBulkIdentifierOcrVariants/);
  assert.match(activity, /"BULK_FAST"\.equals\(recognitionMode\)/);
  assert.match(processor, /createBulkIdentifierOcrVariants/);
  assert.match(processor, /addCollectorOcrVariants/);
  assert.match(processor, /addYuGiOhMetadataOcrVariants/);
  assert.match(processor, /addOnePieceMetadataOcrVariants/);
  const method = processor.slice(processor.indexOf('createBulkIdentifierOcrVariants'),
    processor.indexOf('createProfileOcrVariants', processor.indexOf('createBulkIdentifierOcrVariants')));
  assert.doesNotMatch(method, /addHeaderOcrVariants|addBodyOcrVariants/);
});

test('Bulk-Pipeline macht Cache/API-Early-Exit vor Full OCR und Artwork-Fallback', () => {
  const start = app.indexOf('async function runBulkRecognition');
  const end = app.indexOf('window.startBulkCamera', start);
  const flow = app.slice(start, end);
  const identifier = flow.indexOf('nativeBulkIdentifierOcr');
  const cache = flow.indexOf('findBulkCachedIdentity', identifier);
  const exactApi = flow.indexOf('exactBulkApiLookup', cache);
  const fullOcr = flow.indexOf('recognizeCardFeatures', exactApi);
  const artwork = flow.indexOf('enrichWithVisualSimilarity', fullOcr);
  assert.ok(identifier >= 0 && cache > identifier && exactApi > cache && fullOcr > exactApi && artwork > fullOcr);
  assert.match(flow, /commitBulkCandidate\(cached\.candidate[\s\S]*return;/);
  assert.match(flow, /commitBulkCandidate\(exact\.candidate[\s\S]*return;/);
  assert.match(app, /allowEmpty: true/);
  assert.match(flow, /FULL_OCR_EMPTY local-learning-and-visual-fallback-continue/);
});

test('Collection-Write blockiert weder auf Preis noch auf eine unbekannte Variante', () => {
  const commitStart = app.indexOf('function commitBulkCandidate');
  const commitEnd = app.indexOf('window.selectBulkCandidate', commitStart);
  const commit = app.slice(commitStart, commitEnd);
  assert.match(commit, /Collection\.upsertCollection/);
  assert.match(commit, /scheduleBulkMetadataRefresh/);
  assert.ok(commit.indexOf('Collection.upsertCollection') < commit.indexOf('scheduleBulkMetadataRefresh'));
  assert.doesNotMatch(commit, /renderBulkVariantSelector/);
  assert.match(commit, /Variante später in der Sammlung korrigierbar/);
  assert.doesNotMatch(commit, /Centering|Corners|Edges|Surface|PSA/);
});

test('Post-Capture-UI zeigt nur normalizedCardImage ohne Live-Guide', () => {
  const cameraStart = index.indexOf('id="bulkCameraButton"');
  const resultStart = index.indexOf('id="bulkCapturedResult"');
  assert.ok(cameraStart >= 0 && resultStart > cameraStart);
  const live = index.slice(cameraStart, resultStart);
  const result = index.slice(resultStart, index.indexOf('</section>', resultStart));
  assert.match(live, /bulk-card-frame/);
  assert.doesNotMatch(result, /bulk-card-frame|bulk-camera-shade|Live-Kamera/);
  assert.match(result, /id="bulkPreview"/);
  assert.match(styles, /\.bulk-result-image img\{[^}]*object-fit:contain[^}]*object-position:center/);
  assert.match(app, /bulkScanPanel'\)\.classList\.add\('has-capture'\)/);
  assert.match(styles, /#bulkScanPanel\.has-capture>\.bulk-options\{display:none\}/);
  assert.match(styles, /#bulkScanPanel\.has-capture \.empty-matches\{padding:0;border:0/);
  assert.match(index, /id="bulkAutoContinue"/);
});

test('unsichere Ergebnisse zeigen höchstens drei Kandidaten und Fehler erzwingen keinen Treffer', () => {
  assert.match(app, /bulkCandidates = found\.slice\(0, 3\)/);
  assert.match(app, /Keine belastbaren Kandidaten gefunden/);
  assert.match(app, /BulkFast\.recordUncertain/);
  assert.match(app, /BulkFast\.recordFailed/);
  assert.match(app, /artworkFallbackMs/);
  assert.match(app, /Keine belastbaren Kandidaten gefunden/);
  assert.match(app, /Lokale Erkennung fehlgeschlagen/);
});
