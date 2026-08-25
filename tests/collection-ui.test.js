'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(assets, 'styles.css'), 'utf8');
const collection = fs.readFileSync(path.join(assets, 'collection-core.js'), 'utf8');

test('zeigt ein kompaktes Portfolio und TCG-Schnellfilter', () => {
  assert.match(index, /Meine Sammlung/);
  assert.match(index, /id="portfolioTotal"/);
  assert.match(index, /id="portfolioDistinct"/);
  assert.match(index, /id="portfolioValue"/);
  assert.match(index, /id="portfolioDuplicates"/);
  assert.match(index, /data-collection-tcg="pokemon"/);
  assert.match(app, /Collection\.portfolioSummary\(allCards\)/);
});

test('bietet Raster, Liste und Set-Tracker mit drei Karten pro Smartphone-Zeile', () => {
  assert.match(index, /data-collection-view="grid"/);
  assert.match(index, /data-collection-view="list"/);
  assert.match(index, /data-collection-view="sets"/);
  assert.match(styles, /\.collection-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(app, /loading="lazy" decoding="async"/);
  assert.match(app, /collectionVisibleLimit = 90/);
  assert.match(collection, /cards: all\.slice\(offset, offset \+ limit\)/);
});

test('enthält Suche, vollständige Filter und alle geforderten Sortierungen', () => {
  assert.match(index, /id="collectionSearch"/);
  assert.match(index, /id="collectionCardTypeFilter"/);
  assert.match(index, /id="collectionVariantFilter"/);
  assert.match(index, /id="collectionGradedFilter"/);
  assert.match(index, /id="collectionFavoriteFilter"/);
  assert.match(index, /value="collector">Setnummer/);
  assert.match(index, /value="name-asc">Name A–Z/);
  assert.match(index, /value="name-desc">Name Z–A/);
  assert.match(index, /value="value-high">Höchster Wert/);
  assert.match(index, /value="value-low">Niedrigster Wert/);
  assert.match(index, /value="quantity-high">Höchste Stückzahl/);
  assert.match(index, /value="ko">Koreanisch/);
  assert.match(index, /value="zh-CN">Chinesisch \(vereinfacht\)/);
  assert.match(index, /value="zh-TW">Chinesisch \(traditionell\)/);
  assert.match(index, /value="special-illustration-rare">Special Illustration Rare/);
});

test('zeigt Set-Fortschritt, Varianten und fehlende Karten erst beim Öffnen', () => {
  assert.match(app, /Collection\.missingSetNumbers\(group\)/);
  assert.match(app, /Set-Tracker/);
  assert.match(app, /Fehlende Karten/);
  assert.match(app, /group\.variants\.reverse/);
  assert.match(app, /group\.completion \* 1000/);
  assert.match(styles, /\.set-progress/);
});

test('zeigt Kartenbild, Bestand, Einzel- und Gesamtwert sowie individuelle Scan-Daten', () => {
  assert.match(index, /id="collectionDetail"/);
  assert.match(app, /Einzelwert/);
  assert.match(app, /Gesamt/);
  assert.match(app, /Scan-Daten, Pregrade und Authentizität/);
  assert.match(app, /Bulk-Eintrag ohne individuellen Front-\/Backscan/);
  assert.match(app, /saveCollectionNotes/);
  assert.match(app, /toggleCollectionFavorite/);
  assert.match(app, /Raw-Marktwert/);
  assert.match(app, /PriceCharting wird nur mit belastbaren Kartendaten angezeigt/);
  assert.match(app, /kein offizielles PSA-\/CGC-\/BGS-Grading/);
  assert.match(collection, /specimens/);
  assert.match(collection, /entryMode/);
});
