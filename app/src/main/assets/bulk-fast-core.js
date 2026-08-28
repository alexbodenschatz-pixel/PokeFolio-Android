(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeBulkFast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RecognitionMode = Object.freeze({FULL: 'FULL', BULK_FAST: 'BULK_FAST'});
  const CACHE_VERSION = 1;
  const MAX_LOCAL_IDENTITIES = 1200;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function key(value) {
    return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
  }

  function numberKey(value) {
    const raw = text(value).toUpperCase();
    const fraction = raw.match(/([A-Z]{0,5}\d{1,4})\s*[\/／]\s*([A-Z]{0,5}\d{1,4})/);
    if (fraction) return key(fraction[1]) + '/' + key(fraction[2]);
    return key(raw);
  }

  function normalizedTcg(value) {
    const valueKey = key(value);
    if (valueKey === 'YUGIOH') return 'yugioh';
    if (valueKey === 'ONEPIECE') return 'onepiece';
    return valueKey === 'POKEMON' ? 'pokemon' : '';
  }

  function strongestCollector(hints) {
    const values = hints && hints.collectorNumbers || [];
    return values.find(item => item && item.number && item.total && Number(item.votes) >= 1.45)
      || values.find(item => item && item.number && item.total)
      || null;
  }

  function primaryIdentifier(tcg, hints) {
    const kind = normalizedTcg(tcg);
    if (kind === 'pokemon') {
      const collector = strongestCollector(hints);
      if (!collector) return null;
      const number = numberKey(collector.number + '/' + collector.total);
      const setHint = (hints.pokemonSetCodes || []).find(item => Number(item.votes) >= 1.1)
        || (hints.pokemonSetCodes || [])[0];
      const setId = key(setHint && setHint.value);
      return {
        tcg: kind,
        type: setId ? 'SET_COLLECTOR' : 'COLLECTOR',
        value: number,
        setId,
        key: ['pokemon', setId || '*', number].join('|'),
        exact: Boolean(number)
      };
    }
    const raw = text(hints && hints.rawText).toUpperCase();
    if (kind === 'yugioh') {
      const features = hints && hints.yugiohFeatures || {};
      const passcode = text(features.passcode || (raw.match(/\b\d{8}\b/) || [])[0]).replace(/\D/g, '');
      const setCode = text(features.setCode || hints && hints.yugiohSetCode
        || (raw.match(/\b[A-Z0-9]{2,8}-(?:DE|EN|G)?\d{3,4}\b/) || [])[0]).toUpperCase();
      if (passcode) return {tcg: kind, type: 'PASSCODE', value: passcode,
        setId: key(setCode), key: 'yugioh|' + passcode, exact: true};
      if (setCode) return {tcg: kind, type: 'SET_CODE', value: setCode,
        setId: key(setCode), key: 'yugioh|set|' + key(setCode), exact: true};
      return null;
    }
    if (kind === 'onepiece') {
      const features = hints && hints.onePieceFeatures || {};
      const code = text(features.cardCode || hints && hints.onepieceId
        || (raw.match(/\b(?:(?:OP|ST|EB|PRB|EX|DON)\d{2}-\d{3}|P-\d{3})\b/) || [])[0]).toUpperCase();
      return code ? {tcg: kind, type: 'CARD_CODE', value: code, setId: key(code.split('-')[0]),
        key: 'onepiece|' + key(code), exact: true} : null;
    }
    return null;
  }

  function candidateNumber(candidate) {
    const number = candidate && (candidate.number || candidate.collectorNumber || candidate.cardCode);
    const total = candidate && (candidate.printedTotal || candidate.setTotal);
    return numberKey(total && !/[\/／]/.test(text(number)) ? number + '/' + total : number);
  }

  function candidateSet(candidate) {
    return key(candidate && (candidate.setId || candidate.setCode || candidate.set));
  }

  function isExactCandidate(identifier, candidate) {
    if (!identifier || !candidate || normalizedTcg(candidate.tcg) !== identifier.tcg) return false;
    if (identifier.tcg === 'pokemon') {
      if (candidateNumber(candidate) !== identifier.value) return false;
      return !identifier.setId || candidateSet(candidate) === identifier.setId;
    }
    if (identifier.tcg === 'yugioh' && identifier.type === 'PASSCODE') {
      return key(candidate.passcode || candidate.id) === key(identifier.value);
    }
    if (identifier.tcg === 'yugioh') {
      const codes = [candidate.setCode, candidate.number].concat(candidate.setCodes || []).map(key);
      return codes.includes(key(identifier.value));
    }
    return key(candidate.number || candidate.cardCode || candidate.id) === key(identifier.value);
  }

  function uniqueExactCandidate(identifier, candidates) {
    const exact = (Array.isArray(candidates) ? candidates : []).filter(candidate =>
      isExactCandidate(identifier, candidate));
    return exact.length === 1 ? exact[0] : null;
  }

  function compactCandidate(candidate) {
    if (!candidate) return null;
    return {
      tcg: normalizedTcg(candidate.tcg), id: candidate.id || '', passcode: candidate.passcode || '',
      cardType: candidate.cardType || '', name: candidate.name || '', set: candidate.set || '',
      setId: candidate.setId || candidate.setCode || '', setCode: candidate.setCode || '',
      setCodes: Array.isArray(candidate.setCodes) ? candidate.setCodes.slice(0, 12) : [],
      number: candidate.number || candidate.cardCode || '', printedTotal: candidate.printedTotal || '',
      rarity: candidate.rarity || '', hp: candidate.hp || '', language: candidate.language || '',
      printingVariant: candidate.printingVariant || candidate.variant || 'unknown',
      variantSelectionConfirmed: candidate.variantSelectionConfirmed === true,
      imageSmall: candidate.imageSmall || candidate.image || '', imageLarge: candidate.imageLarge || '',
      source: candidate.source || '', identificationScore: Number(candidate.identificationScore) || 0.99,
      confidence: Number(candidate.confidence) || Number(candidate.identificationScore) || 0.99
    };
  }

  function createSession() {
    return {
      cache: new Map(),
      uniqueKeys: new Set(),
      stats: {scanned: 0, uniqueCards: 0, quantityAdded: 0, automatic: 0,
        manual: 0, uncertain: 0, failed: 0}
    };
  }

  function sessionGet(session, identifier) {
    return session && identifier && session.cache.get(identifier.key) || null;
  }

  function sessionPut(session, identifier, candidate) {
    const compact = compactCandidate(candidate);
    if (!session || !identifier || !compact) return null;
    session.cache.set(identifier.key, compact);
    return compact;
  }

  function loadLocalCache(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    const entries = parsed && parsed.version === CACHE_VERSION && Array.isArray(parsed.entries)
      ? parsed.entries : [];
    const byKey = new Map();
    entries.forEach(entry => {
      if (entry && entry.identifierKey && entry.card) byKey.set(entry.identifierKey, entry);
    });
    return {version: CACHE_VERSION, byKey};
  }

  function localGet(cache, identifier) {
    const entry = cache && identifier && cache.byKey.get(identifier.key);
    return entry && compactCandidate(entry.card) || null;
  }

  function localPut(cache, identifier, candidate, now) {
    if (!cache || !identifier || !candidate) return cache;
    cache.byKey.set(identifier.key, {
      identifierKey: identifier.key,
      updatedAt: Number(now) || Date.now(),
      card: compactCandidate(candidate)
    });
    if (cache.byKey.size > MAX_LOCAL_IDENTITIES) {
      const oldest = [...cache.byKey.values()].sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, cache.byKey.size - MAX_LOCAL_IDENTITIES);
      oldest.forEach(entry => cache.byKey.delete(entry.identifierKey));
    }
    return cache;
  }

  function serializeLocalCache(cache) {
    return JSON.stringify({version: CACHE_VERSION,
      entries: [...(cache && cache.byKey || new Map()).values()]});
  }

  function collectionMatch(collection, identifier) {
    return uniqueExactCandidate(identifier, collection);
  }

  function recordAccepted(session, collectionKey, automatic) {
    if (!session) return;
    session.stats.quantityAdded++;
    if (!session.uniqueKeys.has(collectionKey)) {
      session.uniqueKeys.add(collectionKey);
      session.stats.uniqueCards++;
    }
    if (automatic) session.stats.automatic++;
    else session.stats.manual++;
  }

  function beginScan(session) {
    if (session) session.stats.scanned++;
  }

  function recordUncertain(session) {
    if (session) session.stats.uncertain++;
  }

  function recordFailed(session) {
    if (session) session.stats.failed++;
  }

  function createMetrics(start) {
    return {startedAt: Number(start) || 0, captureToCropMs: 0, orientationMs: 0,
      identifierOcrMs: 0, exactLookupMs: 0, artworkFallbackMs: 0,
      collectionWriteMs: 0, totalBulkRecognitionMs: 0, lookupSource: 'NONE'};
  }

  function finishMetrics(metrics, end) {
    const output = {...metrics};
    output.totalBulkRecognitionMs = Math.max(0, (Number(end) || 0) - Number(output.startedAt || 0));
    return output;
  }

  return {
    RecognitionMode, CACHE_VERSION, MAX_LOCAL_IDENTITIES,
    key, numberKey, primaryIdentifier, isExactCandidate, uniqueExactCandidate,
    compactCandidate, createSession, sessionGet, sessionPut,
    loadLocalCache, localGet, localPut, serializeLocalCache, collectionMatch,
    beginScan, recordAccepted, recordUncertain, recordFailed, createMetrics, finishMetrics
  };
});
