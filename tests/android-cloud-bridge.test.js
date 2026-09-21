'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const assets = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const accountSource = fs.readFileSync(path.join(assets, 'android-account-bootstrap.js'), 'utf8');
const cloudSource = fs.readFileSync(path.join(assets, 'cloud-bootstrap.js'), 'utf8');

function createRuntime(overrides = {}) {
  const events = [];
  let storedSnapshot = '';
  const status = {
    configured: false,
    authenticated: false,
    backendOrigin: null,
    configurationError: null,
    session: null
  };
  const nativeHost = {
    getAccountStatus: () => JSON.stringify(status),
    registerAccount() {},
    loginAccount() {},
    restoreAccountSession() {},
    logoutAccount() {},
    resolveCatalogCard() {},
    getCatalogCard() {},
    pushSyncOperations() {},
    pullSyncChanges() {},
    loadAccountSyncSnapshot: () => storedSnapshot,
    saveAccountSyncSnapshot: json => {
      storedSnapshot = json;
      return true;
    },
    ...overrides
  };
  const window = {
    PokeNative: nativeHost,
    setTimeout,
    clearTimeout,
    dispatchEvent: event => events.push(event)
  };
  window.window = window;
  const context = {
    window,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    Date,
    Error,
    JSON,
    Map,
    Number,
    Object,
    Promise,
    RangeError,
    String,
    TypeError
  };
  vm.runInNewContext(accountSource, context, {filename: 'android-account-bootstrap.js'});
  vm.runInNewContext(cloudSource, context, {filename: 'cloud-bootstrap.js'});
  return {window, nativeHost, events, stored: () => storedSnapshot};
}

test('Android uses the shared token-free catalog and sync facades', async () => {
  let catalogCall;
  let syncCall;
  const runtime = createRuntime({
    resolveCatalogCard(json, requestId) {
      catalogCall = {json, requestId};
    },
    pushSyncOperations(json, requestId) {
      syncCall = {json, requestId};
    }
  });

  const catalogPending = runtime.window.PokeCatalog.resolve({
    provider: ' TCGDEX ',
    providerCardId: ' SV8-141 ',
    tcg: ' POKEMON ',
    name: ' Pikachu ',
    setCode: ' SV8 ',
    number: ' 141/191 '
  });
  assert.deepEqual(JSON.parse(catalogCall.json), {
    provider: 'tcgdex',
    providerCardId: 'sv8-141',
    tcg: 'pokemon',
    name: 'Pikachu',
    setCode: 'SV8',
    number: '141/191'
  });
  runtime.window.onPokeCatalogResult(JSON.stringify({
    requestId: catalogCall.requestId,
    operation: 'resolve',
    ok: true,
    status: 200,
    data: {card: {id: 'cccccccc-cccc-cccc-cccc-cccccccccccc'}},
    problem: null
  }));
  assert.equal((await catalogPending).ok, true);

  const syncPending = runtime.window.PokeSyncTransport.push({operations: []});
  assert.deepEqual(JSON.parse(syncCall.json), {operations: []});
  runtime.window.onPokeSyncResult(JSON.stringify({
    requestId: syncCall.requestId,
    operation: 'push',
    ok: true,
    status: 200,
    data: {results: []},
    problem: null
  }));
  assert.equal((await syncPending).data.results.length, 0);
  assert.equal(runtime.events.at(-1).type, 'pokefolio:sync-result');
  assert.equal(Object.isFrozen(runtime.window.PokeCatalog), true);
  assert.equal(Object.isFrozen(runtime.window.PokeSyncTransport), true);
  assert.doesNotMatch(cloudSource, /localStorage|sessionStorage|Authorization|refreshToken/);
});

test('shared sync storage delegates only an opaque snapshot to the native account partition', () => {
  const runtime = createRuntime();
  const snapshot = {schemaVersion: 1, state: {}, entities: {}};

  assert.equal(runtime.window.PokeSyncStorage.load(), null);
  assert.equal(runtime.window.PokeSyncStorage.save(snapshot), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.window.PokeSyncStorage.load())),
    snapshot);
  assert.equal(runtime.stored(), JSON.stringify(snapshot));
  assert.throws(() => runtime.window.PokeSyncStorage.save([]), /Objekt/);
});

test('Android index loads platform, cloud and sync layers before application startup', () => {
  const index = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
  const account = index.indexOf('android-account-bootstrap.js');
  const cloud = index.indexOf('cloud-bootstrap.js');
  const driver = index.indexOf('sync-driver.js');
  const app = index.indexOf('app.js');
  const collectionDriver = index.indexOf('collection-cloud-driver.js');

  assert.ok(account >= 0 && account < cloud);
  assert.ok(cloud < driver);
  assert.ok(driver < app);
  assert.ok(app < collectionDriver);
});
