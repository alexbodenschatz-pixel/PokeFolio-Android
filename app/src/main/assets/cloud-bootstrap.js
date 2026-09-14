(() => {
  'use strict';

  if (window.PokeCatalog || window.PokeSyncTransport || window.PokeSyncStorage) return;
  const nativeHost = window.PokeNative;
  if (!nativeHost || !window.PokePlatform || !window.PokeAccount) return;

  const createChannel = (prefix, busyMessage, eventName) => {
    let sequence = 1;
    const pending = new Map();
    return Object.freeze({
      request: invoke => new Promise((resolve, reject) => {
        if (pending.size >= 8) {
          reject(new Error(busyMessage));
          return;
        }
        const requestId = `${prefix}-${Date.now()}-${sequence++}`;
        const timeout = window.setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('Das PokeFolio-Backend antwortet nicht.'));
        }, 30000);
        pending.set(requestId, response => {
          window.clearTimeout(timeout);
          resolve(response);
        });
        try {
          invoke(requestId);
        } catch (error) {
          window.clearTimeout(timeout);
          pending.delete(requestId);
          reject(error);
        }
      }),
      complete: json => {
        const response = JSON.parse(String(json || '{}'));
        const callback = pending.get(response.requestId);
        if (callback) {
          pending.delete(response.requestId);
          callback(response);
        }
        window.dispatchEvent(new CustomEvent(eventName, {detail: response}));
      }
    });
  };

  const catalogProviderTcgs = Object.freeze({
    'pokemon-tcg-api': 'pokemon',
    tcgdex: 'pokemon',
    ygoprodeck: 'yugioh',
    optcgapi: 'onepiece'
  });
  const catalogText = (value, maximumLength, label) => {
    if (typeof value !== 'string') throw new TypeError(`${label} muss Text sein.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maximumLength
      || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new TypeError(`${label} ist ungültig.`);
    }
    return normalized;
  };
  const serializeCatalogReference = reference => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw new TypeError('Die Kartenreferenz muss ein Objekt sein.');
    }
    const provider = catalogText(reference.provider, 48, 'Provider').toLowerCase();
    const providerCardId = catalogText(reference.providerCardId, 160, 'Provider-Karten-ID')
      .toLowerCase();
    const tcg = catalogText(reference.tcg, 32, 'TCG').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(catalogProviderTcgs, provider)) {
      throw new TypeError('Der Kartenprovider wird nicht unterstützt.');
    }
    if (catalogProviderTcgs[provider] !== tcg) {
      throw new TypeError('Kartenprovider und TCG passen nicht zusammen.');
    }
    if (!/^[a-z0-9_.:/-]+$/.test(providerCardId)) {
      throw new TypeError('Die Provider-Karten-ID enthält ungültige Zeichen.');
    }
    const json = JSON.stringify({
      provider,
      providerCardId,
      tcg,
      name: catalogText(reference.name, 240, 'Kartenname'),
      setCode: catalogText(reference.setCode, 64, 'Setcode'),
      number: catalogText(reference.number, 64, 'Kartennummer')
    });
    if (json.length > 16384) throw new TypeError('Die Kartenreferenz ist zu groß.');
    return json;
  };
  const validateCatalogCardId = cardId => {
    if (typeof cardId !== 'string') {
      throw new TypeError('Die Katalog-Karten-ID muss eine UUID sein.');
    }
    const normalized = cardId.toLowerCase();
    if (normalized === '00000000-0000-0000-0000-000000000000'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
      throw new TypeError('Die Katalog-Karten-ID muss eine UUID sein.');
    }
    return normalized;
  };
  const catalogChannel = createChannel(
    'catalog', 'Zu viele Kataloganfragen laufen gleichzeitig.', 'pokefolio:catalog-result');
  window.onPokeCatalogResult = catalogChannel.complete;
  Object.defineProperty(window, 'PokeCatalog', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      resolve: reference => catalogChannel.request(requestId =>
        nativeHost.resolveCatalogCard(serializeCatalogReference(reference), requestId)),
      get: cardId => catalogChannel.request(requestId =>
        nativeHost.getCatalogCard(validateCatalogCardId(cardId), requestId))
    })
  });

  const serializeSyncBatch = batch => {
    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) {
      throw new TypeError('Der Sync-Batch muss ein Objekt sein.');
    }
    const json = JSON.stringify(batch);
    if (typeof json !== 'string' || json.length < 2 || json.length > 1048576) {
      throw new TypeError('Der Sync-Batch hat eine ungültige Größe.');
    }
    return json;
  };
  const validateSyncPull = (cursor, limit) => {
    if (cursor !== null && cursor !== undefined
      && (typeof cursor !== 'string' || cursor.length > 2048)) {
      throw new TypeError('Der Sync-Cursor ist ungültig.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('Die Sync-Seitengröße muss zwischen 1 und 500 liegen.');
    }
    return cursor || '';
  };
  const syncChannel = createChannel(
    'sync', 'Zu viele Synchronisationsanfragen laufen gleichzeitig.', 'pokefolio:sync-result');
  window.onPokeSyncResult = syncChannel.complete;
  Object.defineProperty(window, 'PokeSyncTransport', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      push: batch => syncChannel.request(requestId =>
        nativeHost.pushSyncOperations(serializeSyncBatch(batch), requestId)),
      pull: (cursor = null, limit = 100) => syncChannel.request(requestId =>
        nativeHost.pullSyncChanges(validateSyncPull(cursor, limit), limit, requestId))
    })
  });

  const maximumSyncSnapshotCharacters = 32 * 1024 * 1024;
  const parseSyncSnapshot = json => {
    const text = String(json || '');
    if (!text) return null;
    if (text.length > maximumSyncSnapshotCharacters) {
      throw new RangeError('Der lokale Sync-Snapshot ist zu groß.');
    }
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Der lokale Sync-Snapshot muss ein Objekt sein.');
    }
    return value;
  };
  Object.defineProperty(window, 'PokeSyncStorage', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      load: () => parseSyncSnapshot(nativeHost.loadAccountSyncSnapshot()),
      save: snapshot => {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
          throw new TypeError('Der lokale Sync-Snapshot muss ein Objekt sein.');
        }
        const json = JSON.stringify(snapshot);
        if (typeof json !== 'string' || json.length < 2
          || json.length > maximumSyncSnapshotCharacters) {
          throw new RangeError('Der lokale Sync-Snapshot hat eine ungültige Größe.');
        }
        if (nativeHost.saveAccountSyncSnapshot(json) !== true) {
          throw new Error('Der lokale Sync-Snapshot konnte nicht gespeichert werden.');
        }
        return true;
      }
    })
  });
})();
