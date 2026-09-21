(() => {
  'use strict';

  const core = window.PokeCollectionCloudCore;
  const account = window.PokeAccount;
  const catalog = window.PokeCatalog;
  const sync = window.PokeSyncClient;
  const store = window.PokeCollectionStore;
  if (!core || !account || !catalog || !sync || !store) return;

  const catalogCache = new Map();
  const maximumCatalogConcurrency = 4;
  let generation = 0;
  let activeUserId = '';
  let scheduled = null;
  let running = false;

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
      const holdings = sync.entities('holding');
      await fetchCatalogCards(holdings.map(holding => holding.cardId), runUserId, runGeneration);
      if (runGeneration !== generation || runUserId !== activeUserId) return;
      const latestStatus = sync.status();
      if (!latestStatus.ready || latestStatus.phase !== 'idle' || latestStatus.pending
        || latestStatus.continuationPending) return;
      const result = core.hydrate(
        store.read(runUserId),
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
    }
  }

  function scheduleHydration() {
    if (scheduled !== null) window.clearTimeout(scheduled);
    scheduled = window.setTimeout(() => {
      scheduled = null;
      hydrate();
    }, 0);
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
    }
    scheduleHydration();
  }

  Object.defineProperty(window, 'PokeCollectionCloud', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({queueCollectionChanges, hydrate: scheduleHydration})
  });

  window.addEventListener('pokefolio:account-state', switchAccount);
  window.addEventListener('pokefolio:sync-state', scheduleHydration);
  switchAccount();
})();
