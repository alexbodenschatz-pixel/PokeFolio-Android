'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');

test('Einzelscan bestätigt die Identität und fordert eine offene Druckvariante separat an', () => {
  assert.match(index, /id="recognitionVariantPanel"/);
  assert.match(index, /id="recognitionVariantTitle">Variante auswählen/);
  assert.match(app, /IDENTITY_CONFIRMED_VARIANT_UNCERTAIN/);
  assert.match(app, /Kartenidentität \$\{identityScore\} %/);
  assert.match(app, /Variante \$\{variantConfirmed \? variantScore \+ ' %' : 'noch offen'\}/);
  assert.match(app, /saveIdentifiedCard'\)\.disabled = !variantConfirmed/);
  assert.match(app, /gradeIdentifiedCard'\)\.disabled = !variantConfirmed/);
});

test('Variantenauswahl verändert die gefundene Identität ohne neue Onlinesuche', () => {
  const start = app.indexOf('window.selectRecognitionVariant = value =>');
  const end = app.indexOf("$('#saveIdentifiedCard').onclick", start);
  const handler = app.slice(start, end);
  assert.match(handler, /Variants\.selectVariant/);
  assert.match(handler, /Die Identität wurde nicht erneut gesucht/);
  assert.doesNotMatch(handler, /lookupCandidates|pokemonSearch|tcgdex/);
});

test('Bulk-Scan speichert eine sichere Kartenidentität auch bei später korrigierbarer Variante', () => {
  assert.match(index, /id="bulkVariant"[\s\S]*value="unknown"[^>]*>Automatisch bestimmen/);
  assert.match(app, /Variants\.explicitVariant\(candidate\) === 'unknown'/);
  assert.match(app, /variantSelectionConfirmed: Variants\.explicitVariant\(candidate\) !== 'unknown'/);
  assert.match(app, /Variante später in der Sammlung korrigierbar/);
  assert.match(app, /IDENTITY_CONFIRMED_VARIANT_UNCERTAIN[\s\S]*commitBulkCandidate/);
});

test('Sammlungsdetail erlaubt eine verlustfreie Variantenänderung mit Preisaktualisierung', () => {
  assert.match(app, /detail-variant-editor/);
  assert.match(app, /Collection\.changeVariant\(loadCollection\(\), id, value, localPrice\)/);
  assert.match(app, /refreshedVariantPrice\(changed\.entry, value\)/);
  assert.match(app, /record\.collectionKey !== changed\.oldKey/);
});
