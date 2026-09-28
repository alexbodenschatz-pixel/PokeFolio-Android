'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Migration = require('../app/src/main/assets/account-migration-core.js');

const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const cardId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const existingHoldingId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function localCard(overrides = {}) {
  return {
    id: 17,
    collectionKey: 'pokemon|sv03|025|de|reverse-holo',
    tcg: 'pokemon',
    name: 'Pikachu',
    set: '151',
    setId: 'sv03',
    number: '025/165',
    lang: 'de',
    printingVariant: 'reverse-holo',
    condition: 'near-mint',
    quantity: 3,
    collectionNotes: 'Erste lokale Sammlung',
    source: 'TCGdex de',
    ...overrides
  };
}

test('Provider-Referenzen bleiben bei neuen Kandidaten exakt und sind für Altbestände ableitbar', () => {
  assert.deepEqual(Migration.referenceForCandidate({
    tcg: 'pokemon', id: 'tcgdex:sv03-025', name: 'Pikachu', setId: 'sv03',
    number: '025/165', source: 'TCGdex de'
  }), {
    provider: 'tcgdex', providerCardId: 'sv03-025', tcg: 'pokemon', name: 'Pikachu',
    setCode: 'sv03', number: '025/165'
  });
  assert.deepEqual(Migration.referenceForLegacy(localCard()), {
    provider: 'tcgdex', providerCardId: 'sv03-025', tcg: 'pokemon', name: 'Pikachu',
    setCode: 'sv03', number: '025/165'
  });
});

test('deterministische UUIDv8 entspricht SHA-256 und bleibt über Wiederholungen stabil', () => {
  const seed = 'pokefolio migration äöü';
  const bytes = [...crypto.createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16)];
  bytes[6] = bytes[6] & 0x0f | 0x80;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
  const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

  assert.equal(Migration.deterministicUuid(seed), expected);
  assert.equal(Migration.deterministicUuid(seed), Migration.deterministicUuid(seed));
  assert.match(expected, /^[0-9a-f-]{36}$/);
  assert.equal(expected[14], '8');
});

test('Migrationsplan ist kontogebunden, idempotent und bewahrt nicht migrierbare Karten', () => {
  const collection = [localCard(), localCard({
    id: 18,
    collectionKey: 'legacy|unknown|18',
    tcg: 'unknown',
    setId: '',
    number: '',
    name: 'Manueller Altbestand'
  })];
  const first = Migration.createPlan(collection, userA, 1000);
  const second = Migration.createPlan(collection, userA, 2000);

  assert.equal(first.entries.length, 1);
  assert.equal(first.skipped.length, 1);
  assert.equal(first.entries[0].holdingId, second.entries[0].holdingId);
  assert.equal(first.entries[0].createOperationId, second.entries[0].createOperationId);
  assert.notEqual(first.entries[0].holdingId,
    Migration.createPlan(collection, userB, 1000).entries[0].holdingId);
  assert.equal(Migration.summarize(first).quantity, 3);
  assert.throws(() => Migration.parsePlan(JSON.stringify(first), userB), /another account/);
  assert.deepEqual(Migration.parsePlan(JSON.stringify(first), userA), first);
});

test('lokale Sammlungsbereiche trennen Besitzer, weitere Konten und abgemeldete Gäste', () => {
  assert.equal(Migration.collectionStorageKey('', ''), 'pf_collection');
  assert.equal(Migration.collectionStorageKey(userA, ''), `pf_collection_account_v1:${userA}`,
    'an unclaimed legacy collection is never shown as an authenticated account collection');
  assert.equal(Migration.collectionStorageKey(userA, userA), 'pf_collection');
  assert.equal(Migration.collectionStorageKey(userB, userA), `pf_collection_account_v1:${userB}`);
  assert.equal(Migration.collectionStorageKey('', userA), 'pf_collection_guest_v1');
  assert.equal(Migration.migrationCollectionStorageKey(userA, ''), 'pf_collection');
  assert.equal(Migration.migrationCollectionStorageKey(userA, userA), 'pf_collection');
  assert.equal(Migration.migrationCollectionStorageKey(userB, userA),
    `pf_collection_account_v1:${userB}`);
});

test('neuer Cloud-Bestand erzeugt Create, vorhandene Identität atomaren Quantity-Delta', () => {
  const entry = Migration.createPlan([localCard()], userA, 1000).entries[0];
  const create = Migration.buildOperation(entry, cardId, []);
  assert.deepEqual(create, {
    operationId: entry.createOperationId,
    kind: 'holding.create',
    holding: {
      id: entry.holdingId,
      cardId,
      variantId: null,
      language: 'de',
      variant: 'reverse-holo',
      condition: 'near-mint',
      quantity: 3,
      notes: 'Erste lokale Sammlung'
    }
  });

  const merge = Migration.buildOperation(entry, cardId, [{
    id: existingHoldingId,
    cardId,
    variantId: null,
    language: 'de',
    variant: 'reverse-holo',
    condition: 'near-mint',
    quantity: 4
  }]);
  assert.deepEqual(merge, {
    operationId: entry.mergeOperationId,
    kind: 'holding.quantityDelta',
    holdingId: existingHoldingId,
    delta: 3
  });

  const replay = Migration.buildOperation(entry, cardId, [{
    ...create.holding,
    version: 1
  }]);
  assert.deepEqual(replay, create, 'a rerun must replay create instead of adding quantity twice');
});

test('manipulierte Pläne und nicht unterstützte Sprachen scheitern geschlossen', () => {
  const plan = Migration.createPlan([localCard()], userA, 1000);
  assert.equal(Migration.createPlan([localCard({lang: 'xx'})], userA, 1000).entries.length, 0);
  assert.throws(() => Migration.parsePlan(JSON.stringify({...plan, accessToken: 'secret'}), userA),
    /unsupported properties/);
  const changed = JSON.parse(JSON.stringify(plan));
  changed.entries[0].holdingId = 'not-a-uuid';
  assert.throws(() => Migration.parsePlan(changed, userA), /UUID/);

  const destructive = Migration.createPlan([localCard()], userA, 1000);
  destructive.entries[0].operation = {
    operationId: destructive.entries[0].createOperationId,
    kind: 'holding.delete',
    holdingId: destructive.entries[0].holdingId,
    baseVersion: 1
  };
  assert.throws(() => Migration.parsePlan(destructive, userA), /forbidden operation/);
});
