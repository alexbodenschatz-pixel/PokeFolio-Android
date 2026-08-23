'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');

test('zeigt Scan und bis zu fünf visuelle Treffer mit expliziter Auswahl', () => {
  assert.match(index, /id="comparisonScanImg"/);
  assert.match(index, /Mögliche Treffer/);
  assert.match(app, /candidates\.slice\(0, 5\)/);
  assert.match(app, /Diese Karte wählen/);
  assert.doesNotMatch(app, /if \(Recognition\.isConfident\(candidates\)\) \{\s*applyCandidate\(0\)/);
});

test('isoliert fehlende Kartenbilder mit Placeholder und Ladefehlerbehandlung', () => {
  assert.match(app, /candidate-image-placeholder/);
  assert.match(app, /onerror="candidateImageFailed\(this\)"/);
  assert.match(app, /loading="lazy"/);
  assert.match(app, /Kein Preis verfügbar/);
});

test('verwendet kleine Bilder für Listen und große Bilder für die Detailansicht', () => {
  assert.match(app, /card\.images\.small/);
  assert.match(app, /card\.images\.large/);
  assert.match(app, /tcgdexImageUrl\(card\.image, 'low'\)/);
  assert.match(app, /tcgdexImageUrl\(card\.image, 'high'\)/);
  assert.match(app, /candidate\.imageLarge \|\| candidate\.imageSmall/);
});
