'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const contractPath = path.join(
  repositoryRoot,
  'shared',
  'contracts',
  'openapi',
  'pokefolio-v1.json'
);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);

function operations() {
  const result = [];
  for (const [route, pathItem] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (httpMethods.has(method)) result.push({route, method, operation});
    }
  }
  return result;
}

function parameterName(parameter) {
  if (!parameter.$ref) return parameter.name;
  const name = parameter.$ref.split('/').at(-1);
  return contract.components.parameters[name].name;
}

function allParameters(route, operation) {
  return [
    ...(contract.paths[route].parameters || []),
    ...(operation.parameters || [])
  ];
}

function collectPropertyNames(value, names = []) {
  if (!value || typeof value !== 'object') return names;
  if (value.properties) names.push(...Object.keys(value.properties));
  for (const child of Object.values(value)) collectPropertyNames(child, names);
  return names;
}

test('API v1 is a parseable OpenAPI 3.1 contract with unique operations', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.deepEqual(contract.servers, [{url: '/api/v1'}]);
  const ids = operations().map(({operation}) => operation.operationId);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
});

test('all private operations inherit bearer authentication and never select a user id', () => {
  const publicOperations = new Set(['registerAccount', 'login', 'refreshSession']);
  assert.deepEqual(contract.security, [{bearerAuth: []}]);

  for (const {route, operation} of operations()) {
    if (publicOperations.has(operation.operationId)) {
      assert.deepEqual(operation.security, [], `${operation.operationId} must be explicitly public`);
    } else {
      assert.notDeepEqual(operation.security, [], `${operation.operationId} must stay authenticated`);
    }

    assert.doesNotMatch(route, /user[_-]?id/i);
    const parameters = allParameters(route, operation).map(parameterName);
    assert.ok(!parameters.some(name => /user[_-]?id/i.test(name)), route);
  }

  const requestSchemaNames = Object.entries(contract.components.schemas)
    .filter(([name]) => /Command$|Operation$|OperationBatch$/.test(name));
  for (const [schemaName, schema] of requestSchemaNames) {
    const names = collectPropertyNames(schema);
    assert.ok(!names.some(name => /user[_-]?id/i.test(name)), schemaName);
  }
});

test('collection writes define retry and optimistic-concurrency semantics', () => {
  const create = contract.paths['/collection'].post;
  const update = contract.paths['/collection/{holdingId}'].patch;
  const remove = contract.paths['/collection/{holdingId}'].delete;
  const delta = contract.paths['/collection/{holdingId}/quantity-delta'].post;

  assert.ok(allParameters('/collection', create).some(p => parameterName(p) === 'Idempotency-Key'));
  for (const operation of [update, remove]) {
    const names = allParameters('/collection/{holdingId}', operation).map(parameterName);
    assert.ok(names.includes('Idempotency-Key'));
    assert.ok(names.includes('If-Match'));
    assert.ok(operation.responses['400']);
    assert.ok(operation.responses['409']);
    assert.ok(operation.responses['412']);
  }

  assert.match(contract.components.parameters.IfMatch.description, /strong holding ETag/i);
  assert.equal(contract.components.parameters.IfMatch.schema.pattern, '^\\"v[1-9][0-9]*\\"$');

  const deltaNames = allParameters('/collection/{holdingId}/quantity-delta', delta).map(parameterName);
  assert.ok(deltaNames.includes('Idempotency-Key'));
  assert.match(
    contract.components.parameters.IdempotencyKey.description,
    /must equal the body operationId/i
  );
  assert.deepEqual(contract.components.schemas.QuantityDeltaCommand.required, ['operationId', 'delta']);
  assert.equal(contract.components.schemas.QuantityDeltaCommand.properties.delta.type, 'integer');
  assert.equal(contract.components.schemas.QuantityDeltaCommand.properties.delta.minimum, -10000);
  assert.equal(contract.components.schemas.QuantityDeltaCommand.properties.delta.maximum, 10000);
});

test('sync separates commutative deltas from versioned absolute edits and durable pulls', () => {
  const sync = contract.components.schemas.SyncOperation;
  const mappings = sync.discriminator.mapping;
  assert.deepEqual(Object.keys(mappings).sort(), [
    'holding.delete',
    'holding.quantityDelta',
    'holding.update'
  ]);

  const delta = contract.components.schemas.SyncQuantityDeltaOperation;
  assert.ok(delta.required.includes('delta'));
  assert.ok(!delta.required.includes('baseVersion'));

  const update = contract.components.schemas.SyncHoldingUpdateOperation;
  const remove = contract.components.schemas.SyncHoldingDeleteOperation;
  assert.ok(update.required.includes('baseVersion'));
  assert.ok(remove.required.includes('baseVersion'));

  const resultStatuses = contract.components.schemas.SyncOperationResult
    .properties.status.enum;
  assert.deepEqual(resultStatuses, ['applied', 'duplicate', 'conflict', 'rejected']);
  assert.ok(contract.paths['/sync/changes'].get);
  assert.ok(contract.components.schemas.ChangeEvent.required.includes('sequence'));
});

test('tokens and provider secrets are not represented as browser persistence fields', () => {
  const holdingProperties = collectPropertyNames(contract.components.schemas.CollectionHolding);
  assert.ok(!holdingProperties.some(name => /token|password|secret/i.test(name)));
  assert.ok(!Object.keys(contract.paths).some(route => /provider/i.test(route)));
});
