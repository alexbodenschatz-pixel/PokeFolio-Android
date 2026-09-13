(() => {
  'use strict';

  const SNAPSHOT_SCHEMA_VERSION = 1;
  const PUSH_BATCH_LIMIT = 100;
  const PULL_PAGE_LIMIT = 500;
  const MAX_PUSH_BATCHES_PER_RUN = 10;
  const MAX_PULL_PAGES_PER_RUN = 10;
  const IDLE_PULL_INTERVAL_MS = 60000;
  const OFFLINE_RETRY_MS = 30000;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let activeUserId = '';
  let generation = 0;
  let snapshot = null;
  let inFlight = null;
  let timer = null;
  let phase = 'signed-out';
  let lastErrorType = null;
  let pullFailureCount = 0;
  let started = false;

  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const core = () => {
    const value = window.PokeSync;
    if (!value || typeof value.createState !== 'function'
      || typeof value.createEntities !== 'function'
      || typeof value.enqueue !== 'function'
      || typeof value.nextBatch !== 'function'
      || typeof value.reconcilePush !== 'function'
      || typeof value.markBatchFailed !== 'function'
      || typeof value.applyChangePage !== 'function') {
      throw new Error('Der gemeinsame Sync-Core ist nicht verfuegbar.');
    }
    return value;
  };

  const accountUserId = status => {
    if (!status || status.authenticated !== true || !isObject(status.session)
      || typeof status.session.userId !== 'string') return '';
    const userId = status.session.userId.toLowerCase();
    if (userId === '00000000-0000-0000-0000-000000000000' || !uuidPattern.test(userId)) {
      return '';
    }
    return userId;
  };

  const normalizeSnapshot = raw => {
    const sync = core();
    if (raw === null || raw === undefined) {
      return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        state: sync.createState(),
        entities: sync.createEntities()
      };
    }
    if (!isObject(raw)
      || Object.keys(raw).some(key => !['schemaVersion', 'state', 'entities'].includes(key))
      || Object.keys(raw).length !== 3
      || raw.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new TypeError('Der lokale Sync-Snapshot hat ein nicht unterstuetztes Format.');
    }
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      state: sync.createState(raw.state),
      entities: sync.createEntities(raw.entities)
    };
  };

  const publicStatus = () => Object.freeze({
    authenticated: Boolean(activeUserId),
    ready: Boolean(snapshot),
    phase,
    pending: snapshot ? snapshot.state.pending.length : 0,
    conflicts: snapshot ? snapshot.state.conflicts.length : 0,
    rejected: snapshot ? snapshot.state.rejected.length : 0,
    entities: snapshot ? Object.keys(snapshot.entities).length : 0,
    cursorAvailable: Boolean(snapshot && snapshot.state.cursor),
    lastErrorType
  });

  const emit = () => window.dispatchEvent(new CustomEvent('pokefolio:sync-state', {
    detail: publicStatus()
  }));

  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const schedule = delay => {
    clearTimer();
    if (!started || !activeUserId || !snapshot) return;
    timer = window.setTimeout(() => {
      timer = null;
      syncNow().catch(() => {
        // State and retry scheduling are handled by the serialized driver.
      });
    }, Math.max(0, Math.min(Number(delay) || 0, 2147483647)));
  };

  const scheduleFromState = (immediate = false) => {
    if (!snapshot) return;
    if (immediate) return schedule(0);
    const first = snapshot.state.pending[0];
    if (first) return schedule(Math.max(0, first.nextAttemptAt - Date.now()));
    schedule(IDLE_PULL_INTERVAL_MS);
  };

  const assertCurrent = (runUserId, runGeneration) => {
    if (runUserId !== activeUserId || runGeneration !== generation || !snapshot) {
      const error = new Error('Das aktive Konto wurde waehrend der Synchronisation gewechselt.');
      error.code = 'stale-account';
      throw error;
    }
  };

  const persistTransition = (nextState, nextEntities, runUserId, runGeneration) => {
    assertCurrent(runUserId, runGeneration);
    const next = normalizeSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      state: nextState,
      entities: nextEntities
    });
    try {
      window.PokeSyncStorage.save(next);
    } catch (error) {
      const storageError = new Error('Der lokale Sync-Snapshot konnte nicht gespeichert werden.');
      storageError.code = 'storage';
      storageError.cause = error;
      throw storageError;
    }
    assertCurrent(runUserId, runGeneration);
    snapshot = next;
    emit();
  };

  const responseData = (response, operation) => {
    if (!isObject(response) || response.ok !== true || !isObject(response.data)) {
      const error = new Error(`Die ${operation}-Antwort war nicht erfolgreich.`);
      error.code = isObject(response) && typeof response.errorType === 'string'
        ? response.errorType : 'server';
      throw error;
    }
    return response.data;
  };

  const classifyError = error => {
    if (error && error.code === 'stale-account') return 'stale-account';
    if (error && typeof error.code === 'string' && error.code) return error.code;
    if (error instanceof TypeError || error instanceof RangeError) return 'invalid-data';
    return 'transport';
  };

  const performSync = async () => {
    if (!activeUserId || !snapshot) return publicStatus();
    if (window.navigator && window.navigator.onLine === false) {
      phase = 'offline';
      lastErrorType = 'offline';
      emit();
      schedule(OFFLINE_RETRY_MS);
      return publicStatus();
    }

    const runUserId = activeUserId;
    const runGeneration = generation;
    const sync = core();
    phase = 'syncing';
    lastErrorType = null;
    emit();

    let pushLimitReached = false;
    for (let batchIndex = 0; batchIndex < MAX_PUSH_BATCHES_PER_RUN; batchIndex++) {
      assertCurrent(runUserId, runGeneration);
      const batch = sync.nextBatch(snapshot.state, Date.now(), PUSH_BATCH_LIMIT);
      if (!batch.length) break;
      try {
        const response = await window.PokeSyncTransport.push({operations: batch});
        assertCurrent(runUserId, runGeneration);
        const reconciled = sync.reconcilePush(
          snapshot.state,
          batch,
          responseData(response, 'Push'),
          Date.now());
        persistTransition(reconciled.state, snapshot.entities, runUserId, runGeneration);
      } catch (error) {
        const errorType = classifyError(error);
        if (errorType === 'stale-account') return publicStatus();
        if (errorType === 'storage') {
          phase = 'storage-error';
          lastErrorType = errorType;
          emit();
          return publicStatus();
        }
        assertCurrent(runUserId, runGeneration);
        const failed = sync.markBatchFailed(snapshot.state, batch, Date.now());
        try {
          persistTransition(failed, snapshot.entities, runUserId, runGeneration);
        } catch (persistError) {
          phase = 'storage-error';
          lastErrorType = classifyError(persistError);
          emit();
          return publicStatus();
        }
        phase = 'retry';
        lastErrorType = errorType;
        emit();
        scheduleFromState();
        return publicStatus();
      }
      pushLimitReached = batchIndex === MAX_PUSH_BATCHES_PER_RUN - 1
        && sync.nextBatch(snapshot.state, Date.now(), 1).length > 0;
    }

    let pullLimitReached = false;
    try {
      for (let pageIndex = 0; pageIndex < MAX_PULL_PAGES_PER_RUN; pageIndex++) {
        assertCurrent(runUserId, runGeneration);
        const response = await window.PokeSyncTransport.pull(
          snapshot.state.cursor || null,
          PULL_PAGE_LIMIT);
        assertCurrent(runUserId, runGeneration);
        const applied = sync.applyChangePage(
          snapshot.state,
          snapshot.entities,
          responseData(response, 'Pull'));
        persistTransition(applied.state, applied.entities, runUserId, runGeneration);
        if (!applied.hasMore) break;
        pullLimitReached = pageIndex === MAX_PULL_PAGES_PER_RUN - 1;
      }
      pullFailureCount = 0;
      phase = 'idle';
      lastErrorType = null;
      emit();
      scheduleFromState(pushLimitReached || pullLimitReached);
    } catch (error) {
      const errorType = classifyError(error);
      if (errorType === 'stale-account') return publicStatus();
      assertCurrent(runUserId, runGeneration);
      if (errorType === 'storage') {
        phase = 'storage-error';
        lastErrorType = errorType;
        emit();
        return publicStatus();
      }
      pullFailureCount = Math.min(pullFailureCount + 1, 20);
      phase = 'retry';
      lastErrorType = errorType;
      emit();
      schedule(sync.retryDelay(pullFailureCount));
    }
    return publicStatus();
  };

  function syncNow() {
    if (inFlight) return inFlight;
    const invocationGeneration = generation;
    const execution = performSync();
    let tracked;
    tracked = execution.finally(() => {
      if (inFlight === tracked) inFlight = null;
      if (generation !== invocationGeneration && activeUserId && snapshot) schedule(0);
    });
    inFlight = tracked;
    return tracked;
  }

  const activate = status => {
    const userId = accountUserId(status);
    if (userId === activeUserId && (snapshot || !userId)) return;
    generation += 1;
    clearTimer();
    activeUserId = userId;
    snapshot = null;
    pullFailureCount = 0;
    lastErrorType = null;
    if (!userId) {
      phase = 'signed-out';
      emit();
      return;
    }
    try {
      snapshot = normalizeSnapshot(window.PokeSyncStorage.load());
      phase = 'idle';
      emit();
      schedule(0);
    } catch (error) {
      phase = 'storage-error';
      lastErrorType = classifyError(error);
      emit();
    }
  };

  const enqueue = operation => {
    if (!activeUserId || !snapshot) {
      throw new Error('Fuer Offline-Aenderungen ist ein angemeldetes Konto erforderlich.');
    }
    const runUserId = activeUserId;
    const runGeneration = generation;
    const result = core().enqueue(snapshot.state, operation, Date.now());
    if (result.queued) {
      persistTransition(result.state, snapshot.entities, runUserId, runGeneration);
      schedule(0);
    }
    return Object.freeze({queued: result.queued, status: publicStatus()});
  };

  Object.defineProperty(window, 'PokeSyncClient', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({enqueue, syncNow, status: publicStatus})
  });

  window.addEventListener('pokefolio:account-state', event => {
    const detail = event && event.detail;
    const status = isObject(detail) && isObject(detail.status)
      ? detail.status : window.PokeAccount.status();
    activate(status);
  });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('DOMContentLoaded', () => {
    started = true;
    activate(window.PokeAccount.status());
  });
})();
