'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Cloud = require('../app/src/main/assets/collection-cloud-core.js');

const holdingId = '10000000-0000-0000-0000-000000000001';
const holdingId2 = '10000000-0000-0000-0000-000000000002';
const cardId = '20000000-0000-0000-0000-000000000001';

function holding(overrides = {}) {
  return {
    id: holdingId,
    cardId,
    variantId: null,
    language: 'de',
    variant: 'normal',
    condition: 'near-mint',
    quantity: 4,
    notes: 'Cloud-Notiz',
    version: 3,
    createdAt: '2026-09-21T10:00:00Z',
    updatedAt: '2026-09-21T10:05:00Z',
    ...overrides
  };
}

function catalog(overrides = {}) {
  return {
    id: cardId,
    provider: 'tcgdex',
    providerCardId: 'sv8-141',
    tcg: 'pokemon',
    name: 'Pikachu ex',
    setCode: 'SV8',
    number: '141/191',
    ...overrides
  };
}

function local(overrides = {}) {
  return {
    id: 42,
    tcg: 'pokemon',
    name: 'Pikachu ex',
    setId: 'SV8',
    number: '141/191',
    lang: 'de',
    printingVariant: 'normal',
    condition: 'near-mint',
    quantity: 2,
    image: 'data:image/jpeg;base64,local',
    favorite: true,
    collectionNotes: 'Cloud-Notiz',
    catalogReference: {
      provider: 'tcgdex', providerCardId: 'sv8-141', tcg: 'pokemon',
      name: 'Pikachu ex', setCode: 'SV8', number: '141/191'
    },
    ...overrides
  };
}

test('Cloud-Hydrierung verknüpft migrierten Bestand und erhält lokale Rich-Metadaten', () => {
  const result = Cloud.hydrate([local()], [holding()], [catalog()]);

  assert.equal(result.unresolvedCardIds.length, 0);
  assert.equal(result.collection.length, 1);
  assert.equal(result.collection[0].id, 42);
  assert.equal(result.collection[0].image, 'data:image/jpeg;base64,local');
  assert.equal(result.collection[0].favorite, true);
  assert.equal(result.collection[0].quantity, 4);
  assert.equal(result.collection[0].cloudHoldingId, holdingId);
  assert.equal(result.collection[0].cloudCardId, cardId);
  assert.equal(result.collection[0].cloudVersion, 3);
  assert.equal(result.collection[0].cloudDirty, false);
});

test('Zweites Gerät materialisiert Kartenmetadaten und entfernt nur veraltete Cloud-Einträge', () => {
  const stale = local({
    id: 'stale',
    cloudHoldingId: holdingId2,
    cloudCardId: '20000000-0000-0000-0000-000000000002',
    cloudVersion: 1
  });
  const unsynced = local({id: 'local-only', catalogReference: null, name: 'Lokaler Altbestand'});
  const result = Cloud.hydrate([stale, unsynced], [holding()], [catalog()]);

  assert.equal(result.collection.length, 2);
  const cloud = result.collection.find(entry => entry.cloudHoldingId === holdingId);
  assert.equal(cloud.id, holdingId);
  assert.equal(cloud.name, 'Pikachu ex');
  assert.equal(cloud.setCode, 'SV8');
  assert.equal(cloud.quantity, 4);
  assert.equal(result.collection.some(entry => entry.id === 'stale'), false);
  assert.equal(result.collection.some(entry => entry.id === 'local-only'), true);
});

test('Lokale versionierte Änderung wird bei konkurrierendem Cloud-Stand nicht überschrieben', () => {
  const existing = local({
    cloudHoldingId: holdingId,
    cloudCardId: cardId,
    cloudVersion: 2,
    cloudLanguage: 'de',
    cloudVariant: 'normal',
    cloudCondition: 'near-mint',
    cloudNotes: 'Vorher',
    collectionNotes: 'Lokaler Entwurf'
  });
  const result = Cloud.hydrate([existing], [holding({notes: 'Anderes Gerät', version: 3})], [catalog()]);

  assert.equal(result.collection[0].collectionNotes, 'Lokaler Entwurf');
  assert.equal(result.collection[0].cloudNotes, 'Anderes Gerät');
  assert.equal(result.collection[0].cloudDirty, true);
  assert.equal(result.collection[0].cloudConflict, true);
});

test('Nullbestand wird ausgeblendet und fehlende Katalogkarten bleiben explizit ungelöst', () => {
  const empty = Cloud.hydrate([local({cloudHoldingId: holdingId, cloudCardId: cardId})],
    [holding({quantity: 0})], [catalog()]);
  assert.equal(empty.collection.length, 0);

  const unresolved = Cloud.hydrate([], [holding()], []);
  assert.deepEqual(unresolved.unresolvedCardIds, [cardId]);
  assert.equal(unresolved.collection.length, 0);
});

test('Beschädigter Cloud-Datensatz lässt den vollständigen lokalen Cache unverändert', () => {
  const existing = local({cloudHoldingId: holdingId, cloudCardId: cardId, cloudVersion: 1});
  const result = Cloud.hydrate([existing], [{...holding(), cardId: 'invalid'}], [catalog()]);

  assert.equal(result.ignoredHoldings, 1);
  assert.equal(result.changed, false);
  assert.deepEqual(result.collection, [existing]);
});

test('Sammlungsdiff erzeugt versioniertes Update vor atomarem Mengendelta', () => {
  const before = local({
    cloudHoldingId: holdingId,
    cloudCardId: cardId,
    cloudVersion: 7,
    quantity: 2,
    collectionNotes: 'Alt'
  });
  const after = {...before, quantity: 5, collectionNotes: 'Neu'};
  let sequence = 0;
  const ids = [
    '30000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002'
  ];
  const operations = Cloud.createOperations([before], [after], () => ids[sequence++]);

  assert.deepEqual(operations, [{
    operationId: ids[0],
    kind: 'holding.update',
    holdingId,
    baseVersion: 7,
    changes: {notes: 'Neu'}
  }, {
    operationId: ids[1],
    kind: 'holding.quantityDelta',
    holdingId,
    delta: 3
  }]);
});

test('Große vollständige Entfernung wird verlustfrei in begrenzte Deltas zerlegt', () => {
  const before = local({
    cloudHoldingId: holdingId,
    cloudCardId: cardId,
    cloudVersion: 7,
    quantity: 25001
  });
  let sequence = 0;
  const operations = Cloud.createOperations([before], [], () =>
    `30000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`);

  assert.deepEqual(operations.map(operation => operation.delta), [-10000, -10000, -5001]);
});

test('Doppelte Cloud-Holding-Zuordnung wird vor dem Queue-Schreiben abgelehnt', () => {
  const entry = local({cloudHoldingId: holdingId, cloudCardId: cardId, cloudVersion: 1});
  assert.throws(() => Cloud.createOperations([entry, {...entry, id: 99}], [], () =>
    '30000000-0000-0000-0000-000000000001'), /duplicate cloud holding/);
});
