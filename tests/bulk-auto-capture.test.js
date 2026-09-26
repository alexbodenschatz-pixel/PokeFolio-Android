'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assets = path.join(__dirname, '../app/src/main/assets');
const source = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const Collection = require(path.join(assets, 'collection-core.js'));

function harness(response) {
  const ctx = vm.createContext({
    window: {}, scanMode: 'bulk', bulkCameraBusy: false,
    bulkScanLock: Collection.registerScan(null, 'same-card', 1000).lock,
    Collection, setBulkStatus() {}, nativeOpenBulkScanner: async () => response,
    runBulkRecognition: async () => {}, bulkVariantCandidate: null,
    $: () => ({}), resetBulkCapturedImage() {}
  });
  vm.runInContext(source.slice(source.indexOf('window.startBulkCamera ='),
    source.indexOf('window.openBulkManualSearch =')), ctx);
  return ctx;
}

test('automatischer Weiterlauf behauptet keine Entfernung der Karte', async () => {
  const ctx = harness({ok: true, dataUrl: 'image'});
  ctx.window.bulkMarkRemovedAndScan();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Collection.registerScan(ctx.bulkScanLock, 'same-card', 99999).accepted, false);
});

test('nur bestätigte native Entfernung erlaubt ein weiteres identisches Exemplar', async () => {
  for (const confirmed of [undefined, false, 'true', true]) {
    const ctx = harness({ok: true, dataUrl: 'image', removalConfirmed: confirmed});
    await ctx.window.startBulkCamera();
    assert.equal(Collection.registerScan(ctx.bulkScanLock, 'same-card', 2000).accepted, confirmed === true);
  }
});

test('Abbruch und Fehler lösen die Workflow-Sperre ohne die Mengensperre aufzuheben', async () => {
  for (const failure of [false, true]) {
    const ctx = harness({cancelled: true});
    if (failure) ctx.nativeOpenBulkScanner = async () => { throw Error('Camera failure'); };
    await ctx.window.startBulkCamera();
    assert.equal(ctx.bulkCameraBusy, false);
    assert.equal(ctx.bulkScanLock.removed, false);
  }
});

test('paralleles Öffnen und Verlassen des Bulk-Modus erzeugen keine zweite Erkennung', async () => {
  const ctx = harness({});
  let finish, opens = 0, recognitions = 0;
  ctx.nativeOpenBulkScanner = () => { opens++; return new Promise(resolve => { finish = resolve; }); };
  ctx.runBulkRecognition = async () => { recognitions++; };
  const pending = ctx.window.startBulkCamera();
  await ctx.window.startBulkCamera();
  assert.equal(opens, 1);
  ctx.scanMode = 'single';
  finish({ok: true, dataUrl: 'image'});
  await pending;
  assert.equal(recognitions, 0);
  assert.equal(ctx.bulkCameraBusy, false);
});

test('unsichere Variante umgeht keine Identitäts-, Sprach- oder Nummernprüfung', () => {
  const states = {IDENTITY_CONFIRMED_VARIANT_CONFIRMED: 'confirmed', IDENTITY_CONFIRMED_VARIANT_UNCERTAIN: 'uncertain'};
  const ctx = vm.createContext({Variants: {STATES: states}, Recognition: {confidenceDecision: () => ({state: 'uncertain'})}});
  vm.runInContext(source.slice(source.indexOf('function isBulkAutoAcceptable('),
    source.indexOf('function renderBulkVariantSelector(')), ctx);
  const candidate = {tcg: 'pokemon', confidence: 0.96, matchDetails: {collector: 'match', set: 'match'}};
  assert.equal(ctx.isBulkAutoAcceptable([candidate], true), true);
  assert.equal(ctx.isBulkAutoAcceptable([candidate]), false);
  for (const mismatch of [{collector: 'mismatch'}, {set: 'mismatch'}, {language: 'mismatch'}, {cardType: 'mismatch'}]) {
    assert.equal(ctx.isBulkAutoAcceptable([{...candidate, matchDetails: {...candidate.matchDetails, ...mismatch}}], true), false);
  }
});
