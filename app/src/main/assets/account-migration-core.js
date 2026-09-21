(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeAccountMigration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LEGACY_COLLECTION_KEY = 'pf_collection';
  const ACCOUNT_COLLECTION_KEY_PREFIX = 'pf_collection_account_v1:';
  const GUEST_COLLECTION_KEY = 'pf_collection_guest_v1';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeProviderIdPattern = /^[a-z0-9_.:/-]{1,160}$/;
  const providers = Object.freeze({
    'pokemon-tcg-api': 'pokemon',
    tcgdex: 'pokemon',
    ygoprodeck: 'yugioh',
    optcgapi: 'onepiece'
  });
  const languages = Object.freeze({
    de: 'de', en: 'en', ja: 'ja', fr: 'fr', it: 'it', es: 'es', ko: 'ko',
    'zh-cn': 'zh-Hans', 'zh-hans': 'zh-Hans',
    'zh-tw': 'zh-Hant', 'zh-hant': 'zh-Hant'
  });
  const entryStates = new Set(['pending', 'queued', 'complete', 'conflict', 'rejected']);
  const planStates = new Set(['pending', 'queued', 'complete', 'review', 'nothing-to-migrate']);

  function fail(message) {
    throw new TypeError(message);
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requireExactKeys(value, expected, label) {
    if (!isObject(value)) fail(label + ' must be an object.');
    const keys = Object.keys(value);
    if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) {
      fail(label + ' contains unsupported properties.');
    }
  }

  function text(value, maximum, label) {
    if (typeof value !== 'string') fail(label + ' must be text.');
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
      fail(label + ' is invalid.');
    }
    return normalized;
  }

  function uuid(value, label) {
    if (typeof value !== 'string' || !uuidPattern.test(value)
      || value.toLowerCase() === '00000000-0000-0000-0000-000000000000') {
      fail(label + ' must be a non-empty UUID.');
    }
    return value.toLowerCase();
  }

  function providerFromCard(card) {
    const explicit = String(card && (
      card.catalogProvider || card.provider || card.catalogReference && card.catalogReference.provider
    ) || '').trim().toLowerCase();
    if (providers[explicit]) return explicit;
    const source = String(card && (card.recognitionSource || card.source) || '').toLowerCase();
    if (/tcgdex|tcg\s*dex/.test(source)) return 'tcgdex';
    if (/pokemon.*tcg.*api/.test(source)) return 'pokemon-tcg-api';
    if (/ygoprodeck/.test(source)) return 'ygoprodeck';
    if (/optcg/.test(source)) return 'optcgapi';
    const tcg = String(card && card.tcg || '').trim().toLowerCase();
    return ({pokemon: 'tcgdex', yugioh: 'ygoprodeck', onepiece: 'optcgapi'})[tcg] || '';
  }

  function safeProviderId(value) {
    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    return safeProviderIdPattern.test(normalized) ? normalized : '';
  }

  function setCode(card) {
    return String(card && (card.setId || card.setCode || card.set) || '').trim();
  }

  function collectorNumber(card) {
    return String(card && (card.number || card.collectorNumber || card.cardCode) || '').trim();
  }

  function derivedProviderCardId(card, provider, includeCandidateId) {
    const direct = safeProviderId(card && (
      card.providerCardId || card.catalogProviderCardId
      || card.catalogReference && card.catalogReference.providerCardId
    ));
    if (direct) return direct;

    if (includeCandidateId) {
      let sourceId = String(card && card.id == null ? '' : card.id).trim().toLowerCase();
      if (provider === 'tcgdex') sourceId = sourceId.replace(/^tcgdex:/, '');
      const safeSourceId = safeProviderId(sourceId);
      if (safeSourceId) {
        if (provider === 'ygoprodeck') {
          const printCode = safeProviderId(collectorNumber(card));
          return printCode ? safeProviderId(safeSourceId + ':' + printCode) : safeSourceId;
        }
        return safeSourceId;
      }
    }

    const number = safeProviderId(collectorNumber(card));
    if (!number) return '';
    if (provider === 'optcgapi') return number;
    if (provider === 'ygoprodeck') {
      const passcode = safeProviderId(card && card.passcode);
      return passcode ? safeProviderId(passcode + ':' + number) : safeProviderId('print:' + number);
    }
    const cardSet = safeProviderId(setCode(card));
    const localNumber = safeProviderId(number.split('/')[0]);
    return cardSet && localNumber ? safeProviderId(cardSet + '-' + localNumber) : '';
  }

  function normalizeReference(card, includeCandidateId) {
    if (!isObject(card)) return null;
    const provider = providerFromCard(card);
    const tcg = providers[provider];
    const declaredTcg = String(card.tcg || card.catalogReference && card.catalogReference.tcg || '')
      .trim().toLowerCase();
    const providerCardId = derivedProviderCardId(card, provider, includeCandidateId);
    if (!provider || !tcg || !providerCardId || declaredTcg && declaredTcg !== tcg) return null;
    try {
      return {
        provider,
        providerCardId,
        tcg,
        name: text(card.name || card.catalogReference && card.catalogReference.name, 240, 'card name'),
        setCode: text(setCode(card) || card.catalogReference && card.catalogReference.setCode,
          64, 'set code'),
        number: text(collectorNumber(card) || card.catalogReference && card.catalogReference.number,
          64, 'collector number')
      };
    } catch (_) {
      return null;
    }
  }

  function referenceForCandidate(card) {
    return normalizeReference(card, true);
  }

  function referenceForLegacy(card) {
    return normalizeReference(card, false);
  }

  function validateReference(value) {
    requireExactKeys(value, ['provider', 'providerCardId', 'tcg', 'name', 'setCode', 'number'],
      'catalog reference');
    const normalized = normalizeReference({catalogReference: value}, false);
    if (!normalized || JSON.stringify(normalized) !== JSON.stringify(value)) {
      fail('catalog reference is not canonical.');
    }
  }

  function utf8(value) {
    const bytes = [];
    for (let index = 0; index < value.length; index++) {
      let code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        const low = value.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          index++;
        }
      }
      if (code <= 0x7f) bytes.push(code);
      else if (code <= 0x7ff) bytes.push(0xc0 | code >>> 6, 0x80 | code & 0x3f);
      else if (code <= 0xffff) {
        bytes.push(0xe0 | code >>> 12, 0x80 | code >>> 6 & 0x3f, 0x80 | code & 0x3f);
      } else {
        bytes.push(0xf0 | code >>> 18, 0x80 | code >>> 12 & 0x3f,
          0x80 | code >>> 6 & 0x3f, 0x80 | code & 0x3f);
      }
    }
    return bytes;
  }

  function rotateRight(value, bits) {
    return value >>> bits | value << 32 - bits;
  }

  function sha256(value) {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const message = utf8(value);
    const bitLength = message.length * 8;
    message.push(0x80);
    while (message.length % 64 !== 56) message.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) message.push(high >>> shift & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) message.push(low >>> shift & 0xff);

    const words = new Array(64);
    for (let offset = 0; offset < message.length; offset += 64) {
      for (let index = 0; index < 16; index++) {
        const start = offset + index * 4;
        words[index] = (message[start] << 24 | message[start + 1] << 16
          | message[start + 2] << 8 | message[start + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index++) {
        const previous = words[index - 15];
        const later = words[index - 2];
        const sigma0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ previous >>> 3;
        const sigma1 = rotateRight(later, 17) ^ rotateRight(later, 19) ^ later >>> 10;
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index++) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = e & f ^ ~e & g;
        const temporary1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = a & b ^ a & c ^ b & c;
        const temporary2 = (sum0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temporary1) >>> 0;
        d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
    }
    const result = [];
    hash.forEach(word => {
      result.push(word >>> 24 & 0xff, word >>> 16 & 0xff, word >>> 8 & 0xff, word & 0xff);
    });
    return result;
  }

  function deterministicUuid(seed) {
    const bytes = sha256(text(seed, 4096, 'UUID seed')).slice(0, 16);
    bytes[6] = bytes[6] & 0x0f | 0x80;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function normalizeLanguage(value) {
    return languages[String(value || '').trim().toLowerCase()] || '';
  }

  function optionalUserId(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return uuidPattern.test(normalized)
      && normalized !== '00000000-0000-0000-0000-000000000000' ? normalized : '';
  }

  function collectionStorageKey(accountUserId, legacyOwnerUserId) {
    const userId = optionalUserId(accountUserId);
    const owner = optionalUserId(legacyOwnerUserId);
    if (userId) return owner === userId ? LEGACY_COLLECTION_KEY
      : ACCOUNT_COLLECTION_KEY_PREFIX + userId;
    return legacyOwnerUserId ? GUEST_COLLECTION_KEY : LEGACY_COLLECTION_KEY;
  }

  function migrationCollectionStorageKey(accountUserId, legacyOwnerUserId) {
    const userId = uuid(accountUserId, 'account user id');
    const owner = optionalUserId(legacyOwnerUserId);
    return !legacyOwnerUserId || owner === userId ? LEGACY_COLLECTION_KEY
      : ACCOUNT_COLLECTION_KEY_PREFIX + userId;
  }

  function migrationTemplate(card, userId) {
    const reference = referenceForLegacy(card);
    const language = normalizeLanguage(card && (card.lang || card.language));
    const variant = String(card && (card.printingVariant || card.variant) || '').trim();
    const condition = String(card && card.condition || 'unspecified').trim();
    const quantity = Number(card && card.quantity);
    const legacyKey = String(card && card.collectionKey || '').trim();
    if (!reference) return {error: 'Keine stabile Provider-Kartenidentität vorhanden.'};
    if (!legacyKey || legacyKey.length > 1024) return {error: 'Lokale Kartenidentität fehlt.'};
    if (!language) return {error: 'Kartensprache wird vom Cloud-Modell nicht unterstützt.'};
    if (!variant || variant.length > 80) return {error: 'Druckvariante fehlt oder ist ungültig.'};
    if (!condition || condition.length > 40) return {error: 'Kartenzustand ist ungültig.'};
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      return {error: 'Stückzahl liegt außerhalb des unterstützten Bereichs.'};
    }
    const notes = card && (card.collectionNotes || card.notes);
    if (notes != null && (typeof notes !== 'string' || notes.length > 10000)) {
      return {error: 'Notizen sind zu lang.'};
    }
    const seed = `pokefolio-legacy-v1|${userId}|${legacyKey}`;
    return {entry: {
      legacyKey,
      name: reference.name,
      holdingId: deterministicUuid(seed + '|holding'),
      createOperationId: deterministicUuid(seed + '|create'),
      mergeOperationId: deterministicUuid(seed + '|merge'),
      reference,
      holding: {
        language,
        variant,
        condition,
        quantity,
        notes: notes == null || notes === '' ? null : notes
      },
      operation: null,
      state: 'pending',
      error: null
    }};
  }

  function createPlan(collection, accountUserId, now) {
    const userId = uuid(accountUserId, 'account user id');
    const timestamp = new Date(now === undefined ? Date.now() : now).toISOString();
    const entries = [];
    const skipped = [];
    (Array.isArray(collection) ? collection : []).forEach(card => {
      const result = migrationTemplate(card, userId);
      if (result.entry) entries.push(result.entry);
      else skipped.push({
        legacyKey: String(card && card.collectionKey || card && card.id || ''),
        name: String(card && card.name || 'Unbekannte Karte').slice(0, 240),
        reason: result.error
      });
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: entries.length ? 'pending' : 'nothing-to-migrate',
      entries,
      skipped
    };
  }

  function parsePlan(raw, accountUserId) {
    const expectedUserId = uuid(accountUserId, 'account user id');
    const value = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
    requireExactKeys(value,
      ['schemaVersion', 'userId', 'createdAt', 'updatedAt', 'status', 'entries', 'skipped'],
      'migration plan');
    if (value.schemaVersion !== SCHEMA_VERSION || uuid(value.userId, 'plan user id') !== expectedUserId
      || !Array.isArray(value.entries) || !Array.isArray(value.skipped)
      || value.entries.length > 10000 || value.skipped.length > 10000) {
      fail('migration plan is invalid or belongs to another account.');
    }
    if (!planStates.has(value.status)
      || !Number.isFinite(Date.parse(value.createdAt))
      || !Number.isFinite(Date.parse(value.updatedAt))) {
      fail('migration plan status or timestamps are invalid.');
    }
    value.entries.forEach((entry, index) => {
      requireExactKeys(entry, ['legacyKey', 'name', 'holdingId', 'createOperationId',
        'mergeOperationId', 'reference', 'holding', 'operation', 'state', 'error'],
      'migration entry ' + index);
      text(entry.legacyKey, 1024, 'migration legacy key');
      text(entry.name, 240, 'migration card name');
      uuid(entry.holdingId, 'migration holding id');
      uuid(entry.createOperationId, 'migration create operation id');
      uuid(entry.mergeOperationId, 'migration merge operation id');
      if (!entryStates.has(entry.state)) fail('migration entry state is invalid.');
      if (entry.error !== null && typeof entry.error !== 'string') fail('migration error is invalid.');
      validateReference(entry.reference);
      requireExactKeys(entry.holding,
        ['language', 'variant', 'condition', 'quantity', 'notes'], 'migration holding template');
      if (!languages[String(entry.holding.language || '').toLowerCase()]
        || text(entry.holding.variant, 80, 'migration variant') !== entry.holding.variant
        || text(entry.holding.condition, 40, 'migration condition') !== entry.holding.condition
        || !Number.isSafeInteger(entry.holding.quantity)
        || entry.holding.quantity < 1 || entry.holding.quantity > 1000000
        || entry.holding.notes !== null
          && (typeof entry.holding.notes !== 'string' || entry.holding.notes.length > 10000)) {
        fail('migration holding template is invalid.');
      }
      validateStoredOperation(entry);
    });
    value.skipped.forEach((entry, index) => {
      requireExactKeys(entry, ['legacyKey', 'name', 'reason'], 'skipped migration entry ' + index);
      if (typeof entry.legacyKey !== 'string' || entry.legacyKey.length > 1024
        || typeof entry.name !== 'string' || entry.name.length > 240
        || typeof entry.reason !== 'string' || !entry.reason || entry.reason.length > 500) {
        fail('skipped migration entry is invalid.');
      }
    });
    return value;
  }

  function validateStoredOperation(entry) {
    if (entry.operation === null) return;
    if (!isObject(entry.operation)) fail('migration operation is invalid.');
    if (entry.operation.kind === 'holding.create') {
      requireExactKeys(entry.operation, ['operationId', 'kind', 'holding'], 'migration create');
      if (uuid(entry.operation.operationId, 'migration operation id') !== entry.createOperationId) {
        fail('migration create operation id does not match its plan.');
      }
      requireExactKeys(entry.operation.holding,
        ['id', 'cardId', 'variantId', 'language', 'variant', 'condition', 'quantity', 'notes'],
        'migration create holding');
      const holding = entry.operation.holding;
      if (uuid(holding.id, 'migration holding id') !== entry.holdingId
        || !uuid(holding.cardId, 'migration catalog card id')
        || holding.variantId !== null
        || holding.language !== entry.holding.language
        || holding.variant !== entry.holding.variant
        || holding.condition !== entry.holding.condition
        || holding.quantity !== entry.holding.quantity
        || holding.notes !== entry.holding.notes) {
        fail('migration create holding does not match its plan.');
      }
      return;
    }
    if (entry.operation.kind === 'holding.quantityDelta') {
      requireExactKeys(entry.operation,
        ['operationId', 'kind', 'holdingId', 'delta'], 'migration quantity delta');
      if (uuid(entry.operation.operationId, 'migration operation id') !== entry.mergeOperationId
        || !uuid(entry.operation.holdingId, 'existing holding id')
        || entry.operation.delta !== entry.holding.quantity) {
        fail('migration quantity delta does not match its plan.');
      }
      return;
    }
    fail('migration plan contains a forbidden operation kind.');
  }

  function sameHoldingIdentity(holding, cardId, template) {
    return isObject(holding)
      && String(holding.cardId || '').toLowerCase() === cardId
      && (holding.variantId === null || holding.variantId === undefined)
      && holding.language === template.language
      && holding.variant === template.variant
      && holding.condition === template.condition;
  }

  function buildOperation(entry, catalogCardId, cloudHoldings) {
    const cardId = uuid(catalogCardId, 'catalog card id');
    const holdings = Array.isArray(cloudHoldings) ? cloudHoldings : [];
    const existing = holdings.find(holding => sameHoldingIdentity(holding, cardId, entry.holding));
    if (existing && String(existing.id || '').toLowerCase() !== entry.holdingId) {
      return {
        operationId: entry.mergeOperationId,
        kind: 'holding.quantityDelta',
        holdingId: uuid(existing.id, 'existing holding id'),
        delta: entry.holding.quantity
      };
    }
    return {
      operationId: entry.createOperationId,
      kind: 'holding.create',
      holding: {
        id: entry.holdingId,
        cardId,
        variantId: null,
        language: entry.holding.language,
        variant: entry.holding.variant,
        condition: entry.holding.condition,
        quantity: entry.holding.quantity,
        notes: entry.holding.notes
      }
    };
  }

  function summarize(plan) {
    const summary = {
      eligible: plan.entries.length,
      skipped: plan.skipped.length,
      quantity: 0,
      pending: 0,
      queued: 0,
      complete: 0,
      conflict: 0,
      rejected: 0
    };
    plan.entries.forEach(entry => {
      summary.quantity += Number(entry.holding.quantity) || 0;
      summary[entry.state]++;
    });
    return summary;
  }

  return {
    SCHEMA_VERSION,
    referenceForCandidate,
    referenceForLegacy,
    deterministicUuid,
    collectionStorageKey,
    migrationCollectionStorageKey,
    createPlan,
    parsePlan,
    buildOperation,
    summarize
  };
});
