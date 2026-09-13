'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Sync = require('../app/src/main/assets/sync-core.js');

const bootstrapPath = path.join(
  __dirname, '..', 'windows', 'PokeFolio.Desktop', 'WebHost', 'desktop-bootstrap.js');
const driverPath = path.join(
  __dirname, '..', 'windows', 'PokeFolio.Desktop', 'WebHost', 'desktop-sync-driver.js');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const driver = fs.readFileSync(driverPath, 'utf8');

const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const operationId = '10000000-0000-0000-0000-000000000001';
const holdingId = '20000000-0000-0000-0000-000000000001';

function emptySnapshot() {
  return {schemaVersion: 1, state: Sync.createState(), entities: Sync.createEntities()};
}

function pendingSnapshot() {
  const snapshot = emptySnapshot();
  snapshot.state = Sync.enqueue(snapshot.state, {
    operationId,
    kind: 'holding.quantityDelta',
    holdingId,
    delta: 1
  }, 1000).state;
  return snapshot;
}

function createRuntime(options = {}) {
  const listeners = new Map();
  const events = [];
  const saved = [];
  const snapshots = new Map(Object.entries(options.snapshots || {}));
  let currentUserId = options.userId || userA;
  let sequence = 1;
  let window;

  const status = () => ({
    configured: true,
    authenticated: Boolean(currentUserId),
    session: currentUserId ? {userId: currentUserId} : null
  });
  const respond = payload => queueMicrotask(() =>
    window.onDesktopSyncResult(JSON.stringify(payload)));
  const nativeHost = {
    getAccountStatus: () => JSON.stringify(status()),
    registerAccount: () => {},
    loginAccount: () => {},
    restoreAccountSession: () => {},
    logoutAccount: () => {},
    resolveCatalogCard: () => {},
    getCatalogCard: () => {},
    loadAccountSyncSnapshot: () => snapshots.has(currentUserId)
      ? JSON.stringify(snapshots.get(currentUserId)) : '',
    saveAccountSyncSnapshot: json => {
      const value = JSON.parse(json);
      snapshots.set(currentUserId, value);
      saved.push({userId: currentUserId, value});
      return true;
    },
    pushSyncOperations: (json, requestId) => {
      if (options.push) return options.push({json, requestId, respond, currentUserId});
      const operations = JSON.parse(json).operations;
      respond({
        requestId,
        operation: 'push',
        ok: true,
        status: 200,
        data: {results: operations.map(operation => ({
          operationId: operation.operationId,
          status: 'applied',
          entity: null,
          problem: null
        }))},
        problem: null
      });
    },
    pullSyncChanges: (cursor, limit, requestId) => {
      if (options.pull) return options.pull({cursor, limit, requestId, respond, currentUserId});
      respond({
        requestId,
        operation: 'pull',
        ok: true,
        status: 200,
        data: {changes: [], nextCursor: 'cursor-1', hasMore: false},
        problem: null
      });
    }
  };
  window = {
    chrome: {webview: {hostObjects: {sync: {PokeNative: nativeHost}}}},
    navigator: {onLine: true},
    setTimeout: () => sequence++,
    clearTimeout: () => {},
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
    dispatchEvent(event) {
      events.push(event);
      (listeners.get(event.type) || []).slice().forEach(listener => listener(event));
      return true;
    }
  };
  window.window = window;
  const CustomEvent = class CustomEvent {
    constructor(type, eventOptions) {
      this.type = type;
      this.detail = eventOptions && eventOptions.detail;
    }
  };
  const context = {
    window,
    CustomEvent,
    Date,
    JSON,
    Map,
    Number,
    Object,
    Promise,
    TypeError,
    RangeError,
    String
  };
  vm.runInNewContext(bootstrap, context, {filename: bootstrapPath});
  window.PokeSync = Sync;
  vm.runInNewContext(driver, context, {filename: driverPath});

  const switchAccount = userId => {
    currentUserId = userId;
    window.dispatchEvent(new CustomEvent('pokefolio:account-state', {
      detail: {operation: 'status', ok: true, status: status()}
    }));
  };
  switchAccount(currentUserId);
  return {window, nativeHost, events, saved, snapshots, switchAccount};
}

test('Windows Sync-Treiber laedt eine persistierte Queue und schreibt Push/Pull atomar fort', async () => {
  const runtime = createRuntime({snapshots: {[userA]: pendingSnapshot()}});

  const status = await runtime.window.PokeSyncClient.syncNow();

  assert.equal(status.phase, 'idle');
  assert.equal(status.pending, 0);
  assert.equal(status.cursorAvailable, true);
  assert.ok(runtime.saved.length >= 2, 'push reconciliation and pull page are persisted separately');
  assert.equal(runtime.saved[0].value.state.pending.length, 0);
  assert.equal(runtime.saved.at(-1).value.state.cursor, 'cursor-1');
  assert.equal(runtime.snapshots.get(userA).state.pending.length, 0);
});

test('Windows Sync-Treiber persistiert Offline-Operation vor jedem Transportversuch', () => {
  const runtime = createRuntime({snapshots: {[userA]: emptySnapshot()}});

  const result = runtime.window.PokeSyncClient.enqueue({
    operationId,
    kind: 'holding.quantityDelta',
    holdingId,
    delta: 1
  });

  assert.equal(result.queued, true);
  assert.equal(runtime.saved.length, 1);
  assert.equal(runtime.saved[0].userId, userA);
  assert.equal(runtime.saved[0].value.state.pending[0].operation.operationId, operationId);
});

test('Windows Sync-Treiber behaelt fehlgeschlagene Operation mit begrenztem Retry', async () => {
  const runtime = createRuntime({
    snapshots: {[userA]: pendingSnapshot()},
    push({requestId, respond}) {
      respond({
        requestId,
        operation: 'push',
        ok: false,
        status: 503,
        data: null,
        problem: {status: 503, code: 'temporarily_unavailable'}
      });
    }
  });

  const status = await runtime.window.PokeSyncClient.syncNow();

  const pending = runtime.snapshots.get(userA).state.pending[0];
  assert.equal(status.phase, 'retry');
  assert.equal(status.pending, 1);
  assert.equal(pending.attemptCount, 1);
  assert.ok(pending.nextAttemptAt > Date.now());
});

test('Antwort eines alten Kontos wird nach Kontowechsel weder angewendet noch gespeichert', async () => {
  let delayed;
  const runtime = createRuntime({
    snapshots: {[userA]: pendingSnapshot(), [userB]: emptySnapshot()},
    push(call) {
      delayed = call;
    }
  });

  const running = runtime.window.PokeSyncClient.syncNow();
  await Promise.resolve();
  runtime.switchAccount(userB);
  delayed.respond({
    requestId: delayed.requestId,
    operation: 'push',
    ok: true,
    status: 200,
    data: {results: [{
      operationId,
      status: 'applied',
      entity: null,
      problem: null
    }]},
    problem: null
  });
  await running;

  assert.equal(runtime.window.PokeSyncClient.status().ready, true);
  assert.equal(runtime.window.PokeSyncClient.status().pending, 0);
  assert.equal(runtime.saved.some(entry => entry.userId === userB), false);
  assert.equal(runtime.snapshots.get(userA).state.pending.length, 1);
});

test('beschaedigter Snapshot wird blockiert und nicht automatisch ueberschrieben', () => {
  const runtime = createRuntime({snapshots: {[userA]: {
    schemaVersion: 1,
    state: Sync.createState(),
    entities: {},
    accessToken: 'must-not-be-accepted'
  }}});

  const status = runtime.window.PokeSyncClient.status();
  assert.equal(status.phase, 'storage-error');
  assert.equal(status.ready, false);
  assert.equal(runtime.saved.length, 0);
});
