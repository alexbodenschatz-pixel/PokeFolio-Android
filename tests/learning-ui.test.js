'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(assets, 'styles.css'), 'utf8');

test('lädt die lokale Lernschicht getrennt vor der App', () => {
  assert.match(index, /<script src="learning-core\.js"><\/script>[\s\S]*<script src="app\.js"><\/script>/);
  assert.match(app, /const Learning = window\.PokeLearning/);
  assert.match(app, /pf_learning_state/);
});

test('prüft lokale Referenzen nach Crop und vor dem Onlineabruf', () => {
  const buildLocal = app.indexOf("learningScan = await buildLearningScan(prepared, hints, kind, 'single')");
  const online = app.indexOf("lookup = await lookupCandidates(kind, hints, '', run)", buildLocal);
  assert.ok(buildLocal >= 0 && online > buildLocal);
  assert.match(app, /createLearningFingerprint\(prepared\.dataUrl, prepared\)/);
  assert.match(app, /Learning\.findMatches/);
  assert.match(app, /Learning\.enrichCandidates/);
});

test('lernt nur nach expliziter Auswahl und niemals durch automatisches Anwenden oder automatische Bulk-Speicherung', () => {
  assert.match(app, /window\.applyCandidate =[^]*?if \(!automatic\) recordLearningSelection[^]*?window\.changeRecognizedCandidate/);
  assert.match(app, /trigger === 'MANUAL_SELECTION' \|\| trigger === 'AUTO_VARIANT_SELECTION'/);
  assert.doesNotMatch(app, /trigger === 'AUTO'[^}]*recordLearningSelection/);
  assert.match(app, /recordLearningSelection\(learningScan, recognition, 'single-collection-save'\)/);
});

test('bietet explizite Ablehnung ohne positives Lernbeispiel', () => {
  assert.match(app, /Nicht diese Karte/);
  assert.match(app, /recordLearningRejection/);
  assert.match(app, /eventType: 'REJECTED'/);
  assert.match(app, /window\.rejectBulkCandidate/);
});

test('verwendet im Bulk-Modus Identifier-Caches vor API und lokale Lernreferenzen vor breiter Suche', () => {
  const cache = app.indexOf('findBulkCachedIdentity(identifier)');
  const exact = app.indexOf('exactBulkApiLookup(kind, bulkHints, identifier)', cache);
  const learning = app.indexOf('Learning.isFastBulkMatch', exact);
  const lookup = app.indexOf("lookup = await lookupCandidates(kind, bulkHints, '', run)", learning);
  assert.ok(cache >= 0 && exact > cache && learning > exact && lookup > learning);
  assert.match(app, /lookupSource: 'LOCAL_LEARNING'/);
  assert.match(app, /scheduleBulkMetadataRefresh/);
});

test('zeigt Lernkontrolle, Statistik, Speicher und getrennte Nutzungsschalter im Systembereich', () => {
  for (const id of ['learningEnabled', 'learningUseReferences', 'learningShowData', 'learningShowStats',
    'learningReset', 'learningStorage', 'learningConfirmed', 'learningCorrected', 'learningCards', 'learningReferences']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(index, /Keine Cloud-Übertragung/);
  assert.match(styles, /learning-summary/);
});

test('setzt ausschließlich Lernwissen zurück und lässt den Collection-Key unangetastet', () => {
  const resetStart = app.indexOf("$('#learningReset').onclick");
  const resetEnd = app.indexOf("function setScanMode", resetStart);
  const reset = app.slice(resetStart, resetEnd);
  assert.match(reset, /Learning\.createState\(\)/);
  assert.match(reset, /persistLearningState/);
  assert.doesNotMatch(reset, /pf_collection|persistCollection|localStorage\.clear/);
});

test('macht lokale Teilscores und Karten-Lernstatus transparent', () => {
  assert.match(app, /Lokale Referenz<\/span>/);
  assert.match(app, /Lokales Artwork<\/span>/);
  assert.match(app, /Korrekturbonus<\/span>/);
  assert.match(app, /Learning\.cardLearningStatus/);
  assert.match(app, /Erkennung für diese Karte lokal optimiert/);
});

test('schreibt geforderte datensparsame Debug-Ereignisse', () => {
  for (const event of ['LEARNING_MATCH', 'LEARNING_CONFIRMED', 'LEARNING_CORRECTED', 'LEARNING_REJECTED',
    'LEARNING_REFERENCE_ADDED', 'LEARNING_REFERENCE_SKIPPED_DUPLICATE']) {
    assert.match(app, new RegExp(event));
  }
  assert.doesNotMatch(app, /LEARNING_MATCH[^\n]*(dataUrl|base64|Originalfoto)/i);
});
