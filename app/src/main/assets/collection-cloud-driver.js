(() => {
  'use strict';

  const core = window.PokeCollectionCloudCore;
  const account = window.PokeAccount;
  const catalog = window.PokeCatalog;
  const sync = window.PokeSyncClient;
  const store = window.PokeCollectionStore;
  const migration = window.PokeAccountMigration;
  if (!core || !account || !catalog || !sync || !store || !migration) return;

  const catalogCache = new Map();
  const maximumCatalogConcurrency = 4;
  let generation = 0;
  let activeUserId = '';
  let scheduled = null;
  let running = false;
  let outboxScheduled = null;
  let outboxRunning = false;

  function userId() {
    try {
      const status = account.status();
      return status && status.authenticated && status.session
        ? String(status.session.userId || '').toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  function emit(phase, detail) {
    window.dispatchEvent(new CustomEvent('pokefolio:cloud-collection-state', {
      detail: {phase, userId: activeUserId, ...(detail || {})}
    }));
  }

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID().toLowerCase();
    }
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('Sichere UUID-Erzeugung ist in dieser WebView nicht verfügbar.');
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = bytes[6] & 0x0f | 0x40;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function fetchCatalogCards(cardIds, runUserId, runGeneration) {
    const missing = [...new Set(cardIds)].filter(cardId => !catalogCache.has(cardId));
    for (let offset = 0; offset < missing.length; offset += maximumCatalogConcurrency) {
      const batch = missing.slice(offset, offset + maximumCatalogConcurrency);
      const results = await Promise.all(batch.map(async cardId => {
        try {
          const response = await catalog.get(cardId);
          return response && response.ok === true && response.data ? response.data : null;
        } catch (_) {
          return null;
        }
      }));
      if (runGeneration !== generation || runUserId !== activeUserId) return;
      results.forEach(card => {
        if (card && card.id) catalogCache.set(String(card.id).toLowerCase(), card);
      });
    }
  }

  async function hydrate() {
    if (running || !activeUserId) return;
    const status = sync.status();
    if (!status.ready || status.phase !== 'idle' || status.pending
      || status.continuationPending) return;
    running = true;
    const runGeneration = generation;
    const runUserId = activeUserId;
    emit('hydrating');
    try {
      const localCollection = store.read(runUserId);
      const reconciledCreates = reconcileCreateIntents(localCollection);
      if (reconciledCreates.changed) {
        if (!store.replaceFromCloud(runUserId, reconciledCreates.collection)) {
          throw new Error('Bestätigter Create-Outbox-Stand konnte nicht gespeichert werden.');
        }
        emit(reconciledCreates.blocked ? 'outbox-review' : 'outbox-confirmed', {
          completed: reconciledCreates.completed,
          failed: reconciledCreates.blocked
        });
        return;
      }
      if (reconciledCreates.blocked) {
        emit('outbox-review', {failed: reconciledCreates.blocked});
        return;
      }
      if (localCollection.some(entry => entry && entry.cloudSyncIntent === 'create')) {
        emit('outbox-pending');
        scheduleOutbox();
        return;
      }
      const holdings = sync.entities('holding');
      await fetchCatalogCards(holdings.map(holding => holding.cardId), runUserId, runGeneration);
      if (runGeneration !== generation || runUserId !== activeUserId) return;
      const latestStatus = sync.status();
      if (!latestStatus.ready || latestStatus.phase !== 'idle' || latestStatus.pending
        || latestStatus.continuationPending) return;
      const result = core.hydrate(
        localCollection,
        holdings,
        [...catalogCache.values()]);
      if (!result.ignoredHoldings && result.changed) {
        store.replaceFromCloud(runUserId, result.collection);
      }
      emit(result.ignoredHoldings ? 'error'
        : result.unresolvedCardIds.length ? 'partial' : 'ready', {
        holdings: holdings.length,
        unresolved: result.unresolvedCardIds.length,
        ignored: result.ignoredHoldings
      });
    } catch (error) {
      emit('error', {message: error.message || 'Cloud-Sammlung konnte nicht aufgebaut werden.'});
    } finally {
      running = false;
      if (runGeneration !== generation) scheduleHydration();
      else scheduleOutbox();
    }
  }

  function scheduleHydration() {
    if (scheduled !== null) window.clearTimeout(scheduled);
    scheduled = window.setTimeout(() => {
      scheduled = null;
      hydrate();
    }, 0);
  }

  function scheduleOutbox(delay = 0) {
    if (outboxScheduled !== null) window.clearTimeout(outboxScheduled);
    outboxScheduled = window.setTimeout(() => {
      outboxScheduled = null;
      runCreateOutbox();
    }, delay);
  }

  function pendingCreateEntries(collection) {
    return collection.filter(entry => entry && entry.cloudSyncIntent === 'create'
      && (!entry.cloudSyncState || entry.cloudSyncState === 'pending')
      && entry.cloudCreateKey && entry.catalogReference && !entry.cloudHoldingId);
  }

  function linkCreateEntry(collection, createKey, built) {
    let found = false;
    const next = collection.map(entry => {
      if (!entry || entry.cloudCreateKey !== createKey || entry.cloudSyncIntent !== 'create') {
        return entry;
      }
      found = true;
      return {
        ...entry,
        ...built.link,
        cloudSyncIntent: 'create',
        cloudSyncState: 'queued',
        cloudCreateMode: built.operations[0].kind === 'holding.create' ? 'create' : 'merge',
        cloudCreateOperationIds: built.operations.map(operation => operation.operationId)
      };
    });
    if (!found) throw new Error('Der lokale Create-Outbox-Eintrag wurde zwischenzeitlich entfernt.');
    return next;
  }

  function reconcileCreateIntents(collection) {
    let changed = false;
    let blocked = 0;
    let completed = 0;
    const next = collection.map(entry => {
      if (!entry || entry.cloudSyncIntent !== 'create') return entry;
      if (entry.cloudSyncState === 'conflict' || entry.cloudSyncState === 'rejected') {
        blocked++;
        return entry;
      }
      if (entry.cloudSyncState !== 'queued' || !Array.isArray(entry.cloudCreateOperationIds)
        || !entry.cloudCreateOperationIds.length) return entry;
      const states = sync.inspectOperations(entry.cloudCreateOperationIds)
        .map(result => result.state);
      const failure = states.includes('rejected') ? 'rejected'
        : states.includes('conflict') ? 'conflict' : '';
      if (failure) {
        const concurrentHolding = failure === 'conflict' && entry.cloudCreateMode === 'create'
          ? sync.entities('holding').find(holding => holding
            && String(holding.cardId || '').toLowerCase()
              === String(entry.cloudCardId || '').toLowerCase()
            && holding.language === entry.cloudLanguage
            && holding.variant === entry.cloudVariant
            && holding.condition === entry.cloudCondition)
          : null;
        if (concurrentHolding) {
          const retry = {...entry, cloudSyncState: 'pending'};
          delete retry.cloudHoldingId;
          delete retry.cloudVariantId;
          delete retry.cloudVersion;
          delete retry.cloudQuantity;
          delete retry.cloudUpdatedAt;
          delete retry.cloudCreateMode;
          delete retry.cloudCreateOperationIds;
          changed = true;
          return retry;
        }
        changed = changed || entry.cloudSyncState !== failure;
        blocked++;
        return {...entry, cloudSyncState: failure};
      }
      if (states.some(state => state === 'queued')) return entry;
      const cloudEntityPresent = sync.entities('holding').some(holding =>
        String(holding && holding.id || '').toLowerCase()
          === String(entry.cloudHoldingId || '').toLowerCase());
      if (!cloudEntityPresent) return entry;
      const confirmed = {...entry};
      delete confirmed.cloudSyncIntent;
      delete confirmed.cloudSyncState;
      delete confirmed.cloudCreateMode;
      delete confirmed.cloudCreateOperationIds;
      changed = true;
      completed++;
      return confirmed;
    });
    return {collection: next, changed, blocked, completed};
  }

  async function runCreateOutbox() {
    if (!activeUserId) return;
    if (running || outboxRunning) {
      scheduleOutbox(25);
      return;
    }
    const status = sync.status();
    if (!status.ready || status.phase !== 'idle' || status.pending
      || status.continuationPending) return;
    const runGeneration = generation;
    const runUserId = activeUserId;
    let entries;
    try {
      entries = pendingCreateEntries(store.read(runUserId)).slice(0, 10);
    } catch (error) {
      emit('error', {message: error.message || 'Create-Outbox konnte nicht gelesen werden.'});
      return;
    }
    if (!entries.length) return;

    outboxRunning = true;
    emit('outbox-syncing', {pendingCreates: entries.length});
    let completed = 0;
    let failed = 0;
    try {
      for (const candidate of entries) {
        if (runGeneration !== generation || runUserId !== activeUserId) return;
        try {
          const response = await catalog.resolve(candidate.catalogReference);
          if (runGeneration !== generation || runUserId !== activeUserId) return;
          if (!response || response.ok !== true || !response.data || !response.data.card) {
            throw new Error('Die neue Karte konnte nicht im globalen Katalog aufgelöst werden.');
          }
          const current = store.read(runUserId);
          const entry = pendingCreateEntries(current)
            .find(value => value.cloudCreateKey === candidate.cloudCreateKey);
          if (!entry) continue;
          const built = core.buildCreateIntent(
            entry,
            response.data.card,
            sync.entities('holding'),
            runUserId,
            migration.deterministicUuid);
          const queued = sync.enqueueMany(built.operations);
          if (!queued || queued.queued < 0 || queued.queued > built.operations.length) {
            throw new Error('Create-Outbox wurde nicht konsistent in die Sync-Queue geschrieben.');
          }
          const linked = linkCreateEntry(
            store.read(runUserId), entry.cloudCreateKey, built);
          if (!store.replaceFromCloud(runUserId, linked)) {
            throw new Error('Create-Outbox konnte den lokalen Eintrag nicht verknüpfen.');
          }
          completed++;
        } catch (error) {
          failed++;
          console.warn('[PokeFolio Collection Cloud] Create-Outbox:', error.message || error);
        }
      }
      emit(failed ? 'outbox-partial' : 'outbox-queued', {
        completed,
        failed,
        pendingCreates: Math.max(0, entries.length - completed)
      });
    } finally {
      outboxRunning = false;
    }
  }

  function queueCollectionChanges(before, after) {
    const nextUserId = userId();
    if (!nextUserId) return Object.freeze({queued: 0, cloud: false});
    const operations = core.createOperations(before, after, randomUuid);
    if (!operations.length) return Object.freeze({queued: 0, cloud: true});
    if (nextUserId !== activeUserId || sync.status().ready !== true) {
      throw new Error('Der kontogetrennte Sync-Speicher ist noch nicht bereit.');
    }
    if (operations.some(operation => operation.kind === 'holding.update')
      && sync.status().pending > 0) {
      throw new Error('Eine versionierte Cloud-Änderung läuft bereits. Bitte kurz erneut versuchen.');
    }
    const result = sync.enqueueMany(operations);
    if (result.queued !== operations.length) {
      throw new Error('Nicht alle Sammlungsänderungen konnten atomar vorgemerkt werden.');
    }
    return Object.freeze({queued: result.queued, cloud: true});
  }

  function switchAccount() {
    const nextUserId = userId();
    if (nextUserId !== activeUserId) {
      generation++;
      activeUserId = nextUserId;
      catalogCache.clear();
      if (outboxScheduled !== null) window.clearTimeout(outboxScheduled);
      outboxScheduled = null;
    }
    scheduleHydration();
    scheduleOutbox();
  }

  Object.defineProperty(window, 'PokeCollectionCloud', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      queueCollectionChanges,
      hydrate: scheduleHydration,
      flushCreates: scheduleOutbox
    })
  });

  window.addEventListener('pokefolio:account-state', switchAccount);
  window.addEventListener('pokefolio:sync-state', scheduleHydration);
  window.addEventListener('pokefolio:sync-state', scheduleOutbox);
  window.addEventListener('pokefolio:collection-changed', scheduleHydration);
  window.addEventListener('pokefolio:collection-changed', scheduleOutbox);
  switchAccount();
})();
