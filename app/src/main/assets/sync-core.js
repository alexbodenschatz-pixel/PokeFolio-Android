(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MAX_BATCH_SIZE = 100;
  const MAX_PENDING_OPERATIONS = 10000;
  const MAX_CHANGE_PAGE = 500;
  const operationKinds = new Set([
    'holding.create',
    'holding.quantityDelta',
    'holding.update',
    'holding.delete'
  ]);
  const resultStatuses = new Set(['applied', 'duplicate', 'conflict', 'rejected']);
  const languages = new Set(['de', 'en', 'ja', 'fr', 'it', 'es', 'ko', 'zh-Hans', 'zh-Hant']);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const entityTypePattern = /^[a-z][a-z0-9.-]{0,79}$/;

  function fail(message) {
    throw new TypeError(message);
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (isObject(value)) {
      return '{' + Object.keys(value).sort().map(key =>
        JSON.stringify(key) + ':' + stableStringify(value[key])
      ).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function requireExactKeys(value, allowed, label) {
    if (!isObject(value)) fail(label + ' must be an object.');
    const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
    if (unexpected.length) fail(label + ' contains unsupported property ' + unexpected[0] + '.');
  }

  function requireUuid(value, label) {
    if (typeof value !== 'string' || !uuidPattern.test(value)
        || value.toLowerCase() === '00000000-0000-0000-0000-000000000000') {
      fail(label + ' must be a non-empty UUID.');
    }
    return value.toLowerCase();
  }

  function requireInteger(value, minimum, maximum, label) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      fail(label + ' is outside the supported integer range.');
    }
    return value;
  }

  function requireTimestamp(value, label) {
    return requireInteger(value, 0, Number.MAX_SAFE_INTEGER, label);
  }

  function requireText(value, maximum, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
      fail(label + ' must be non-empty text within the supported length.');
    }
    return value;
  }

  function normalizeEntityKey(value, label) {
    if (typeof value !== 'string') fail(label + ' must be text.');
    const separator = value.lastIndexOf(':');
    const entityType = value.slice(0, separator).toLowerCase();
    if (separator < 1 || !entityTypePattern.test(entityType)) {
      fail(label + ' contains an invalid entity type.');
    }
    return entityType + ':' + requireUuid(value.slice(separator + 1), label + ' entity id');
  }

  function normalizeEntities(value) {
    if (!isObject(value)) fail('synced entities must be an object.');
    const entities = {};
    Object.entries(value).forEach(([key, payload]) => {
      const canonicalKey = normalizeEntityKey(key, 'synced entity key');
      if (Object.prototype.hasOwnProperty.call(entities, canonicalKey)) {
        fail('synced entities contain duplicate canonical keys.');
      }
      if (!isObject(payload)) fail('synced entity payloads must be objects.');
      entities[canonicalKey] = clone(payload);
    });
    return entities;
  }

  function normalizeHolding(value) {
    const allowed = ['id', 'cardId', 'variantId', 'language', 'variant', 'condition', 'quantity', 'notes'];
    requireExactKeys(value, allowed, 'holding');
    const holding = {
      id: requireUuid(value.id, 'holding.id'),
      cardId: requireUuid(value.cardId, 'holding.cardId'),
      language: value.language,
      variant: requireText(value.variant, 80, 'holding.variant'),
      condition: requireText(value.condition, 40, 'holding.condition'),
      quantity: requireInteger(value.quantity, 1, 1000000, 'holding.quantity')
    };
    if (!languages.has(value.language)) fail('holding.language is not supported.');
    if (value.variantId !== undefined) {
      holding.variantId = value.variantId === null
        ? null
        : requireUuid(value.variantId, 'holding.variantId');
    }
    if (value.notes !== undefined) {
      if (value.notes !== null && (typeof value.notes !== 'string' || value.notes.length > 10000)) {
        fail('holding.notes is outside the supported length.');
      }
      holding.notes = value.notes;
    }
    return holding;
  }

  function normalizeChanges(value) {
    const allowed = ['language', 'variant', 'condition', 'notes'];
    requireExactKeys(value, allowed, 'changes');
    if (!Object.keys(value).length) fail('changes must contain at least one property.');
    const changes = {};
    if (value.language !== undefined) {
      if (!languages.has(value.language)) fail('changes.language is not supported.');
      changes.language = value.language;
    }
    if (value.variant !== undefined) changes.variant = requireText(value.variant, 80, 'changes.variant');
    if (value.condition !== undefined) {
      changes.condition = requireText(value.condition, 40, 'changes.condition');
    }
    if (value.notes !== undefined) {
      if (value.notes !== null && (typeof value.notes !== 'string' || value.notes.length > 10000)) {
        fail('changes.notes is outside the supported length.');
      }
      changes.notes = value.notes;
    }
    return changes;
  }

  function normalizeOperation(value) {
    if (!isObject(value) || !operationKinds.has(value.kind)) {
      fail('operation.kind is not supported.');
    }
    const operationId = requireUuid(value.operationId, 'operation.operationId');
    if (value.kind === 'holding.create') {
      requireExactKeys(value, ['operationId', 'kind', 'holding'], 'holding.create');
      return {operationId, kind: value.kind, holding: normalizeHolding(value.holding)};
    }
    if (value.kind === 'holding.quantityDelta') {
      requireExactKeys(value, ['operationId', 'kind', 'holdingId', 'delta'], 'holding.quantityDelta');
      const delta = requireInteger(value.delta, -10000, 10000, 'holding.quantityDelta.delta');
      if (delta === 0) fail('holding.quantityDelta.delta must not be zero.');
      return {
        operationId,
        kind: value.kind,
        holdingId: requireUuid(value.holdingId, 'holding.quantityDelta.holdingId'),
        delta
      };
    }
    if (value.kind === 'holding.update') {
      requireExactKeys(value, ['operationId', 'kind', 'holdingId', 'baseVersion', 'changes'], 'holding.update');
      return {
        operationId,
        kind: value.kind,
        holdingId: requireUuid(value.holdingId, 'holding.update.holdingId'),
        baseVersion: requireInteger(value.baseVersion, 1, Number.MAX_SAFE_INTEGER, 'holding.update.baseVersion'),
        changes: normalizeChanges(value.changes)
      };
    }
    requireExactKeys(value, ['operationId', 'kind', 'holdingId', 'baseVersion'], 'holding.delete');
    return {
      operationId,
      kind: value.kind,
      holdingId: requireUuid(value.holdingId, 'holding.delete.holdingId'),
      baseVersion: requireInteger(value.baseVersion, 1, Number.MAX_SAFE_INTEGER, 'holding.delete.baseVersion')
    };
  }

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      cursor: '',
      lastSequence: 0,
      pending: [],
      conflicts: [],
      rejected: [],
      entityVersions: {}
    };
  }

  function normalizeResolution(value, label) {
    requireExactKeys(value, ['operation', 'problem', 'recordedAt'], label);
    if (value.problem !== null && value.problem !== undefined && !isObject(value.problem)) {
      fail(label + '.problem must be an object or null.');
    }
    return {
      operation: normalizeOperation(value.operation),
      problem: value.problem == null ? null : clone(value.problem),
      recordedAt: requireTimestamp(value.recordedAt, label + '.recordedAt')
    };
  }

  function createState(raw) {
    if (raw === undefined || raw === null) return emptyState();
    requireExactKeys(raw,
      ['schemaVersion', 'cursor', 'lastSequence', 'pending', 'conflicts', 'rejected', 'entityVersions'],
      'sync state');
    if (raw.schemaVersion !== SCHEMA_VERSION) fail('sync state schemaVersion is not supported.');
    if (typeof raw.cursor !== 'string') fail('sync state cursor must be text.');
    requireInteger(raw.lastSequence, 0, Number.MAX_SAFE_INTEGER, 'sync state lastSequence');
    if (!Array.isArray(raw.pending) || raw.pending.length > MAX_PENDING_OPERATIONS) {
      fail('sync state pending queue is invalid or too large.');
    }
    if (!Array.isArray(raw.conflicts) || raw.conflicts.length > MAX_PENDING_OPERATIONS
        || !Array.isArray(raw.rejected) || raw.rejected.length > MAX_PENDING_OPERATIONS) {
      fail('sync state resolution history is invalid.');
    }
    if (!isObject(raw.entityVersions)) fail('sync state entityVersions must be an object.');

    const pending = raw.pending.map((entry, index) => {
      requireExactKeys(entry, ['operation', 'enqueuedAt', 'attemptCount', 'nextAttemptAt'],
        'pending[' + index + ']');
      return {
        operation: normalizeOperation(entry.operation),
        enqueuedAt: requireTimestamp(entry.enqueuedAt, 'pending[' + index + '].enqueuedAt'),
        attemptCount: requireInteger(entry.attemptCount, 0, 1000, 'pending[' + index + '].attemptCount'),
        nextAttemptAt: requireTimestamp(entry.nextAttemptAt, 'pending[' + index + '].nextAttemptAt')
      };
    });
    const operationIds = new Set();
    pending.forEach(entry => {
      if (operationIds.has(entry.operation.operationId)) fail('sync state contains duplicate operation ids.');
      operationIds.add(entry.operation.operationId);
    });

    const entityVersions = {};
    Object.entries(raw.entityVersions).forEach(([key, version]) => {
      const canonicalKey = normalizeEntityKey(key, 'sync state entity version key');
      if (Object.prototype.hasOwnProperty.call(entityVersions, canonicalKey)) {
        fail('sync state contains duplicate canonical entity version keys.');
      }
      entityVersions[canonicalKey] = requireInteger(
        version, 1, Number.MAX_SAFE_INTEGER, 'sync state entity version');
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      cursor: raw.cursor,
      lastSequence: raw.lastSequence,
      pending,
      conflicts: raw.conflicts.map((value, index) =>
        normalizeResolution(value, 'conflicts[' + index + ']')),
      rejected: raw.rejected.map((value, index) =>
        normalizeResolution(value, 'rejected[' + index + ']')),
      entityVersions
    };
  }

  function enqueue(state, operation, now) {
    const next = createState(state);
    const normalized = normalizeOperation(operation);
    const existing = next.pending.find(entry => entry.operation.operationId === normalized.operationId);
    if (existing) {
      if (stableStringify(existing.operation) !== stableStringify(normalized)) {
        fail('operationId is already queued with different content.');
      }
      return {state: next, queued: false};
    }
    if (next.pending.length >= MAX_PENDING_OPERATIONS) fail('offline operation queue is full.');
    next.pending.push({
      operation: normalized,
      enqueuedAt: requireTimestamp(now, 'enqueue time'),
      attemptCount: 0,
      nextAttemptAt: 0
    });
    return {state: next, queued: true};
  }

  function nextBatch(state, now, limit) {
    const current = createState(state);
    const timestamp = requireTimestamp(now, 'batch time');
    const maximum = requireInteger(
      limit === undefined ? MAX_BATCH_SIZE : limit, 1, MAX_BATCH_SIZE, 'batch limit');
    const operations = [];
    for (const entry of current.pending) {
      if (entry.nextAttemptAt > timestamp || operations.length >= maximum) break;
      operations.push(clone(entry.operation));
    }
    return operations;
  }

  function assertBatchPrefix(state, operations) {
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_BATCH_SIZE) {
      fail('batch must contain 1 to 100 operations.');
    }
    const normalized = operations.map(normalizeOperation);
    if (state.pending.length < normalized.length) fail('batch is not present in the pending queue.');
    normalized.forEach((operation, index) => {
      if (stableStringify(state.pending[index].operation) !== stableStringify(operation)) {
        fail('batch does not match the ordered pending queue.');
      }
    });
    return normalized;
  }

  function normalizeResult(value, index) {
    requireExactKeys(value, ['operationId', 'status', 'entity', 'problem'], 'results[' + index + ']');
    const operationId = requireUuid(value.operationId, 'results[' + index + '].operationId');
    if (!resultStatuses.has(value.status)) fail('results[' + index + '].status is not supported.');
    if (value.entity !== null && value.entity !== undefined && !isObject(value.entity)) {
      fail('results[' + index + '].entity must be an object or null.');
    }
    if (value.problem !== null && value.problem !== undefined && !isObject(value.problem)) {
      fail('results[' + index + '].problem must be an object or null.');
    }
    if ((value.status === 'applied' || value.status === 'duplicate') && value.problem != null) {
      fail('successful sync results cannot contain a problem.');
    }
    if ((value.status === 'conflict' || value.status === 'rejected') && !isObject(value.problem)) {
      fail('failed sync results must contain a problem.');
    }
    return {
      operationId,
      status: value.status,
      entity: value.entity == null ? null : clone(value.entity),
      problem: value.problem == null ? null : clone(value.problem)
    };
  }

  function reconcilePush(state, operations, response, now) {
    const current = createState(state);
    const batch = assertBatchPrefix(current, operations);
    requireExactKeys(response, ['results'], 'sync response');
    if (!Array.isArray(response.results) || response.results.length !== batch.length) {
      fail('sync response must contain one ordered result per operation.');
    }
    const results = response.results.map(normalizeResult);
    results.forEach((result, index) => {
      if (result.operationId !== batch[index].operationId) {
        fail('sync response operation order does not match the request.');
      }
    });

    const recordedAt = requireTimestamp(now, 'reconcile time');
    const summary = {applied: 0, duplicate: 0, conflict: 0, rejected: 0};
    const newConflictCount = results.filter(result => result.status === 'conflict').length;
    const newRejectedCount = results.filter(result => result.status === 'rejected').length;
    if (current.conflicts.length + newConflictCount > MAX_PENDING_OPERATIONS
        || current.rejected.length + newRejectedCount > MAX_PENDING_OPERATIONS) {
      fail('sync resolution history is full and must be reviewed before continuing.');
    }
    results.forEach((result, index) => {
      summary[result.status]++;
      if (result.status === 'conflict' || result.status === 'rejected') {
        current[result.status === 'conflict' ? 'conflicts' : 'rejected'].push({
          operation: batch[index],
          problem: result.problem,
          recordedAt
        });
      }
    });
    current.pending = current.pending.slice(batch.length);
    return {state: current, results, summary};
  }

  function retryDelay(attemptCount, options) {
    const settings = options || {};
    const baseMs = requireInteger(settings.baseMs === undefined ? 1000 : settings.baseMs,
      1, 60000, 'retry base');
    const maximumMs = requireInteger(settings.maximumMs === undefined ? 300000 : settings.maximumMs,
      baseMs, 3600000, 'retry maximum');
    const jitterRatio = settings.jitterRatio === undefined ? 0.2 : Number(settings.jitterRatio);
    if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
      fail('retry jitter ratio must be between zero and one.');
    }
    const random = settings.random || Math.random;
    const randomValue = Number(random());
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
      fail('retry random source must return a value between zero and one.');
    }
    const exponential = Math.min(maximumMs, baseMs * Math.pow(2, Math.min(20, attemptCount - 1)));
    const jitter = exponential * jitterRatio * (randomValue * 2 - 1);
    return Math.max(1, Math.round(exponential + jitter));
  }

  function markBatchFailed(state, operations, now, options) {
    const current = createState(state);
    const batch = assertBatchPrefix(current, operations);
    const timestamp = requireTimestamp(now, 'failure time');
    batch.forEach((operation, index) => {
      const entry = current.pending[index];
      entry.attemptCount = requireInteger(
        entry.attemptCount + 1, 1, 1000, 'pending attempt count');
      entry.nextAttemptAt = timestamp + retryDelay(entry.attemptCount, options);
    });
    return current;
  }

  function normalizeChangePage(state, page) {
    requireExactKeys(page, ['changes', 'nextCursor', 'hasMore'], 'change page');
    if (!Array.isArray(page.changes) || page.changes.length > MAX_CHANGE_PAGE) {
      fail('change page contains too many changes.');
    }
    if (typeof page.nextCursor !== 'string' || !page.nextCursor) {
      fail('change page nextCursor must be non-empty text.');
    }
    if (typeof page.hasMore !== 'boolean') fail('change page hasMore must be boolean.');
    if (page.hasMore && page.changes.length === 0) fail('an empty change page cannot have more results.');
    let sequence = state.lastSequence;
    const changes = page.changes.map((value, index) => {
      requireExactKeys(value,
        ['sequence', 'entityType', 'entityId', 'action', 'version', 'payload', 'occurredAt'],
        'changes[' + index + ']');
      const nextSequence = requireInteger(
        value.sequence, 1, Number.MAX_SAFE_INTEGER, 'changes[' + index + '].sequence');
      if (nextSequence <= sequence) fail('change sequences must be strictly increasing.');
      sequence = nextSequence;
      const entityType = requireText(
        value.entityType, 80, 'changes[' + index + '].entityType').toLowerCase();
      if (!entityTypePattern.test(entityType)) {
        fail('changes[' + index + '].entityType is invalid.');
      }
      const entityId = requireUuid(value.entityId, 'changes[' + index + '].entityId');
      if (value.action !== 'upsert' && value.action !== 'delete') {
        fail('changes[' + index + '].action is not supported.');
      }
      requireInteger(value.version, 1, Number.MAX_SAFE_INTEGER, 'changes[' + index + '].version');
      if (value.action === 'upsert' && !isObject(value.payload)) {
        fail('upsert changes must contain an object payload.');
      }
      if (value.action === 'upsert' && value.payload.id !== undefined
          && requireUuid(value.payload.id, 'changes[' + index + '].payload.id') !== entityId) {
        fail('change payload id does not match its entity id.');
      }
      if (value.action === 'upsert' && value.payload.version !== undefined
          && requireInteger(value.payload.version, 1, Number.MAX_SAFE_INTEGER,
            'changes[' + index + '].payload.version') !== value.version) {
        fail('change payload version does not match its event version.');
      }
      if (value.action === 'delete' && value.payload !== null && value.payload !== undefined) {
        fail('delete changes cannot contain an entity payload.');
      }
      if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))) {
        fail('changes[' + index + '].occurredAt must be an ISO timestamp.');
      }
      return {
        sequence: nextSequence,
        entityType,
        entityId,
        action: value.action,
        version: value.version,
        payload: value.payload == null ? null : clone(value.payload),
        occurredAt: value.occurredAt
      };
    });
    return {changes, nextCursor: page.nextCursor, hasMore: page.hasMore};
  }

  function applyChangePage(state, entities, page) {
    const current = createState(state);
    const normalizedPage = normalizeChangePage(current, page);
    const nextEntities = normalizeEntities(entities);
    let applied = 0;
    let ignored = 0;
    normalizedPage.changes.forEach(change => {
      const key = change.entityType + ':' + change.entityId;
      const knownVersion = current.entityVersions[key] || 0;
      if (change.version <= knownVersion) {
        ignored++;
        return;
      }
      current.entityVersions[key] = change.version;
      if (change.action === 'delete') delete nextEntities[key];
      else nextEntities[key] = change.payload;
      applied++;
    });
    current.cursor = normalizedPage.nextCursor;
    if (normalizedPage.changes.length) {
      current.lastSequence = normalizedPage.changes[normalizedPage.changes.length - 1].sequence;
    }
    return {
      state: current,
      entities: nextEntities,
      changes: normalizedPage.changes,
      hasMore: normalizedPage.hasMore,
      applied,
      ignored
    };
  }

  return {
    SCHEMA_VERSION,
    MAX_BATCH_SIZE,
    MAX_PENDING_OPERATIONS,
    MAX_CHANGE_PAGE,
    createState,
    normalizeOperation,
    enqueue,
    nextBatch,
    reconcilePush,
    markBatchFailed,
    retryDelay,
    applyChangePage
  };
});
