'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../app/src/main/assets/collection-cloud-core.js');

const source = fs.readFileSync(path.join(
  __dirname, '..', 'app', 'src', 'main', 'assets', 'collection-cloud-driver.js'), 'utf8');
const userId = '40000000-0000-0000-0000-000000000001';
const holdingId = '10000000-0000-0000-0000-000000000001';
const cardId = '20000000-0000-0000-0000-000000000001';

class TestEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function runtime(options = {}) {
  const listeners = new Map();
  const writes = [];
  const queued = [];
  let pending = options.pending || 0;
  let ready = options.ready === undefined ? true : options.ready;
  let currentUserId = options.userId === undefined ? userId : options.userId;
  let uuidSequence = 0;
  const window = {
    PokeCollectionCloudCore: Core,
    PokeAccount: {
      status: () => currentUserId
        ? ({authenticated: true, session: {userId: currentUserId}})
        : ({authenticated: false, session: null})
    },
    PokeCatalog: {
      get: options.getCatalog || (async id => ({ok: true, data: {
        id, provider: 'tcgdex', providerCardId: 'sv8-141', tcg: 'pokemon',
        name: 'Pikachu ex', setCode: 'SV8', number: '141/191'
      }}))
    },
    PokeSyncClient: {
      status: () => ({ready, phase: 'idle', pending, continuationPending: false}),
      entities: () => [{
        id: holdingId, cardId, variantId: null, language: 'de', variant: 'normal',
        condition: 'near-mint', quantity: 2, notes: null, version: 1,
        createdAt: '2026-09-21T10:00:00Z', updatedAt: '2026-09-21T10:00:00Z'
      }],
      enqueueMany: operations => {
        queued.push(...operations);
        pending += operations.length;
        return {queued: operations.length};
      }
    },
    PokeCollectionStore: {
      read: () => [],
      replaceFromCloud: (id, collection) => {
        writes.push({id, collection});
        return true;
      }
    },
    crypto: {
      randomUUID: () => `30000000-0000-0000-0000-${String(++uuidSequence).padStart(12, '0')}`
    },
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach(listener => listener(event));
    },
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({window, CustomEvent: TestEvent, Uint8Array, console});
  vm.runInContext(source, context, {filename: 'collection-cloud-driver.js'});
  return {
    window,
    writes,
    queued,
    setPending: value => { pending = value; },
    setReady: value => { ready = value; },
    setUser: value => {
      currentUserId = value;
      window.dispatchEvent(new TestEvent('pokefolio:account-state'));
    }
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 25));

test('Cloud-Treiber hydriert erst nach leerer Queue und materialisiert zweiten Gerätebestand', async () => {
  const app = runtime({pending: 1});
  await settle();
  assert.equal(app.writes.length, 0);

  app.setPending(0);
  app.window.dispatchEvent(new TestEvent('pokefolio:sync-state'));
  await settle();

  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].id, userId);
  assert.equal(app.writes[0].collection[0].cloudHoldingId, holdingId);
  assert.equal(app.writes[0].collection[0].name, 'Pikachu ex');
  assert.equal(app.writes[0].collection[0].quantity, 2);
});

test('Cloud-Treiber schreibt lokale Mengendifferenz als atomare Offline-Operation', async () => {
  const app = runtime();
  await settle();
  const before = app.writes[0].collection[0];
  const after = {...before, quantity: 3};
  const result = app.window.PokeCollectionCloud.queueCollectionChanges([before], [after]);

  assert.equal(result.cloud, true);
  assert.equal(result.queued, 1);
  assert.equal(app.queued.length, 1);
  assert.equal(app.queued[0].kind, 'holding.quantityDelta');
  assert.equal(app.queued[0].holdingId, holdingId);
  assert.equal(app.queued[0].delta, 1);
});

test('Rein lokale Änderung bleibt auch vor Bereitschaft des Sync-Speichers möglich', async () => {
  const app = runtime({ready: false});
  await settle();
  const before = [{id: 'local', quantity: 1, favorite: false}];
  const after = [{id: 'local', quantity: 1, favorite: true}];

  assert.deepEqual(
    JSON.parse(JSON.stringify(app.window.PokeCollectionCloud.queueCollectionChanges(before, after))),
    {queued: 0, cloud: true});
  assert.equal(app.queued.length, 0);
});

test('Hydrierung überschreibt keine während der Katalogabfrage vorgemerkte Änderung', async () => {
  let completeCatalog;
  const catalogPending = new Promise(resolve => { completeCatalog = resolve; });
  const app = runtime({getCatalog: () => catalogPending});
  await settle();
  app.setPending(1);
  completeCatalog({ok: true, data: {
    id: cardId, provider: 'tcgdex', providerCardId: 'sv8-141', tcg: 'pokemon',
    name: 'Pikachu ex', setCode: 'SV8', number: '141/191'
  }});
  await settle();

  assert.equal(app.writes.length, 0);
});

test('Antwort des vorherigen Kontos wird nach Kontowechsel niemals geschrieben', async () => {
  const userB = '40000000-0000-0000-0000-000000000002';
  let catalogCalls = 0;
  let resolveFirst;
  const firstRequest = new Promise(resolve => { resolveFirst = resolve; });
  const card = {
    id: cardId, provider: 'tcgdex', providerCardId: 'sv8-141', tcg: 'pokemon',
    name: 'Pikachu ex', setCode: 'SV8', number: '141/191'
  };
  const app = runtime({
    getCatalog: () => ++catalogCalls === 1 ? firstRequest : Promise.resolve({ok: true, data: card})
  });
  await settle();
  app.setUser(userB);
  resolveFirst({ok: true, data: card});
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(app.writes.some(write => write.id === userId), false);
  assert.equal(app.writes.some(write => write.id === userB), true);
});
