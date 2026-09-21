'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const ui = fs.readFileSync(path.join(assets, 'account-ui.js'), 'utf8');

test('Kontoseite bietet Registrierung, Login, Sync und ausdrückliche lokale Migration', () => {
  for (const id of ['accountSettings', 'accountSignedOut', 'accountEmail', 'accountPassword',
    'accountDeviceName', 'accountLogin', 'accountRegister', 'accountSignedIn', 'accountSyncNow',
    'accountLogout', 'legacyMigration', 'legacyMigrationStart', 'cloudCollectionStatus']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(index, /Die lokale Sammlung bleibt als wiederherstellbare Kopie erhalten/);
  assert.match(ui, /account\.register\(/);
  assert.match(ui, /account\.login\(/);
  assert.match(ui, /account\.logout\(/);
  assert.match(ui, /sync\.syncNow\(/);
  assert.match(ui, /window\.confirm\(/);
});

test('Migration nutzt stabile Catalog-Referenzen und atomare Queue-Batches ohne lokale Löschung', () => {
  assert.match(ui, /migration\.createPlan\(/);
  assert.match(ui, /catalog\.resolve\(/);
  assert.match(ui, /migration\.buildOperation\(/);
  assert.match(ui, /sync\.enqueueMany\(/);
  assert.match(ui, /sync\.inspectOperations\(/);
  assert.match(ui, /window\.claimLegacyCollection\(userId\)/);
  assert.match(app, /AccountMigration\.collectionStorageKey\(userId, owner\)/);
  assert.match(app, /pf_legacy_collection_owner_v1/);
  assert.doesNotMatch(ui, /localStorage\.clear\(/);
  assert.doesNotMatch(ui, /removeItem\(['"]pf_collection/);
  assert.doesNotMatch(ui, /accessToken|refreshToken|Authorization/);
});

test('neue Einzel- und Bulk-Scans bewahren die Provider-Kartenidentität für Cloud-Sync', () => {
  assert.match(app, /AccountMigration\.referenceForCandidate\(candidate\)/);
  assert.match(app, /AccountMigration\.referenceForCandidate\(value\)/);
  assert.match(app, /\{catalogReference\}/);
});

test('Migrationscore und Konto-UI laden in sicherer Reihenfolge', () => {
  const collection = index.indexOf('collection-core.js');
  const cloudCore = index.indexOf('collection-cloud-core.js');
  const migration = index.indexOf('account-migration-core.js');
  const account = index.indexOf('android-account-bootstrap.js');
  const syncDriver = index.indexOf('sync-driver.js');
  const application = index.indexOf('app.js');
  const cloudDriver = index.indexOf('collection-cloud-driver.js');
  const accountUi = index.indexOf('account-ui.js');
  assert.ok(collection >= 0 && collection < cloudCore && cloudCore < migration);
  assert.ok(migration < account && account < syncDriver);
  assert.ok(syncDriver < application && application < cloudDriver && cloudDriver < accountUi);
});

test('aktive Sammlung exponiert nur kontogebundenen Cloud-Store und queue-basierte Mutationen', () => {
  assert.match(app, /Object\.defineProperty\(window, 'PokeCollectionStore'/);
  assert.match(app, /PokeCollectionCloud\.queueCollectionChanges\(loadCollection\(\), collection\)/);
  assert.match(app, /persistCollection\(migrated, \{cloudOrigin: true\}\)/);
  assert.doesNotMatch(app, /PokeCollectionStore[\s\S]{0,300}(accessToken|refreshToken)/);
});
