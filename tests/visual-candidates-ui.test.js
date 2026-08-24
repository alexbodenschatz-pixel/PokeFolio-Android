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

test('zeigt die getrennte Begründung für Name, Nummer, Artwork, KP und Set', () => {
  assert.match(app, /class="match-breakdown"/);
  assert.match(app, /<span>Name<\/span>/);
  assert.match(app, /<span>Kartennummer<\/span>/);
  assert.match(app, /<span>Artwork<\/span>/);
  assert.match(app, /<span>KP\/HP<\/span>/);
  assert.match(app, /<span>Set<\/span>/);
  assert.match(app, /% Gesamt/);
});

test('zeigt die validierten OCR-Identitätsmerkmale aufklappbar an', () => {
  assert.match(index, /id="recognitionFeatures"/);
  assert.match(index, />Erkannte Merkmale</);
  assert.match(app, /OCR-Sicherheit Name/);
  assert.match(app, /Namensquelle/);
  assert.match(app, /pokemonIdentity/);
  assert.match(index, /Keine passenden Kartenkandidaten gefunden/);
});

test('filtert die Pokémon-Identität zwingend vor dem visuellen Vergleich', () => {
  const prefilter = app.indexOf('Recognition.prefilterPokemonCandidates');
  const visual = app.indexOf('async function enrichWithVisualSimilarity');
  assert.ok(prefilter >= 0);
  assert.ok(visual > prefilter);
  assert.doesNotMatch(app, /details\.name\s*>=\s*0\.58/);
  assert.match(app, /details\.name\s*>=\s*0\.88/);
});
