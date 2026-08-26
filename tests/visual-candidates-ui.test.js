'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');

test('zeigt Scan, bis zu fünf visuelle Treffer und akzeptiert nur bei kalibriertem Abstand automatisch', () => {
  assert.match(index, /id="comparisonScanImg"/);
  assert.match(index, /Mögliche Treffer/);
  assert.match(app, /candidates\.slice\(0, 5\)/);
  assert.match(app, /Diese Karte/);
  assert.match(app, /Recognition\.confidenceDecision\(candidates\)/);
  assert.match(app, /window\.applyCandidate\(0, true\)/);
  assert.match(app, /Karte erkannt – Variante noch nicht eindeutig/);
});

test('isoliert fehlende Kartenbilder mit Placeholder und Ladefehlerbehandlung', () => {
  assert.match(app, /candidate-image-placeholder/);
  assert.match(app, /onerror="candidateImageFailed\(this\)"/);
  assert.match(app, /loading="lazy"/);
  assert.match(app, /Keine aktuellen Marktdaten verfügbar/);
});

test('verwendet kleine Bilder für Listen und große Bilder für die Detailansicht', () => {
  assert.match(app, /card\.images\.small/);
  assert.match(app, /card\.images\.large/);
  assert.match(app, /tcgdexImageUrl\(card\.image, 'low'\)/);
  assert.match(app, /tcgdexImageUrl\(card\.image, 'high'\)/);
  assert.match(app, /candidate\.imageLarge \|\| candidate\.imageSmall/);
  assert.match(app, /async function imageFromFile\(file\)[\s\S]*URL\.createObjectURL\(file\)/);
  assert.doesNotMatch(app, /readAsDataURL\(file\)/);
});

test('zeigt die getrennte Begründung für Name, Nummer, Artwork, KP und Set', () => {
  assert.match(app, /class="match-breakdown"/);
  assert.match(app, /<span>Name<\/span>/);
  assert.match(app, /<span>Kartennummer<\/span>/);
  assert.match(app, /<span>Artwork<\/span>/);
  assert.match(app, /<span>KP\/HP<\/span>/);
  assert.match(app, /<span>Set<\/span>/);
  assert.match(app, /<span>Attacke<\/span>/);
  assert.match(app, /<span>Schaden<\/span>/);
  assert.match(app, /<span>Sprache<\/span>/);
  assert.match(app, /% Kartenidentität/);
  assert.match(app, /Druckvariante/);
  assert.match(app, />Identität<\/span>/);
  assert.match(app, />Druckvariante<\/span>/);
  assert.match(app, />Datensicherheit<\/span>/);
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
  assert.match(app, /replace\(\/\[\^a-z0-9\]\/g, ''\)/);
});

test('verwendet lokalisierte TCGdex-Daten primär und unterscheidet Netzwerk-, HTTP-, Parsing- und Leertreffer', () => {
  assert.match(app, /language !== 'en'/);
  assert.match(app, /primarySource: 'tcgdex-' \+ language/);
  assert.match(app, /fallbackSource: 'pokemon-tcg'/);
  assert.match(app, /Promise\.all\(\[pokemonTcgPromise, tcgdexPromise\]\)/);
  assert.match(app, /Netzwerkfehler beim Kartendienst/);
  assert.match(app, /Kartendienst meldet einen HTTP-Fehler/);
  assert.match(app, /Kartendaten konnten nicht gelesen werden/);
  assert.match(app, /summary\.kind === 'empty'/);
});

test('zeigt OCR-Merkmale vor dem Onlineabruf und croppt nur nativ statt per CSS object-fit', () => {
  const features = app.indexOf('renderRecognitionFeatures(hints)');
  const lookup = app.indexOf("lookup = await lookupCandidates(kind, hints, '', run)");
  assert.ok(features >= 0 && lookup > features);
  assert.match(app, /return await nativePrepareCard\(sourceDataUrl\)/);
  assert.match(app, /Sends the whole upload, not a premature center crop/);
  assert.match(app, /PokeNative\.recognizeCard\(dataUrl, requestId, language\)/);
});
