'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'app', 'src', 'main', 'assets');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const collection = fs.readFileSync(path.join(assets, 'collection-core.js'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app', 'MainActivity.java'), 'utf8');
const camera = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'de', 'pokefolio', 'app', 'CameraActivity.java'), 'utf8');

test('bietet getrennte Einzel- und Bulk-Modi ohne Rückseite oder Vorgrading im Bulk-Bereich', () => {
  assert.match(index, /data-scan-mode="single"[^>]*>Einzelscan/);
  assert.match(index, /data-scan-mode="bulk"[^>]*>Bulk-Scan/);
  const bulk = index.slice(index.indexOf('id="bulkScanPanel"'), index.indexOf('</section>', index.indexOf('id="bulkScanPanel"')));
  assert.match(bulk, /Karten schnell hintereinander scannen/);
  assert.match(bulk, /id="bulkCameraButton"/);
  assert.doesNotMatch(bulk, /Rückseite|Vorgrading|Echtheit|Zustand/);
});

test('öffnet für Bulk direkt die native CameraX-Liveansicht und übergibt ein kompaktes Scanbild', () => {
  assert.match(app, /PokeNative\.openBulkScanner\(requestId\)/);
  assert.match(activity, /openBulkScanner\(String requestId\)/);
  assert.match(activity, /startActivityForResult\(scanner, BULK_SCANNER\)/);
  assert.match(activity, /onNativeBulkScannerResult/);
  assert.match(activity, /Bitmap\.CompressFormat\.JPEG, 89/);
  assert.match(camera, /EXTRA_BULK_MODE/);
  assert.match(camera, /CAPTURE_MODE_MINIMIZE_LATENCY/);
});

test('speichert im Bulk-Modus nur eine bestätigte Identität und blockiert nicht auf einer offenen Variante', () => {
  assert.match(app, /Recognition\.confidenceDecision\(list\)/);
  assert.match(app, /IDENTITY_CONFIRMED_VARIANT_CONFIRMED && confidence >= 0\.80/);
  assert.match(app, /exactPrintedIdentity && noContradiction/);
  assert.match(app, /details\.collector === 'match'/);
  assert.match(app, /bulkCandidates\.slice\(0, 3\)/);
  assert.match(app, /REJECTED_LOW_CONFIDENCE/);
  assert.match(app, /MANUAL_SELECTION/);
  assert.match(app, /IDENTITY_CONFIRMED_VARIANT_UNCERTAIN[\s\S]*commitBulkCandidate/);
  assert.match(app, /Variante später in der Sammlung korrigierbar/);
  assert.match(index, /Keine eindeutige Karte erkannt/);
});

test('protokolliert Collection-Key und Mengenaktion und schützt gegen Mehrfachframes', () => {
  assert.match(app, /Collection\.registerScan\(bulkScanLock, key/);
  assert.match(app, /SAME_CARD_STILL_PRESENT|REJECTED_DUPLICATE_FRAME/);
  assert.match(app, /collectionKey=/);
  assert.match(collection, /QUANTITY_INCREMENT/);
  assert.match(app, /debugBulkScan\(bulkHints, kind, 'PRIMARY_IDENTIFIER', identifierOcr\.text\)/);
  assert.match(index, /Karte bereits vorhanden – Stückzahl erhöht|bulkStatusTitle/);
});

test('zeigt Mengensteuerung, Mengenfilter und Setstatistiken', () => {
  assert.match(index, /data-quantity-filter="duplicates"/);
  assert.match(index, /data-quantity-filter="single"/);
  assert.match(index, /data-quantity-filter="threeplus"/);
  assert.match(app, /adjustCardQuantity/);
  assert.match(app, /verschiedene Karten/);
  assert.match(app, /Karten insgesamt/);
  assert.match(app, /Collection\.summarizeSets/);
});

test('erzwingt auch im Bulk-Scanner Torch und Aufnahmeblitz aus', () => {
  assert.match(camera, /setFlashMode\(ImageCapture\.FLASH_MODE_OFF\)/);
  assert.match(camera, /forceTorchOff\("camera-bound"\)/);
  assert.match(camera, /forceTorchOff\("activity-stopped"\)/);
  assert.doesNotMatch(camera, /FLASH_MODE_AUTO/);
});
