'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(assets, 'styles.css'), 'utf8');

test('startet mit einem eigenständigen PokéFolio-Dashboard und vollständigen Schnellaktionen', () => {
  assert.match(index, /<section id="home" class="page active">/);
  assert.match(index, /Sammlungswert/);
  assert.match(index, /data-home-action="scan"/);
  assert.match(index, /data-home-action="bulk"/);
  assert.match(index, /data-home-action="gallery"/);
  assert.match(index, /data-home-action="collection"/);
  assert.match(index, /id="homeValuable"/);
  assert.match(index, /id="homeRecent"/);
  assert.match(index, /id="homeScans"/);
  assert.match(index, /id="homeSets"/);
  assert.doesNotMatch(index + styles, /HoloDex|Collectr/i);
});

test('zeigt nur belastbare Markttrends und verwendet Lazy-Loading-Thumbnails', () => {
  assert.match(index, /id="homeTrend"[^>]*hidden/);
  assert.match(app, /Number\.isFinite\(Number\(card\.price && card\.price\.changePercent\)\)/);
  assert.match(app, /loading="lazy" decoding="async"/);
  assert.match(app, /Noch keine belastbaren Preisdaten vorhanden/);
});

test('bietet fünf sichere Bottom-Navigation-Ziele mit hervorgehobenem Scanner', () => {
  for (const page of ['home', 'collection', 'scan', 'grading', 'settings']) {
    assert.match(index, new RegExp(`data-page="${page}"`));
  }
  assert.match(index, /<section id="portfolio" class="page">/);
  assert.match(index, /data-home-action="portfolio"/);
  assert.match(index, /class="nav-scan"/);
  assert.match(styles, /var\(--android-nav-inset-bottom\)/);
  assert.match(styles, /nav \.nav-scan/);
});

test('strukturiert die Sammlung in Karten, Sets, Duplikate, Fehlende und Favoriten', () => {
  for (const tab of ['cards', 'sets', 'duplicates', 'missing', 'favorites']) {
    assert.match(index, new RegExp(`data-collection-tab="${tab}"`));
  }
  assert.match(app, /function activateCollectionSection/);
  assert.match(app, /collectionSectionTab === 'missing'/);
  assert.match(app, /collectionFilters\.quantity = collectionSectionTab === 'duplicates'/);
  assert.match(app, /let collectionSectionTab = collectionViewMode === 'sets' \? 'sets' : 'cards'/);
});

test('stellt normalisierten Scan und lokalisierte Referenz direkt gegenüber', () => {
  assert.match(index, /class="direct-card-compare"/);
  assert.match(index, /id="comparisonScanImg"[^>]*Vollständige normalisierte Karte/);
  assert.match(index, /id="bestReferenceImg"/);
  assert.match(app, /Referenzbild: \$\{focusedImageLanguage/);
  assert.match(styles, /\.direct-card-compare/);
  assert.match(styles, /\.scan-preview-button img\{[^}]*object-fit:contain/);
  assert.match(styles, /\.candidate-strip\{[^}]*overflow-x:auto/);
});

test('reduziert Kandidaten visuell zweistufig auf Top-K vor dem Detailvergleich', () => {
  assert.match(app, /const visualLimit = Math\.min\(80, list\.length\)/);
  assert.match(app, /Recognition\.visualCandidatePriority/);
  assert.match(app, /\.slice\(0, 20\)/);
  assert.match(app, /index >= 12/);
  assert.match(app, /VISUAL_TOP_K/);
  assert.match(app, /Recognition\.filterPlausibleCandidates/);
});
