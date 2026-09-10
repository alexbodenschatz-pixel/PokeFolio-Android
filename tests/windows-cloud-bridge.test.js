'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bootstrapPath = path.join(
  __dirname,
  '..',
  'windows',
  'PokeFolio.Desktop',
  'WebHost',
  'desktop-bootstrap.js'
);
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

function createRuntime(nativeOverrides = {}) {
  const events = [];
  const nativeHost = {
    getAccountStatus: () => JSON.stringify({configured: false, authenticated: false}),
    registerAccount: () => {},
    loginAccount: () => {},
    restoreAccountSession: () => {},
    logoutAccount: () => {},
    pushSyncOperations: () => {},
    pullSyncChanges: () => {},
    ...nativeOverrides
  };
  const window = {
    chrome: {webview: {hostObjects: {sync: {PokeNative: nativeHost}}}},
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    dispatchEvent: event => events.push(event)
  };
  window.window = window;
  vm.runInNewContext(bootstrap, {
    window,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    Date,
    JSON,
    Map,
    Number,
    Object,
    Promise,
    TypeError,
    RangeError,
    String
  }, {filename: bootstrapPath});
  return {window, nativeHost, events};
}

test('Windows Sync-Transport serialisiert Batch und ordnet strukturierten Callback zu', async () => {
  let nativeCall;
  const runtime = createRuntime({
    pushSyncOperations(json, requestId) {
      nativeCall = {json, requestId};
    }
  });

  const pending = runtime.window.PokeSyncTransport.push({operations: []});
  assert.deepEqual(JSON.parse(nativeCall.json), {operations: []});
  assert.match(nativeCall.requestId, /^sync-/);

  runtime.window.onDesktopSyncResult(JSON.stringify({
    requestId: nativeCall.requestId,
    operation: 'push',
    ok: true,
    status: 200,
    data: {results: []},
    problem: null
  }));

  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.data.results.length, 0);
  assert.equal(runtime.events.at(-1).type, 'pokefolio:sync-result');
  assert.equal(Object.isFrozen(runtime.window.PokeSyncTransport), true);
});

test('Windows Sync-Transport reicht opaken Cursor und Seitengröße unverändert durch', async () => {
  let nativeCall;
  const runtime = createRuntime({
    pullSyncChanges(cursor, limit, requestId) {
      nativeCall = {cursor, limit, requestId};
    }
  });

  const pending = runtime.window.PokeSyncTransport.pull('opaque+/cursor=', 250);
  assert.equal(nativeCall.cursor, 'opaque+/cursor=');
  assert.equal(nativeCall.limit, 250);

  runtime.window.onDesktopSyncResult(JSON.stringify({
    requestId: nativeCall.requestId,
    operation: 'pull',
    ok: true,
    status: 200,
    data: {changes: [], nextCursor: 'next', hasMore: false},
    problem: null
  }));

  const response = await pending;
  assert.equal(response.data.nextCursor, 'next');
});

test('Windows Sync-Transport lehnt ungültige Eingaben vor dem nativen Aufruf ab', async () => {
  let nativeCalls = 0;
  const runtime = createRuntime({
    pushSyncOperations() {
      nativeCalls += 1;
    },
    pullSyncChanges() {
      nativeCalls += 1;
    }
  });

  await assert.rejects(runtime.window.PokeSyncTransport.push(null), /Sync-Batch/);
  await assert.rejects(runtime.window.PokeSyncTransport.push([]), /Sync-Batch/);
  await assert.rejects(runtime.window.PokeSyncTransport.pull(null, 0), /zwischen 1 und 500/);
  await assert.rejects(runtime.window.PokeSyncTransport.pull({cursor: 'wrong'}, 100), /Cursor/);
  assert.equal(nativeCalls, 0);
});
