'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../app/src/main/assets/sync-core.js');

const ids = {
  operation1: '10000000-0000-0000-0000-000000000001',
  operation2: '10000000-0000-0000-0000-000000000002',
  operation3: '10000000-0000-0000-0000-000000000003',
  operation4: '10000000-0000-0000-0000-000000000004',
  holding1: '20000000-0000-0000-0000-000000000001',
  holding2: '20000000-0000-0000-0000-000000000002',
  holdingLetters: 'abcdefab-cdef-abcd-efab-cdefabcdefab',
  card1: '30000000-0000-0000-0000-000000000001'
};

function delta(operationId, holdingId = ids.holding1, value = 1) {
  return {operationId, kind: 'holding.quantityDelta', holdingId, delta: value};
}

function queued(operations) {
  return operations.reduce((state, operation, index) =>
    Sync.enqueue(state, operation, 1000 + index).state, Sync.createState());
}

test('validiert persistierten Zustand verlustfrei und lehnt unbekannte Felder ab', () => {
  const state = queued([delta(ids.operation1)]);
  state.cursor = 'cursor-1';
  state.lastSequence = 4;
  state.entityVersions['holding:' + ids.holding1] = 2;

  assert.deepEqual(Sync.createState(JSON.parse(JSON.stringify(state))), state);
  assert.throws(() => Sync.createState({...state, accessToken: 'secret'}), /unsupported property accessToken/);
  assert.throws(() => Sync.createState({...state, schemaVersion: 99}), /schemaVersion/);
});

test('dedupliziert identische Offline-Operationen und blockiert Operation-ID-Wiederverwendung', () => {
  const first = Sync.enqueue(Sync.createState(), delta(ids.operation1), 1000);
  const duplicate = Sync.enqueue(first.state, delta(ids.operation1), 2000);
  assert.equal(first.queued, true);
  assert.equal(duplicate.queued, false);
  assert.equal(duplicate.state.pending.length, 1);
  assert.throws(() => Sync.enqueue(
    duplicate.state,
    delta(ids.operation1, ids.holding1, 2),
    3000
  ), /different content/);
  assert.throws(() => Sync.enqueue(
    duplicate.state,
    {...delta(ids.operation2), userId: ids.card1},
    3000
  ), /unsupported property userId/);
});

test('normalisiert alle vier Sync-Operationen exakt gemäß API-Vertrag', () => {
  const operations = [
    {
      operationId: ids.operation1,
      kind: 'holding.create',
      holding: {
        id: ids.holding1,
        cardId: ids.card1,
        variantId: null,
        language: 'de',
        variant: 'normal',
        condition: 'near-mint',
        quantity: 1,
        notes: null
      }
    },
    delta(ids.operation2),
    {
      operationId: ids.operation3,
      kind: 'holding.update',
      holdingId: ids.holding1,
      baseVersion: 2,
      changes: {notes: null, condition: 'excellent'}
    },
    {
      operationId: ids.operation4,
      kind: 'holding.delete',
      holdingId: ids.holding1,
      baseVersion: 3
    }
  ];
  const state = queued(operations);
  assert.deepEqual(Sync.nextBatch(state, 5000), operations);
});

test('liefert höchstens 100 strikt geordnete und fällige Operationen', () => {
  const operations = Array.from({length: 101}, (_, index) => delta(
    `10000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`
  ));
  const state = queued(operations);
  assert.equal(Sync.nextBatch(state, 5000).length, 100);

  state.pending[0].nextAttemptAt = 6000;
  assert.deepEqual(Sync.nextBatch(state, 5000), []);
  assert.equal(Sync.nextBatch(state, 6000, 2)[1].operationId, operations[1].operationId);
});

test('verarbeitet Push-Ergebnisse nur vollständig und in Request-Reihenfolge', () => {
  const operations = [
    delta(ids.operation1),
    delta(ids.operation2),
    delta(ids.operation3),
    delta(ids.operation4)
  ];
  const state = queued(operations);
  const response = {results: [
    {operationId: ids.operation1, status: 'applied', entity: {id: ids.holding1}, problem: null},
    {operationId: ids.operation2, status: 'duplicate', entity: {id: ids.holding1}, problem: null},
    {operationId: ids.operation3, status: 'conflict', entity: null,
      problem: {code: 'quantity_conflict'}},
    {operationId: ids.operation4, status: 'rejected', entity: null,
      problem: {code: 'holding_not_found'}}
  ]};

  const reconciled = Sync.reconcilePush(state, operations, response, 9000);
  assert.deepEqual(reconciled.summary, {applied: 1, duplicate: 1, conflict: 1, rejected: 1});
  assert.equal(reconciled.state.pending.length, 0);
  assert.equal(reconciled.state.conflicts[0].operation.operationId, ids.operation3);
  assert.equal(reconciled.state.rejected[0].problem.code, 'holding_not_found');
  assert.equal(state.pending.length, 4, 'input state remains unchanged until caller persists the result');

  const outOfOrder = {results: response.results.slice().reverse()};
  assert.throws(() => Sync.reconcilePush(state, operations, outOfOrder, 9000), /order/);
  assert.equal(state.pending.length, 4);
});

test('setzt begrenzten exponentiellen Retry mit Jitter und blockiert Überholen', () => {
  const operations = [delta(ids.operation1), delta(ids.operation2)];
  const state = queued(operations);
  const failed = Sync.markBatchFailed(state, operations, 10000, {
    baseMs: 1000,
    maximumMs: 8000,
    jitterRatio: 0.2,
    random: () => 0.5
  });
  assert.equal(failed.pending[0].attemptCount, 1);
  assert.equal(failed.pending[0].nextAttemptAt, 11000);
  assert.deepEqual(Sync.nextBatch(failed, 10999), []);
  assert.equal(Sync.nextBatch(failed, 11000).length, 2);

  const failedAgain = Sync.markBatchFailed(failed, operations, 12000, {
    baseMs: 1000,
    maximumMs: 8000,
    jitterRatio: 0,
    random: () => 0
  });
  assert.equal(failedAgain.pending[0].attemptCount, 2);
  assert.equal(failedAgain.pending[0].nextAttemptAt, 14000);
});

test('wendet Change-Seiten atomar an und verhindert Wiederauferstehung nach Tombstone', () => {
  const initial = Sync.createState();
  const upsert = {
    sequence: 2,
    entityType: 'holding',
    entityId: ids.holding1,
    action: 'upsert',
    version: 1,
    payload: {id: ids.holding1, quantity: 2, version: 1},
    occurredAt: '2026-09-10T00:00:00Z'
  };
  const removed = {
    sequence: 5,
    entityType: 'holding',
    entityId: ids.holding1,
    action: 'delete',
    version: 2,
    payload: null,
    occurredAt: '2026-09-10T00:01:00Z'
  };
  const first = Sync.applyChangePage(initial, {}, {
    changes: [upsert, removed],
    nextCursor: 'cursor-5',
    hasMore: false
  });
  assert.equal(first.applied, 2);
  assert.equal(first.entities['holding:' + ids.holding1], undefined);
  assert.equal(first.state.entityVersions['holding:' + ids.holding1], 2);
  assert.equal(first.state.lastSequence, 5);

  const stale = Sync.applyChangePage(first.state, first.entities, {
    changes: [{...upsert, sequence: 8}],
    nextCursor: 'cursor-8',
    hasMore: false
  });
  assert.equal(stale.applied, 0);
  assert.equal(stale.ignored, 1);
  assert.equal(stale.entities['holding:' + ids.holding1], undefined);
  assert.equal(stale.state.cursor, 'cursor-8');
});

test('kanonisiert lokale Entity-Keys bevor Versionen oder Tombstones verglichen werden', () => {
  const state = Sync.createState();
  state.entityVersions['HOLDING:' + ids.holdingLetters.toUpperCase()] = 1;
  const entities = {
    ['HOLDING:' + ids.holdingLetters.toUpperCase()]: {id: ids.holdingLetters, version: 1}
  };
  const result = Sync.applyChangePage(state, entities, {
    changes: [{
      sequence: 2,
      entityType: 'holding',
      entityId: ids.holdingLetters,
      action: 'delete',
      version: 2,
      payload: null,
      occurredAt: '2026-09-10T00:00:00Z'
    }],
    nextCursor: 'cursor-2',
    hasMore: false
  });
  const canonicalKey = 'holding:' + ids.holdingLetters;
  assert.equal(result.entities[canonicalKey], undefined);
  assert.equal(result.state.entityVersions[canonicalKey], 2);
  assert.deepEqual(Object.keys(result.state.entityVersions), [canonicalKey]);
});

test('lehnt lückenhafte oder nicht monotone Change-Seiten ohne Zustandsänderung ab', () => {
  const state = Sync.createState();
  const entities = {};
  const invalid = {
    changes: [
      {sequence: 2, entityType: 'holding', entityId: ids.holding1, action: 'delete',
        version: 2, payload: null, occurredAt: '2026-09-10T00:00:00Z'},
      {sequence: 2, entityType: 'holding', entityId: ids.holding2, action: 'delete',
        version: 1, payload: null, occurredAt: '2026-09-10T00:00:01Z'}
    ],
    nextCursor: 'cursor-2',
    hasMore: false
  };
  assert.throws(() => Sync.applyChangePage(state, entities, invalid), /strictly increasing/);
  assert.deepEqual(state, Sync.createState());
  assert.deepEqual(entities, {});
  assert.throws(() => Sync.applyChangePage(state, entities,
    {changes: [], nextCursor: 'cursor', hasMore: true}), /cannot have more/);
  assert.throws(() => Sync.applyChangePage(state, entities, {
    changes: [{
      sequence: 3,
      entityType: 'holding',
      entityId: ids.holding1,
      action: 'upsert',
      version: 2,
      payload: {id: ids.holding2, version: 2},
      occurredAt: '2026-09-10T00:00:00Z'
    }],
    nextCursor: 'cursor-3',
    hasMore: false
  }), /payload id/);
});
