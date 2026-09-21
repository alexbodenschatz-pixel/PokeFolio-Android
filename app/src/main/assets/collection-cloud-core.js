(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokeCollectionCloudCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const providerIdPattern = /^[a-z0-9_.:/-]+$/;
  const maximumOperations = 100;
  const maximumDelta = 10000;

  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function fail(message) {
    throw new TypeError(message);
  }

  function uuid(value, label) {
    const normalized = String(value || '').toLowerCase();
    if (!uuidPattern.test(normalized)
      || normalized === '00000000-0000-0000-0000-000000000000') {
      fail(label + ' must be a non-empty UUID.');
    }
    return normalized;
  }

  function boundedText(value, maximum, label, allowEmpty) {
    if (typeof value !== 'string') fail(label + ' must be text.');
    const normalized = value.trim();
    if ((!allowEmpty && !normalized) || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/.test(normalized)) {
      fail(label + ' is invalid.');
    }
    return normalized;
  }

  function quantity(value, label) {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 1000000) {
      fail(label + ' is invalid.');
    }
    return normalized;
  }

  function version(value, label) {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 1) fail(label + ' is invalid.');
    return normalized;
  }

  function normalizeHolding(value) {
    if (!isObject(value)) fail('cloud holding must be an object.');
    const notes = value.notes == null ? null : value.notes;
    if (notes !== null && (typeof notes !== 'string' || notes.length > 10000)) {
      fail('cloud holding notes are invalid.');
    }
    return {
      id: uuid(value.id, 'cloud holding id'),
      cardId: uuid(value.cardId, 'cloud holding card id'),
      variantId: value.variantId == null ? null : uuid(value.variantId, 'cloud variant id'),
      language: boundedText(value.language, 40, 'cloud holding language'),
      variant: boundedText(value.variant, 80, 'cloud holding variant'),
      condition: boundedText(value.condition, 40, 'cloud holding condition'),
      quantity: quantity(value.quantity, 'cloud holding quantity'),
      notes,
      version: version(value.version, 'cloud holding version'),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
    };
  }

  function normalizeCatalogCard(value) {
    if (!isObject(value)) fail('catalog card must be an object.');
    const provider = boundedText(value.provider, 80, 'catalog provider').toLowerCase();
    const providerCardId = boundedText(value.providerCardId, 240, 'provider card id').toLowerCase();
    if (!providerIdPattern.test(provider) || !providerIdPattern.test(providerCardId)) {
      fail('catalog provider identity is invalid.');
    }
    return {
      id: uuid(value.id, 'catalog card id'),
      provider,
      providerCardId,
      tcg: boundedText(value.tcg, 40, 'catalog TCG').toLowerCase(),
      name: boundedText(value.name, 240, 'catalog card name'),
      setCode: boundedText(value.setCode, 64, 'catalog set code'),
      number: boundedText(value.number, 64, 'catalog card number')
    };
  }

  function localLanguage(card) {
    return String(card && (card.lang || card.language) || '').trim().toLowerCase();
  }

  function localVariant(card) {
    return String(card && (card.printingVariant || card.variant) || '').trim();
  }

  function localCondition(card) {
    return String(card && card.condition || 'unspecified').trim();
  }

  function localNotes(card) {
    if (card && own(card, 'collectionNotes')) return card.collectionNotes || null;
    return card && card.notes || null;
  }

  function referenceMatches(card, catalog) {
    const reference = card && card.catalogReference;
    return isObject(reference)
      && String(reference.provider || '').toLowerCase() === catalog.provider
      && String(reference.providerCardId || '').toLowerCase() === catalog.providerCardId;
  }

  function identityMatches(card, holding, catalog) {
    const sameCloudCard = String(card && card.cloudCardId || '').toLowerCase() === holding.cardId;
    return (sameCloudCard || catalog && referenceMatches(card, catalog))
      && localLanguage(card) === holding.language.toLowerCase()
      && localVariant(card) === holding.variant
      && localCondition(card) === holding.condition;
  }

  function mergeCloudField(existing, valueKey, baselineKey, remoteValue) {
    if (!existing || !own(existing, baselineKey)) return remoteValue;
    const current = valueKey === 'collectionNotes' ? localNotes(existing)
      : valueKey === 'language' ? localLanguage(existing)
        : valueKey === 'printingVariant' ? localVariant(existing)
          : localCondition(existing);
    const baseline = existing[baselineKey] == null ? null : existing[baselineKey];
    return current !== baseline ? current : remoteValue;
  }

  function createCloudEntry(existing, holding, catalog) {
    const reference = catalog ? {
      provider: catalog.provider,
      providerCardId: catalog.providerCardId,
      tcg: catalog.tcg,
      name: catalog.name,
      setCode: catalog.setCode,
      number: catalog.number
    } : existing && existing.catalogReference;
    if (!existing && !catalog) return null;

    const language = mergeCloudField(existing, 'language', 'cloudLanguage', holding.language);
    const variant = mergeCloudField(existing, 'printingVariant', 'cloudVariant', holding.variant);
    const condition = mergeCloudField(existing, 'condition', 'cloudCondition', holding.condition);
    const notes = mergeCloudField(existing, 'collectionNotes', 'cloudNotes', holding.notes);
    const cloudDirty = language !== holding.language || variant !== holding.variant
      || condition !== holding.condition || notes !== holding.notes;
    const remoteChanged = Boolean(existing && existing.cloudVersion
      && holding.version > Number(existing.cloudVersion));

    return {
      ...(existing || {}),
      id: existing && existing.id != null ? existing.id : holding.id,
      tcg: catalog ? catalog.tcg : existing.tcg,
      name: catalog ? catalog.name : existing.name,
      set: catalog ? catalog.setCode : existing.set,
      setId: catalog ? catalog.setCode : existing.setId,
      setCode: catalog ? catalog.setCode : existing.setCode,
      number: catalog ? catalog.number : existing.number,
      lang: language,
      language,
      printingVariant: variant,
      variant,
      condition,
      quantity: holding.quantity,
      collectionNotes: notes || '',
      catalogReference: reference,
      identityVerified: true,
      cloudHoldingId: holding.id,
      cloudCardId: holding.cardId,
      cloudVariantId: holding.variantId,
      cloudVersion: holding.version,
      cloudQuantity: holding.quantity,
      cloudLanguage: holding.language,
      cloudVariant: holding.variant,
      cloudCondition: holding.condition,
      cloudNotes: holding.notes,
      cloudUpdatedAt: holding.updatedAt,
      cloudDirty,
      cloudConflict: cloudDirty && remoteChanged
    };
  }

  function hydrate(localCollection, cloudHoldings, catalogCards) {
    const local = Array.isArray(localCollection) ? localCollection.map(clone) : [];
    const catalogs = new Map();
    (Array.isArray(catalogCards) ? catalogCards : []).forEach(value => {
      try {
        const card = normalizeCatalogCard(value);
        catalogs.set(card.id, card);
      } catch (_) {
        // One invalid catalog record must not discard the remaining account snapshot.
      }
    });
    const holdings = [];
    let ignoredHoldings = 0;
    (Array.isArray(cloudHoldings) ? cloudHoldings : []).forEach(value => {
      try {
        holdings.push(normalizeHolding(value));
      } catch (_) {
        ignoredHoldings++;
      }
    });
    if (ignoredHoldings) {
      return {
        collection: local,
        unresolvedCardIds: [],
        ignoredHoldings,
        changed: false
      };
    }

    const consumed = new Set();
    const output = [];
    const unresolved = new Set();
    holdings.forEach(holding => {
      const catalog = catalogs.get(holding.cardId) || null;
      let index = local.findIndex((entry, itemIndex) => !consumed.has(itemIndex)
        && String(entry.cloudHoldingId || '').toLowerCase() === holding.id);
      if (index < 0) {
        index = local.findIndex((entry, itemIndex) => !consumed.has(itemIndex)
          && !entry.cloudHoldingId && identityMatches(entry, holding, catalog));
      }
      const existing = index >= 0 ? local[index] : null;
      if (index >= 0) consumed.add(index);
      if (!catalog && !existing) {
        unresolved.add(holding.cardId);
        return;
      }
      const entry = createCloudEntry(existing, holding, catalog);
      if (entry && holding.quantity > 0) output.push(entry);
    });

    local.forEach((entry, index) => {
      if (consumed.has(index)) return;
      if (entry && entry.cloudHoldingId) return;
      output.push(entry);
    });
    return {
      collection: output,
      unresolvedCardIds: [...unresolved],
      ignoredHoldings,
      changed: JSON.stringify(output) !== JSON.stringify(localCollection || [])
    };
  }

  function operationId(factory) {
    if (typeof factory !== 'function') fail('operation id factory is required.');
    return uuid(factory(), 'operation id');
  }

  function cloudEntryMap(collection) {
    const result = new Map();
    (Array.isArray(collection) ? collection : []).forEach(entry => {
      if (!entry || !entry.cloudHoldingId) return;
      const id = uuid(entry.cloudHoldingId, 'local cloud holding id');
      if (result.has(id)) fail('collection contains a duplicate cloud holding.');
      result.set(id, entry);
    });
    return result;
  }

  function updateChanges(before, after) {
    const changes = {};
    if (localLanguage(before) !== localLanguage(after)) changes.language = localLanguage(after);
    if (localVariant(before) !== localVariant(after)) changes.variant = localVariant(after);
    if (localCondition(before) !== localCondition(after)) changes.condition = localCondition(after);
    if (localNotes(before) !== localNotes(after)) changes.notes = localNotes(after);
    return changes;
  }

  function createOperations(beforeCollection, afterCollection, idFactory) {
    const before = cloudEntryMap(beforeCollection);
    const after = cloudEntryMap(afterCollection);
    const holdingIds = new Set([...before.keys(), ...after.keys()]);
    const operations = [];

    holdingIds.forEach(holdingId => {
      const previous = before.get(holdingId) || null;
      const next = after.get(holdingId) || null;
      if (!previous) return;
      if (next) {
        const changes = updateChanges(previous, next);
        if (Object.keys(changes).length) {
          operations.push({
            operationId: operationId(idFactory),
            kind: 'holding.update',
            holdingId,
            baseVersion: version(previous.cloudVersion, 'local cloud holding version'),
            changes
          });
        }
      }
      let delta = quantity(next && next.quantity || 0, 'next local quantity')
        - quantity(previous.quantity, 'previous local quantity');
      while (delta !== 0) {
        const part = Math.sign(delta) * Math.min(Math.abs(delta), maximumDelta);
        operations.push({
          operationId: operationId(idFactory),
          kind: 'holding.quantityDelta',
          holdingId,
          delta: part
        });
        delta -= part;
      }
    });
    if (operations.length > maximumOperations) {
      fail('collection change requires more than 100 atomic sync operations.');
    }
    return operations;
  }

  return {
    hydrate,
    createOperations,
    normalizeHolding,
    normalizeCatalogCard
  };
});
