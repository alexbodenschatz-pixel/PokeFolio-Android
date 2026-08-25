(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokeCollection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 4;
  const DEFAULT_VARIANT = 'normal';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function keyPart(value) {
    return text(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function positiveQuantity(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function estimatedUnitValue(card) {
    if (Number.isFinite(Number(card && card.estimatedUnitValue))) {
      return Math.max(0, Number(card.estimatedUnitValue));
    }
    const price = card && card.price;
    if (price && Number.isFinite(Number(price.value))) return Math.max(0, Number(price.value));
    if (Number.isFinite(Number(card && card.value))) return Math.max(0, Number(card.value));
    const rawLabel = text(price && price.label || card && card.priceLabel);
    let label = rawLabel.replace(/[^0-9.,-]/g, '');
    if (label.includes(',') && label.includes('.')) {
      label = label.lastIndexOf(',') > label.lastIndexOf('.')
        ? label.replace(/\./g, '').replace(',', '.')
        : label.replace(/,/g, '');
    } else if (label.includes(',')) {
      label = label.replace(',', '.');
    }
    const match = label.match(/\d+(?:\.\d{1,2})?/);
    return match ? Math.max(0, Number(match[0])) : 0;
  }

  function priceCurrency(card) {
    const value = text(card && card.price && card.price.currency || card && card.currency).toUpperCase();
    if (value) return value;
    return /\$|USD/i.test(text(card && card.price && card.price.label || card && card.priceLabel)) ? 'USD' : 'EUR';
  }

  function normalizedLanguage(card) {
    const language = keyPart(card && (card.lang || card.language));
    if (language === 'deu' || language === 'german' || language === 'deutsch') return 'de';
    if (language === 'eng' || language === 'english' || language === 'englisch') return 'en';
    if (language === 'jpn' || language === 'japanese' || language === 'japanisch') return 'ja';
    if (language === 'kor' || language === 'korean' || language === 'koreanisch') return 'ko';
    if (language === 'zhcn' || language === 'zhs' || language === 'chinesischvereinfacht') return 'zh-CN';
    if (language === 'zhtw' || language === 'zht' || language === 'chinesischtraditionell') return 'zh-TW';
    return language || 'de';
  }

  function normalizedVariant(card) {
    const explicit = text(card && (
      card.printingVariant || card.variant || card.finish || card.foilType
    ));
    const value = keyPart(explicit);
    if (value) {
      if (value.includes('specialillustration') || value === 'sir') return 'special-illustration-rare';
      if (value.includes('illustration') || value === 'ir') return 'illustration-rare';
      if (value.includes('alternate') || value.includes('alternativeart')) return 'alternate-art';
      if (value.includes('fullart')) return 'full-art';
      if (value.includes('secretrare') || value === 'secret') return 'secret-rare';
      if (value.includes('reprint')) return 'reprint';
      if (value.includes('reverse')) return 'reverse-holo';
      if (value.includes('promo')) return 'promo';
      if (value.includes('holo') || value.includes('foil')) return 'holo';
      if (value === 'standard' || value === 'regular') return DEFAULT_VARIANT;
      return value;
    }
    const rarity = keyPart(card && card.rarity);
    if (rarity.includes('specialillustration')) return 'special-illustration-rare';
    if (rarity.includes('illustration')) return 'illustration-rare';
    if (rarity.includes('alternate')) return 'alternate-art';
    if (rarity.includes('fullart')) return 'full-art';
    if (rarity.includes('secretrare') || rarity.includes('hyperrare')) return 'secret-rare';
    if (rarity.includes('reverse')) return 'reverse-holo';
    if (rarity.includes('promo')) return 'promo';
    if (rarity.includes('holo')) return 'holo';
    return DEFAULT_VARIANT;
  }

  function variantLabel(value) {
    return ({
      normal: 'Normal',
      holo: 'Holo',
      'reverse-holo': 'Reverse Holo',
      'full-art': 'Full Art',
      'alternate-art': 'Alternate Art',
      'illustration-rare': 'Illustration Rare',
      'special-illustration-rare': 'Special Illustration Rare',
      'secret-rare': 'Secret Rare',
      promo: 'Promo',
      reprint: 'Reprint'
    })[normalizedVariant({variant: value})] || text(value) || 'Normal';
  }

  function normalizedNumber(card) {
    const value = text(card && (card.number || card.collectorNumber || card.cardCode));
    const fraction = value.match(/^\s*([A-Z]{0,5}\s*\d{1,4})\s*\/\s*[A-Z]{0,5}\s*\d{1,4}\s*$/i);
    return keyPart(fraction ? fraction[1] : value);
  }

  function normalizedSet(card) {
    return keyPart(card && (card.setId || card.setCode || card.set));
  }

  function collectionKey(card) {
    const tcg = keyPart(card && card.tcg) || 'unknown';
    const set = normalizedSet(card) || 'noset';
    const number = normalizedNumber(card) || 'nonumber';
    return [tcg, set, number, normalizedLanguage(card), normalizedVariant(card)].join('|');
  }

  function hasMergeIdentity(card) {
    return Boolean(keyPart(card && card.tcg) && normalizedSet(card) && normalizedNumber(card));
  }

  function hasVerifiedMergeIdentity(card) {
    if (!hasMergeIdentity(card)) return false;
    if (card && card.identityVerified === true) return true;
    const explicitLanguage = text(card && (card.lang || card.language));
    const explicitVariant = text(card && (
      card.printingVariant || card.variant || card.finish || card.foilType
    ));
    return Boolean(explicitLanguage && explicitVariant);
  }

  function normalizeEntry(card, index) {
    const source = card && typeof card === 'object' ? card : {};
    const id = source.id != null ? source.id : Date.now() + Number(index || 0);
    const identityVerified = hasVerifiedMergeIdentity(source);
    const existingSpecimens = Array.isArray(source.specimens)
      ? source.specimens.filter(Boolean).map((specimen, specimenIndex) => ({
        ...specimen,
        id: specimen.id || `${id}-copy-${specimenIndex + 1}`
      }))
      : [];
    const hasIndividualData = Boolean(
      source.front || source.back || source.grade || source.pregrade || source.defects
      || source.authenticity || source.notes
    );
    const specimens = existingSpecimens.length ? existingSpecimens : hasIndividualData ? [{
      id: `${id}-copy-1`,
      date: source.date || '',
      front: source.front || null,
      back: source.back || null,
      score: source.score || null,
      grade: source.grade || '',
      pregrade: source.pregrade || null,
      defects: source.defects || null,
      authenticity: source.authenticity || null,
      notes: source.notes || ''
    }] : [];
    const normalized = {
      ...source,
      id,
      lang: normalizedLanguage(source),
      language: normalizedLanguage(source),
      printingVariant: normalizedVariant(source),
      identityVerified,
      quantity: positiveQuantity(source.quantity),
      specimens,
      favorite: Boolean(source.favorite),
      entryMode: source.entryMode || (specimens.length ? 'individual' : 'bulk'),
      estimatedUnitValue: estimatedUnitValue(source),
      currency: priceCurrency(source)
    };
    normalized.collectionKey = identityVerified
      ? collectionKey(normalized)
      : 'legacy|' + keyPart(normalized.tcg || 'unknown') + '|' + keyPart(id);
    return normalized;
  }

  function chooseRicherEntry(current, incoming) {
    const currentWeight = [current.image, current.imageSmall, current.front, current.grade, current.setId]
      .filter(Boolean).length;
    const incomingWeight = [incoming.image, incoming.imageSmall, incoming.front, incoming.grade, incoming.setId]
      .filter(Boolean).length;
    const preferred = incomingWeight > currentWeight ? incoming : current;
    const secondary = preferred === current ? incoming : current;
    const specimenMap = new Map();
    [...(current.specimens || []), ...(incoming.specimens || [])].forEach(specimen => {
      const key = text(specimen && specimen.id) || JSON.stringify(specimen);
      if (!specimenMap.has(key)) specimenMap.set(key, specimen);
    });
    return {
      ...secondary,
      ...preferred,
      image: preferred.image || preferred.imageSmall || secondary.image || secondary.imageSmall || '',
      imageSmall: preferred.imageSmall || secondary.imageSmall || '',
      imageLarge: preferred.imageLarge || secondary.imageLarge || '',
      quantity: current.quantity + incoming.quantity,
      specimens: [...specimenMap.values()],
      favorite: Boolean(current.favorite || incoming.favorite),
      estimatedUnitValue: Math.max(
        finiteNumber(current.estimatedUnitValue), finiteNumber(incoming.estimatedUnitValue)
      ),
      collectionKey: current.collectionKey
    };
  }

  function migrateCollection(rawCollection) {
    const input = Array.isArray(rawCollection) ? rawCollection : [];
    const merged = new Map();
    const output = [];
    let changed = !Array.isArray(rawCollection);
    let mergedCount = 0;
    input.forEach((raw, index) => {
      const entry = normalizeEntry(raw, index);
      if (entry.quantity !== Number(raw && raw.quantity)
          || entry.collectionKey !== text(raw && raw.collectionKey)
          || entry.printingVariant !== text(raw && raw.printingVariant)
          || entry.lang !== text(raw && raw.lang)) {
        changed = true;
      }
      if (!entry.identityVerified) {
        output.push(entry);
        return;
      }
      const existingIndex = merged.get(entry.collectionKey);
      if (existingIndex == null) {
        merged.set(entry.collectionKey, output.length);
        output.push(entry);
        return;
      }
      output[existingIndex] = chooseRicherEntry(output[existingIndex], entry);
      mergedCount++;
      changed = true;
    });
    return {collection: output, changed, mergedCount, schemaVersion: SCHEMA_VERSION};
  }

  function upsertCollection(rawCollection, rawCard) {
    const migrated = migrateCollection(rawCollection);
    const incoming = normalizeEntry({...rawCard, quantity: positiveQuantity(rawCard && rawCard.quantity)}, 0);
    if (incoming.identityVerified) incoming.collectionKey = collectionKey(incoming);
    const index = incoming.identityVerified
      ? migrated.collection.findIndex(item => item.collectionKey === incoming.collectionKey)
      : -1;
    if (index >= 0) {
      const collection = migrated.collection.slice();
      collection[index] = chooseRicherEntry(collection[index], incoming);
      return {collection, entry: collection[index], action: 'QUANTITY_INCREMENT'};
    }
    return {
      collection: [incoming].concat(migrated.collection),
      entry: incoming,
      action: 'NEW_CARD'
    };
  }

  function adjustQuantity(rawCollection, id, delta) {
    const collection = migrateCollection(rawCollection).collection.slice();
    const index = collection.findIndex(card => String(card.id) === String(id));
    if (index < 0) return {collection, removed: false, entry: null};
    const next = collection[index].quantity + Number(delta || 0);
    if (next <= 0) {
      const removed = collection[index];
      collection.splice(index, 1);
      return {collection, removed: true, entry: removed};
    }
    collection[index] = {...collection[index], quantity: next};
    return {collection, removed: false, entry: collection[index]};
  }

  function collectorParts(value) {
    const source = text(value).toUpperCase();
    const match = source.match(/^(?:([A-Z]+)[ -]?)?0*(\d+)/);
    return match ? {prefix: match[1] || '', number: Number(match[2])} : {prefix: source, number: 999999};
  }

  function compareCollector(left, right) {
    const a = collectorParts(left && left.number);
    const b = collectorParts(right && right.number);
    return a.prefix.localeCompare(b.prefix) || a.number - b.number
      || text(left && left.name).localeCompare(text(right && right.name), 'de');
  }

  function matchesFilters(card, filters) {
    const state = filters || {};
    const quantity = positiveQuantity(card && card.quantity);
    if (state.quantity === 'duplicates' && quantity < 2) return false;
    if (state.quantity === 'single' && quantity !== 1) return false;
    if (state.quantity === 'two' && quantity !== 2) return false;
    if (state.quantity === 'threeplus' && quantity < 3) return false;
    if (state.tcg && state.tcg !== 'all' && keyPart(card.tcg) !== keyPart(state.tcg)) return false;
    if (state.language && state.language !== 'all' && normalizedLanguage(card) !== state.language) return false;
    if (state.set && state.set !== 'all' && normalizedSet(card) !== keyPart(state.set)) return false;
    if (state.cardType && state.cardType !== 'all' && keyPart(card.cardType) !== keyPart(state.cardType)) return false;
    if (state.variant && state.variant !== 'all' && normalizedVariant(card) !== normalizedVariant({variant: state.variant})) return false;
    if (state.graded === 'graded' && !(card.grade || card.pregrade || (card.specimens || []).some(item => item.grade || item.pregrade))) return false;
    if (state.graded === 'raw' && (card.grade || card.pregrade || (card.specimens || []).some(item => item.grade || item.pregrade))) return false;
    if (state.favorite === 'favorite' && !card.favorite) return false;
    const value = finiteNumber(card.estimatedUnitValue, estimatedUnitValue(card));
    if (Number.isFinite(Number(state.minValue)) && text(state.minValue) && value < Number(state.minValue)) return false;
    if (Number.isFinite(Number(state.maxValue)) && text(state.maxValue) && value > Number(state.maxValue)) return false;
    const queryTerms = text(state.query).split(/\s+/).map(keyPart).filter(Boolean);
    if (queryTerms.length) {
      const searchable = keyPart([
        card.name, card.number, card.collectorNumber, card.set, card.setId, card.setCode,
        card.language, card.lang, card.tcg, card.printingVariant, card.variant, card.cardType
      ].filter(Boolean).join(' '));
      if (queryTerms.some(term => !searchable.includes(term))) return false;
    }
    return true;
  }

  function printedTotal(card) {
    const direct = [card && card.printedTotal, card && card.setTotal, card && card.total]
      .map(value => Number(value)).find(value => Number.isFinite(value) && value > 0);
    if (direct) return direct;
    const fraction = text(card && card.number).match(/\/\s*0*(\d{1,4})\s*$/);
    return fraction ? Number(fraction[1]) : 0;
  }

  function portfolioSummary(rawCollection) {
    const collection = migrateCollection(rawCollection).collection;
    return collection.reduce((summary, card) => {
      const quantity = positiveQuantity(card.quantity);
      const unitValue = finiteNumber(card.estimatedUnitValue, estimatedUnitValue(card));
      summary.totalCards += quantity;
      summary.distinctCards++;
      summary.duplicates += Math.max(0, quantity - 1);
      summary.estimatedValue += unitValue * quantity;
      if (card.favorite) summary.favorites++;
      if (card.grade || card.pregrade || (card.specimens || []).some(item => item.grade || item.pregrade)) {
        summary.graded++;
      }
      return summary;
    }, {totalCards: 0, distinctCards: 0, duplicates: 0, estimatedValue: 0, favorites: 0, graded: 0});
  }

  function summarizeSets(rawCollection) {
    const collection = migrateCollection(rawCollection).collection;
    const groups = new Map();
    collection.forEach(card => {
      const setKey = [keyPart(card.tcg), normalizedSet(card), normalizedLanguage(card)].join('|');
      if (!groups.has(setKey)) {
        groups.set(setKey, {
          key: setKey,
          tcg: card.tcg,
          setId: card.setId || card.setCode || '',
          set: card.set || card.setId || card.setCode || 'Set unbekannt',
          language: normalizedLanguage(card),
          distinct: 0,
          ownedNumbers: 0,
          total: 0,
          printedTotal: 0,
          estimatedValue: 0,
          variants: {normal: 0, holo: 0, reverse: 0, special: 0},
          cards: []
        });
      }
      const group = groups.get(setKey);
      group.distinct++;
      group.total += positiveQuantity(card.quantity);
      group.printedTotal = Math.max(group.printedTotal, printedTotal(card));
      group.estimatedValue += finiteNumber(card.estimatedUnitValue, estimatedUnitValue(card))
        * positiveQuantity(card.quantity);
      const variant = normalizedVariant(card);
      if (variant === 'normal') group.variants.normal++;
      else if (variant === 'reverse-holo') group.variants.reverse++;
      else if (variant === 'holo') group.variants.holo++;
      else group.variants.special++;
      group.cards.push(card);
    });
    return [...groups.values()].map(group => {
      const ownedNumbers = new Set(group.cards.map(card => normalizedNumber(card)).filter(Boolean)).size;
      return {
        ...group,
        ownedNumbers,
        completion: group.printedTotal ? Math.min(1, ownedNumbers / group.printedTotal) : 0,
        cards: group.cards.sort(compareCollector)
      };
    }).sort((a, b) => text(a.set).localeCompare(text(b.set), 'de'));
  }

  function missingSetNumbers(group) {
    const total = Math.min(999, Math.max(0, Number(group && group.printedTotal) || 0));
    if (!total) return [];
    const owned = new Set((group.cards || []).map(card => {
      const parts = collectorParts(card && card.number);
      return parts.prefix ? '' : String(parts.number);
    }).filter(Boolean));
    const width = Math.max(3, String(total).length);
    const missing = [];
    for (let number = 1; number <= total; number++) {
      if (!owned.has(String(number))) missing.push(String(number).padStart(width, '0'));
    }
    return missing;
  }

  function compareCards(left, right, sort) {
    const mode = sort || 'newest';
    if (mode === 'collector') return compareCollector(left, right);
    if (mode === 'name-asc') return text(left.name).localeCompare(text(right.name), 'de');
    if (mode === 'name-desc') return text(right.name).localeCompare(text(left.name), 'de');
    if (mode === 'value-high') return finiteNumber(right.estimatedUnitValue, estimatedUnitValue(right))
      - finiteNumber(left.estimatedUnitValue, estimatedUnitValue(left));
    if (mode === 'value-low') return finiteNumber(left.estimatedUnitValue, estimatedUnitValue(left))
      - finiteNumber(right.estimatedUnitValue, estimatedUnitValue(right));
    if (mode === 'quantity-high') return positiveQuantity(right.quantity) - positiveQuantity(left.quantity)
      || compareCollector(left, right);
    return text(right.date || right.addedAt).localeCompare(text(left.date || left.addedAt));
  }

  function collectionView(rawCollection, options) {
    const state = options || {};
    const offset = Math.max(0, Number(state.offset) || 0);
    const limit = Math.max(1, Math.min(250, Number(state.limit) || 90));
    const all = migrateCollection(rawCollection).collection
      .filter(card => matchesFilters(card, state.filters || {}))
      .sort((left, right) => compareCards(left, right, state.sort));
    return {total: all.length, offset, limit, cards: all.slice(offset, offset + limit), hasMore: offset + limit < all.length};
  }

  function createScanLock(cooldownMs) {
    return {
      lockedKey: '',
      removed: true,
      lastAcceptedAt: 0,
      cooldownMs: Math.max(800, Math.min(1500, Number(cooldownMs) || 1000))
    };
  }

  function markCardRemoved(lock) {
    return {...(lock || createScanLock()), removed: true};
  }

  function registerScan(lock, key, now) {
    const current = lock || createScanLock();
    const timestamp = Number(now) || Date.now();
    if (!text(key)) return {accepted: false, reason: 'INVALID_KEY', lock: current};
    if (!current.removed && current.lockedKey === key) {
      return {accepted: false, reason: 'SAME_CARD_STILL_PRESENT', lock: current};
    }
    const next = {
      ...current,
      lockedKey: key,
      removed: false,
      lastAcceptedAt: timestamp
    };
    return {accepted: true, reason: 'ACCEPTED', lock: next};
  }

  return {
    SCHEMA_VERSION,
    keyPart,
    positiveQuantity,
    normalizedLanguage,
    normalizedVariant,
    variantLabel,
    estimatedUnitValue,
    priceCurrency,
    collectionKey,
    hasMergeIdentity,
    normalizeEntry,
    migrateCollection,
    upsertCollection,
    adjustQuantity,
    compareCollector,
    matchesFilters,
    portfolioSummary,
    summarizeSets,
    missingSetNumbers,
    compareCards,
    collectionView,
    createScanLock,
    markCardRemoved,
    registerScan
  };
});
