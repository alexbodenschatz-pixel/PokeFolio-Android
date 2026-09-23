'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Migration = require('../app/src/main/assets/account-migration-core.js');

const source = fs.readFileSync(path.join(
  __dirname, '..', 'app', 'src', 'main', 'assets', 'account-ui.js'), 'utf8');
const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const cardId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.max = 1;
    this.textContent = '';
    this.className = '';
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  reportValidity() {
    return true;
  }

  emit(type, event = {}) {
    const listener = this.listeners.get(type);
    return listener && listener({preventDefault() {}, ...event});
  }
}

function createRuntime({authenticated = true, recoveryHash = ''} = {}) {
  const ids = [
    'accountSettings', 'accountStatusBadge', 'accountSignedOut', 'accountSignedIn',
    'accountConfigurationMessage', 'accountDeviceName', 'accountLogin', 'accountRegister',
    'accountForgotPassword', 'accountRecovery', 'accountRecoveryRequestForm',
    'accountRecoveryEmail', 'accountRecoveryRequest', 'accountRecoveryHaveToken',
    'accountRecoveryCancel', 'accountRecoveryConfirmForm', 'accountRecoveryConfirmEmail',
    'accountRecoveryToken', 'accountRecoveryPassword', 'accountRecoveryPasswordConfirm',
    'accountRecoveryConfirm', 'accountRecoveryConfirmCancel',
    'accountSyncNow', 'accountLogout', 'accountUserId', 'accountDevice', 'accountBackend',
    'accountMessage', 'legacyMigration', 'legacyMigrationStatus', 'legacyMigrationStart',
    'legacyMigrationSummary', 'legacyMigrationProgress', 'legacyMigrationIssues',
    'cloudCollectionStatus', 'cloudHoldingCount', 'cloudCardCount', 'cloudSyncStatus',
    'accountEmail', 'accountPassword'
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  const listeners = new Map();
  const storage = new Map();
  const queued = [];
  const events = [];
  let claimed = '';
  let syncRuns = 0;
  let resetRequestEmail = '';
  let resetConfirm = null;
  let replacedUrl = '';
  const collection = [{
    id: 1,
    collectionKey: 'pokemon|sv03|025|de|reverse-holo',
    tcg: 'pokemon',
    name: 'Pikachu',
    set: '151',
    setId: 'sv03',
    number: '025/165',
    lang: 'de',
    printingVariant: 'reverse-holo',
    condition: 'near-mint',
    quantity: 2,
    source: 'TCGdex de'
  }];
  const status = {
    configured: true,
    authenticated,
    backendOrigin: 'https://api.example.test',
    configurationError: null,
    session: authenticated ? {
      userId,
      device: {name: 'Testgerät', platform: 'windows'}
    } : null
  };
  const windowListeners = new Map();
  const window = {
    PokePlatform: {kind: 'windows'},
    PokeAccountMigration: Migration,
    PokeAccount: {
      status: () => status,
      register: async () => ({ok: true, status}),
      login: async () => ({ok: true, status}),
      requestPasswordReset: async email => {
        resetRequestEmail = email;
        return {ok: true, status: {...status, authenticated: false, session: null}};
      },
      confirmPasswordReset: async (email, token, password) => {
        resetConfirm = {email, token, password};
        return {ok: true, status: {...status, authenticated: false, session: null}};
      },
      logout: async () => ({ok: true, status: {...status, authenticated: false, session: null}})
    },
    PokeCatalog: {
      resolve: async reference => ({
        ok: true,
        data: {card: {id: cardId}, created: true, metadataMatched: true},
        reference
      })
    },
    PokeSyncClient: {
      status: () => ({ready: true, phase: 'idle', pending: 0, continuationPending: false}),
      entities: () => [],
      enqueueMany: operations => {
        queued.push(...operations);
        return {queued: operations.length};
      },
      inspectOperations: operations => operations.map(operationId => ({operationId, state: 'complete'})),
      syncNow: async () => {
        syncRuns++;
        return {ready: true, phase: 'idle', pending: 0, continuationPending: false};
      }
    },
    loadCollection: () => [],
    loadCollectionForMigration: requestedUserId => {
      assert.equal(requestedUserId, userId);
      return collection;
    },
    claimLegacyCollection: requestedUserId => {
      claimed = requestedUserId;
      return true;
    },
    confirm: () => true,
    location: {hash: recoveryHash, pathname: '/index.html', search: ''},
    history: {
      replaceState(_state, _title, url) {
        replacedUrl = url;
        window.location.hash = '';
      }
    },
    addEventListener(type, listener) {
      const values = windowListeners.get(type) || [];
      values.push(listener);
      windowListeners.set(type, values);
    },
    dispatchEvent(event) {
      events.push(event.type);
      (windowListeners.get(event.type) || []).forEach(listener => listener(event));
      return true;
    }
  };
  window.window = window;
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const document = {getElementById: id => elements.get(id) || null};
  const CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options && options.detail;
    }
  };
  vm.runInNewContext(source, {
    window,
    document,
    localStorage,
    CustomEvent,
    console,
    Date,
    Intl,
    JSON,
    Object,
    Promise,
    String,
    Number,
    Error,
    URLSearchParams
  }, {filename: 'account-ui.js'});
  return {
    window,
    elements,
    storage,
    queued,
    events,
    get claimed() { return claimed; },
    get syncRuns() { return syncRuns; },
    get resetRequestEmail() { return resetRequestEmail; },
    get resetConfirm() { return resetConfirm; },
    get replacedUrl() { return replacedUrl; }
  };
}

test('sichtbare Kontoseite übernimmt Legacy-Bestand bestätigt, idempotent und ohne Löschung', async () => {
  const runtime = createRuntime();
  assert.equal(runtime.elements.get('accountSignedIn').hidden, false);
  assert.equal(runtime.elements.get('legacyMigration').hidden, false);
  assert.match(runtime.elements.get('legacyMigrationSummary').textContent, /1 Positionen mit 2 Karten/);

  await runtime.elements.get('legacyMigrationStart').emit('click');

  assert.equal(runtime.claimed, userId);
  assert.equal(runtime.queued.length, 1);
  assert.equal(runtime.queued[0].kind, 'holding.create');
  assert.equal(runtime.queued[0].holding.cardId, cardId);
  assert.equal(runtime.queued[0].holding.quantity, 2);
  assert.equal(runtime.syncRuns, 2, 'cloud state is pulled before and reconciled after enqueue');
  const stored = JSON.parse(runtime.storage.get(`pf_legacy_collection_migration_v1:${userId}`));
  assert.equal(stored.status, 'complete');
  assert.equal(stored.entries[0].state, 'complete');
  assert.equal(runtime.elements.get('legacyMigrationStart').textContent, 'Sicher übernommen');
  assert.match(runtime.elements.get('accountMessage').textContent, /lokale Kopie bleibt erhalten/);
  assert.equal(runtime.storage.has('pf_collection'), false, 'migration UI never deletes or rewrites legacy data');
  assert.ok(runtime.events.includes('pokefolio:collection-scope'));
});

test('Kontowiederherstellung nutzt native Einmalaufrufe und verwirft alle Geheimnisse', async () => {
  const runtime = createRuntime({authenticated: false});
  runtime.elements.get('accountForgotPassword').emit('click');
  assert.equal(runtime.elements.get('accountSignedOut').hidden, true);
  assert.equal(runtime.elements.get('accountRecovery').hidden, false);

  runtime.elements.get('accountRecoveryEmail').value = 'owner@example.test';
  runtime.elements.get('accountRecoveryRequestForm').emit('submit');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.resetRequestEmail, 'owner@example.test');
  assert.equal(runtime.elements.get('accountRecoveryConfirmForm').hidden, false);
  assert.match(runtime.elements.get('accountMessage').textContent, /Falls ein Konto existiert/);

  runtime.elements.get('accountRecoveryToken').value = 'reset-' + 'r'.repeat(48);
  runtime.elements.get('accountRecoveryPassword').value = 'replacement password';
  runtime.elements.get('accountRecoveryPasswordConfirm').value = 'replacement password';
  runtime.elements.get('accountRecoveryConfirmForm').emit('submit');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(runtime.resetConfirm, {
    email: 'owner@example.test',
    token: 'reset-' + 'r'.repeat(48),
    password: 'replacement password'
  });
  assert.equal(runtime.elements.get('accountRecoveryToken').value, '');
  assert.equal(runtime.elements.get('accountRecoveryPassword').value, '');
  assert.equal(runtime.elements.get('accountRecoveryPasswordConfirm').value, '');
  assert.equal(runtime.elements.get('accountSignedOut').hidden, false);
  assert.match(runtime.elements.get('accountMessage').textContent, /Alle Geräte wurden abgemeldet/);
  assert.equal(runtime.storage.size, 0);
});

test('Reset-Link wird aus dem Fragment übernommen und sofort aus der Adresse entfernt', () => {
  const token = 'reset-' + 't'.repeat(48);
  const runtime = createRuntime({
    authenticated: false,
    recoveryHash: `#email=owner%40example.test&token=${token}`
  });

  assert.equal(runtime.elements.get('accountRecovery').hidden, false);
  assert.equal(runtime.elements.get('accountRecoveryConfirmForm').hidden, false);
  assert.equal(runtime.elements.get('accountRecoveryConfirmEmail').value, 'owner@example.test');
  assert.equal(runtime.elements.get('accountRecoveryToken').value, token);
  assert.equal(runtime.window.location.hash, '');
  assert.equal(runtime.replacedUrl, '/index.html');
  assert.equal(runtime.storage.size, 0);
});

test('angemeldete Sitzung verwirft einen eingehenden Reset-Code statt ihn verborgen zu halten', () => {
  const token = 'reset-' + 's'.repeat(48);
  const runtime = createRuntime({
    authenticated: true,
    recoveryHash: `#email=owner%40example.test&token=${token}`
  });

  assert.equal(runtime.elements.get('accountSignedIn').hidden, false);
  assert.equal(runtime.elements.get('accountRecovery').hidden, true);
  assert.equal(runtime.elements.get('accountRecoveryToken').value, '');
  assert.equal(runtime.window.location.hash, '');
  assert.equal(runtime.storage.size, 0);
});
