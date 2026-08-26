(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokeLearning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DEFAULT_CONFIG = Object.freeze({
    learnFromConfirmed: true,
    useLearnedReferences: true,
    maxReferencesPerVariant: 8,
    maxReferencesTotal: 2500,
    maxEvents: 3000,
    maxStorageBytes: 3_500_000,
    minimumReferenceQuality: 0.52
  });
  const SIGNAL_NAMES = ['number', 'set', 'name', 'artwork', 'ocr', 'language', 'variant'];

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function key(value) {
    return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function languageKey(value) {
    const normalized = key(value);
    if (['de', 'deu', 'deutsch', 'german'].includes(normalized)) return 'de';
    if (['en', 'eng', 'english', 'englisch'].includes(normalized)) return 'en';
    if (['ja', 'jpn', 'japanese', 'japanisch'].includes(normalized)) return 'ja';
    if (['ko', 'kor', 'korean', 'koreanisch'].includes(normalized)) return 'ko';
    if (normalized.startsWith('zh')) return normalized.includes('tw') || normalized.includes('hant') ? 'zh-tw' : 'zh-cn';
    return normalized || 'unknown';
  }

  function numberKey(value) {
    const raw = text(value).toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, '');
    if (!raw) return '';
    const fraction = raw.match(/^([A-Z]{0,5}\d{1,4})\/[A-Z]{0,5}\d{1,4}$/);
    if (fraction) return key(fraction[1]).replace(/^0+(?=\d)/, '');
    return key(raw).replace(/^0+(?=\d)/, '');
  }

  function setKey(card) {
    return key(card && (card.setId || card.setCode || card.set));
  }

  function variantKey(card) {
    return key(card && (card.printingVariant || card.variant || card.finish || 'normal')) || 'normal';
  }

  function cardIdentityId(card) {
    if (!card) return '';
    const stable = [key(card.tcg), setKey(card), numberKey(card.number), languageKey(card.language || card.lang)];
    if (stable[0] && stable[1] && stable[2]) return stable.join('|');
    const explicit = key(card.id || card.cardId || card.referenceId);
    return explicit ? [key(card.tcg), explicit, languageKey(card.language || card.lang)].join('|') : '';
  }

  function variantIdentityId(card) {
    const identity = cardIdentityId(card);
    return identity ? identity + '|' + variantKey(card) : '';
  }

  function cardId(card) {
    return text(card && (card.id || card.cardId || card.referenceId)) || cardIdentityId(card);
  }

  function defaultAdaptiveSignals() {
    return Object.fromEntries(SIGNAL_NAMES.map(name => [name, {samples: 0, mean: 0.5, multiplier: 1}]));
  }

  function createState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      config: {...DEFAULT_CONFIG},
      references: [],
      events: [],
      adaptiveSignals: defaultAdaptiveSignals()
    };
  }

  function migrateState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const state = createState();
    state.config = {...DEFAULT_CONFIG, ...(source.config || {})};
    state.references = Array.isArray(source.references) ? source.references.map(reference => ({
      ...reference,
      qualityScore: clamp(reference.qualityScore),
      language: languageKey(reference.language),
      variant: key(reference.variant) || 'normal'
    })).filter(reference => reference.cardIdentityId && reference.fingerprint) : [];
    state.events = Array.isArray(source.events) ? source.events.filter(event => event && event.eventType) : [];
    SIGNAL_NAMES.forEach(name => {
      const signal = source.adaptiveSignals && source.adaptiveSignals[name];
      if (!signal) return;
      state.adaptiveSignals[name] = {
        samples: Math.max(0, Number(signal.samples) || 0),
        mean: clamp(signal.mean),
        multiplier: clamp(signal.multiplier, 0.92, 1.08)
      };
    });
    return pruneState(state);
  }

  function sanitizeArray(value, maximum) {
    return (Array.isArray(value) ? value : []).slice(0, maximum).map(item => Number(clamp(item)));
  }

  function sanitizeFingerprint(value) {
    if (!value || typeof value !== 'object') return null;
    const fingerprint = {
      perceptualHash: text(value.perceptualHash).slice(0, 128),
      differenceHash: text(value.differenceHash).slice(0, 128),
      artworkHash: text(value.artworkHash).slice(0, 128),
      histogram: sanitizeArray(value.histogram, 32),
      layout: sanitizeArray(value.layout, 48)
    };
    if (!fingerprint.perceptualHash && !fingerprint.differenceHash
        && !fingerprint.artworkHash && !fingerprint.histogram.length) return null;
    return fingerprint;
  }

  function sanitizeOcr(value) {
    const source = value || {};
    return {
      cardType: text(source.cardType).slice(0, 24),
      name: text(source.name).slice(0, 100),
      titleSource: text(source.titleSource).slice(0, 32),
      manualTitleHint: text(source.manualTitleHint).slice(0, 100),
      manualTitleSource: text(source.manualTitleSource).slice(0, 24),
      number: text(source.number).slice(0, 32),
      set: text(source.set).slice(0, 60),
      language: languageKey(source.language),
      attacks: (source.attacks || []).slice(0, 5).map(item => text(item).slice(0, 80)),
      damages: (source.damages || []).slice(0, 8).map(item => text(item).slice(0, 16))
    };
  }

  function cardSnapshot(card) {
    return {
      id: cardId(card),
      tcg: text(card && card.tcg),
      name: text(card && card.name).slice(0, 120),
      set: text(card && card.set).slice(0, 120),
      setId: text(card && (card.setId || card.setCode)).slice(0, 60),
      number: text(card && card.number).slice(0, 40),
      printedTotal: text(card && (card.printedTotal || card.setTotal)).slice(0, 12),
      language: languageKey(card && (card.language || card.lang)),
      variant: text(card && (card.printingVariant || card.variant || 'normal')).slice(0, 60),
      cardType: text(card && card.cardType).slice(0, 30),
      rarity: text(card && card.rarity).slice(0, 80),
      imageSmall: text(card && card.imageSmall).slice(0, 500),
      imageLarge: text(card && card.imageLarge).slice(0, 500),
      source: text(card && card.source).slice(0, 100)
    };
  }

  function hammingScore(left, right) {
    if (!left || !right || left.length !== right.length) return null;
    let differences = 0;
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) differences++;
    return clamp(1 - differences / left.length);
  }

  function cosineScore(left, right) {
    if (!left || !right || !left.length || left.length !== right.length) return null;
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let index = 0; index < left.length; index++) {
      dot += left[index] * right[index];
      a += left[index] * left[index];
      b += right[index] * right[index];
    }
    return a && b ? clamp(dot / Math.sqrt(a * b)) : null;
  }

  function fingerprintSimilarity(left, right) {
    const a = sanitizeFingerprint(left);
    const b = sanitizeFingerprint(right);
    if (!a || !b) return {score: 0, artwork: 0, components: {}};
    const components = {
      perceptual: hammingScore(a.perceptualHash, b.perceptualHash),
      difference: hammingScore(a.differenceHash, b.differenceHash),
      artwork: hammingScore(a.artworkHash, b.artworkHash),
      histogram: cosineScore(a.histogram, b.histogram),
      layout: cosineScore(a.layout, b.layout)
    };
    const weights = {perceptual: 0.28, difference: 0.17, artwork: 0.31, histogram: 0.12, layout: 0.12};
    let total = 0;
    let weight = 0;
    Object.entries(weights).forEach(([name, value]) => {
      if (components[name] == null) return;
      total += components[name] * value;
      weight += value;
    });
    return {
      score: weight ? clamp(total / weight) : 0,
      artwork: components.artwork == null ? 0 : components.artwork,
      components
    };
  }

  function contextStatus(reference, context) {
    const number = numberKey(context && context.number);
    const set = key(context && context.setId || context && context.set);
    const language = languageKey(context && context.language);
    const referenceNumber = numberKey(reference.cardNumber);
    const referenceSet = key(reference.setId);
    const referenceLanguage = languageKey(reference.language);
    return {
      number: number && referenceNumber ? number === referenceNumber ? 'match' : 'mismatch' : 'unknown',
      set: set && referenceSet ? set === referenceSet ? 'match' : 'mismatch' : 'unknown',
      language: language !== 'unknown' && referenceLanguage !== 'unknown'
        ? language === referenceLanguage ? 'match' : 'mismatch' : 'unknown'
    };
  }

  function updateAdaptiveSignals(state, results, corrected) {
    const next = {...state.adaptiveSignals};
    const alpha = corrected ? 0.025 : 0.012;
    SIGNAL_NAMES.forEach(name => {
      const status = results && results[name];
      if (status !== 'match' && status !== 'mismatch') return;
      const current = next[name] || {samples: 0, mean: 0.5, multiplier: 1};
      const target = status === 'match' ? 1 : 0;
      const mean = clamp(current.mean + alpha * (target - current.mean));
      next[name] = {
        samples: current.samples + 1,
        mean,
        multiplier: clamp(1 + (mean - 0.5) * 0.16, 0.92, 1.08)
      };
    });
    state.adaptiveSignals = next;
  }

  function pruneState(input) {
    const state = input;
    const config = {...DEFAULT_CONFIG, ...(state.config || {})};
    state.config = config;
    state.events = (state.events || []).slice(-config.maxEvents);
    if (state.references.length > config.maxReferencesTotal) {
      state.references = state.references.slice().sort((a, b) =>
        Number(b.qualityScore) - Number(a.qualityScore) || text(b.createdAt).localeCompare(text(a.createdAt))
      ).slice(0, config.maxReferencesTotal);
    }
    let guard = state.references.length;
    while (guard-- > 0 && JSON.stringify(state).length * 2 > config.maxStorageBytes && state.references.length) {
      let worstIndex = 0;
      state.references.forEach((reference, index) => {
        if (Number(reference.qualityScore) < Number(state.references[worstIndex].qualityScore)) worstIndex = index;
      });
      state.references.splice(worstIndex, 1);
    }
    return state;
  }

  function recordOutcome(rawState, input) {
    const state = migrateState(rawState);
    const eventType = text(input && input.eventType).toUpperCase();
    if (!['CONFIRMED', 'CORRECTED', 'REJECTED'].includes(eventType)) {
      return {state, stored: false, reason: 'INVALID_EVENT'};
    }
    const confirmed = input && input.confirmedCard;
    const predicted = input && input.predictedCard;
    const confirmedIdentity = cardIdentityId(confirmed);
    const fingerprint = sanitizeFingerprint(input && input.fingerprint);
    const qualityScore = clamp(input && input.qualityScore);
    const event = {
      id: 'le_' + text(input && input.timestamp || Date.now()) + '_' + state.events.length,
      timestamp: new Date(input && input.timestamp || Date.now()).toISOString(),
      predictedCardId: cardId(predicted),
      confirmedCardId: cardId(confirmed),
      eventType,
      learningEventType: eventType === 'CORRECTED' ? 'USER_CORRECTION'
        : eventType === 'CONFIRMED' ? 'USER_CONFIRMED' : 'USER_REJECTED',
      correctionReason: text(input && input.correctionReason).slice(0, 40),
      confidenceBefore: clamp(input && input.confidenceBefore),
      confidenceAfter: clamp(input && input.confidenceAfter),
      source: text(input && input.source).slice(0, 40) || 'scan',
      referenceId: '',
      ocrFeatures: sanitizeOcr(input && input.ocrFeatures)
    };
    state.events.push(event);
    if (eventType === 'REJECTED') {
      pruneState(state);
      return {state, stored: true, event, referenceAction: 'NONE'};
    }
    const corrected = eventType === 'CORRECTED';
    updateAdaptiveSignals(state, input && input.signalResults, corrected);
    if (!state.config.learnFromConfirmed) {
      pruneState(state);
      return {state, stored: true, event, referenceAction: 'DISABLED'};
    }
    if (!confirmedIdentity || !fingerprint) {
      pruneState(state);
      return {state, stored: true, event, referenceAction: 'MISSING_FEATURES'};
    }
    if (qualityScore < state.config.minimumReferenceQuality) {
      pruneState(state);
      return {state, stored: true, event, referenceAction: 'LOW_QUALITY'};
    }

    const variantId = variantIdentityId(confirmed);
    const sameVariant = state.references.filter(reference => reference.variantIdentityId === variantId);
    const duplicate = sameVariant.map(reference => ({reference, similarity: fingerprintSimilarity(fingerprint, reference.fingerprint)}))
      .sort((a, b) => b.similarity.score - a.similarity.score)[0];
    if (duplicate && duplicate.similarity.score >= 0.965) {
      event.referenceId = duplicate.reference.id;
      if (qualityScore >= Number(duplicate.reference.qualityScore) + 0.15) {
        duplicate.reference.fingerprint = fingerprint;
        duplicate.reference.qualityScore = qualityScore;
        duplicate.reference.quality = input.quality || {};
        duplicate.reference.createdAt = event.timestamp;
        duplicate.reference.confirmationType = corrected ? 'USER_CORRECTED' : 'USER_CONFIRMED';
        duplicate.reference.negativeCardId = corrected ? cardId(predicted) : '';
        pruneState(state);
        return {state, stored: true, event, reference: duplicate.reference, referenceAction: 'REPLACED_DUPLICATE'};
      }
      pruneState(state);
      return {state, stored: true, event, reference: duplicate.reference, referenceAction: 'SKIPPED_DUPLICATE'};
    }

    const reference = {
      id: 'lr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      cardIdentityId: confirmedIdentity,
      variantIdentityId: variantId,
      cardIdentity: cardSnapshot(confirmed),
      setId: text(confirmed.setId || confirmed.setCode || confirmed.set),
      cardNumber: text(confirmed.number),
      language: languageKey(confirmed.language || confirmed.lang),
      variant: variantKey(confirmed),
      cardName: text(confirmed.name),
      confirmedReferenceId: cardId(confirmed),
      fingerprint,
      visualEmbedding: fingerprint.layout,
      artworkEmbedding: fingerprint.artworkHash,
      perceptualHash: fingerprint.perceptualHash,
      ocrFeatures: sanitizeOcr(input.ocrFeatures),
      createdAt: event.timestamp,
      confirmationType: corrected ? 'USER_CORRECTED' : 'USER_CONFIRMED',
      negativeCardId: corrected ? cardId(predicted) : '',
      qualityScore,
      quality: input.quality || {}
    };
    state.references.push(reference);
    event.referenceId = reference.id;

    const updatedVariant = state.references.filter(item => item.variantIdentityId === variantId);
    if (updatedVariant.length > state.config.maxReferencesPerVariant) {
      const removable = updatedVariant.slice().sort((a, b) => Number(a.qualityScore) - Number(b.qualityScore))[0];
      state.references = state.references.filter(item => item.id !== removable.id);
    }
    pruneState(state);
    return {state, stored: true, event, reference, referenceAction: 'ADDED'};
  }

  function findMatches(rawState, fingerprintValue, context, limit = 12) {
    const state = migrateState(rawState);
    if (!state.config.useLearnedReferences) return {matches: [], referencesChecked: 0, state};
    const fingerprint = sanitizeFingerprint(fingerprintValue);
    if (!fingerprint) return {matches: [], referencesChecked: 0, state};
    const tcg = key(context && context.tcg);
    const language = languageKey(context && context.language);
    const pool = state.references.filter(reference => {
      if (tcg && key(reference.cardIdentity.tcg) !== tcg) return false;
      if (language !== 'unknown' && reference.language !== 'unknown' && reference.language !== language) return false;
      const status = contextStatus(reference, context);
      return status.number !== 'mismatch' && status.set !== 'mismatch';
    });
    const groups = new Map();
    pool.forEach(reference => {
      const similarity = fingerprintSimilarity(fingerprint, reference.fingerprint);
      const adjusted = clamp(similarity.score * (0.85 + Number(reference.qualityScore) * 0.15));
      if (!groups.has(reference.variantIdentityId)) groups.set(reference.variantIdentityId, []);
      groups.get(reference.variantIdentityId).push({reference, similarity, adjusted});
    });
    const matches = [...groups.values()].map(items => {
      items.sort((a, b) => b.adjusted - a.adjusted);
      const best = items[0];
      const second = items[1];
      const score = clamp(best.adjusted * 0.82 + (second ? second.adjusted : best.adjusted) * 0.18);
      const corrections = items.filter(item => item.reference.confirmationType === 'USER_CORRECTED').length;
      return {
        cardIdentityId: best.reference.cardIdentityId,
        variantIdentityId: best.reference.variantIdentityId,
        card: best.reference.cardIdentity,
        score,
        artwork: best.similarity.artwork,
        qualityScore: Number(best.reference.qualityScore),
        references: items.length,
        corrections,
        consistency: contextStatus(best.reference, context),
        negativeCardIds: [...new Set(items.map(item => item.reference.negativeCardId).filter(Boolean))],
        components: best.similarity.components
      };
    }).filter(match => match.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Number(limit) || 12));
    return {matches, referencesChecked: pool.length, state};
  }

  function cardsEquivalent(candidate, stored) {
    if (!candidate || !stored) return false;
    if (cardId(candidate) && cardId(stored) && key(cardId(candidate)) === key(cardId(stored))) return true;
    const candidateSet = setKey(candidate);
    const storedSet = setKey(stored);
    const candidateNumber = numberKey(candidate.number);
    const storedNumber = numberKey(stored.number);
    return Boolean(candidateSet && storedSet && candidateNumber && storedNumber
      && candidateSet === storedSet && candidateNumber === storedNumber
      && (!candidate.name || !stored.name || key(candidate.name) === key(stored.name)));
  }

  function enrichCandidates(rawState, candidates, matchResult, context) {
    const state = migrateState(rawState);
    const matches = matchResult && matchResult.matches || [];
    return (candidates || []).map(candidate => {
      const base = clamp(candidate.finalConfidence != null ? candidate.finalConfidence : candidate.confidence);
      const positive = matches.find(match => cardsEquivalent(candidate, match.card));
      const candidateId = cardId(candidate);
      const negative = matches.some(match => match.negativeCardIds.some(id => key(id) === key(candidateId)) && match.score >= 0.82);
      if (!positive) {
        const penalty = negative ? 0.07 : 0;
        return {...candidate, confidence: clamp(base - penalty), finalConfidence: clamp(base - penalty),
          learnedVisualScore: null, learnedArtworkScore: null, correctionConfidence: negative ? -penalty : 0};
      }
      const contradiction = positive.consistency.number === 'mismatch' || positive.consistency.set === 'mismatch';
      const structured = positive.consistency.number === 'match' && positive.consistency.set !== 'mismatch';
      const adaptive = state.adaptiveSignals.artwork && state.adaptiveSignals.artwork.multiplier || 1;
      const adaptiveStructure = structured
        ? ((state.adaptiveSignals.number.multiplier || 1) + (state.adaptiveSignals.set.multiplier || 1)) / 2
        : (state.adaptiveSignals.name.multiplier || 1);
      const learned = clamp(positive.score * adaptive);
      let boost = contradiction ? 0 : clamp((learned - 0.52) * (structured ? 0.30 : 0.19)
        * adaptiveStructure, 0, structured ? 0.15 : 0.08);
      if (structured && positive.consistency.set === 'match') boost += 0.035;
      const correctionBoost = contradiction ? 0 : clamp(positive.corrections * 0.018, 0, 0.055);
      const final = clamp(base + boost + correctionBoost - (negative ? 0.04 : 0), 0, 0.99);
      const details = {...(candidate.matchDetails || {}), learnedVisual: learned,
        learnedArtwork: positive.artwork, numberConsistency: positive.consistency.number,
        setConsistency: positive.consistency.set};
      return {
        ...candidate,
        confidence: final,
        finalConfidence: final,
        identificationScore: clamp((Number(candidate.identificationScore) || base) + boost + correctionBoost, 0, 0.99),
        visualVariantScore: Number.isFinite(Number(candidate.visualVariantScore))
          ? clamp(Number(candidate.visualVariantScore) * 0.72 + positive.artwork * 0.28) : positive.artwork,
        learnedVisualScore: learned,
        learnedArtworkScore: positive.artwork,
        correctionConfidence: correctionBoost,
        localReferencesMatched: positive.references,
        localRecognition: true,
        matchDetails: details,
        evidence: [...new Set([...(candidate.evidence || []), 'Lokale Referenz'])]
      };
    }).sort((a, b) => Number(b.confidence) - Number(a.confidence));
  }

  function offlineCandidates(matchResult, context) {
    return (matchResult && matchResult.matches || []).filter(match => match.score >= 0.72).map(match => {
      const structured = match.consistency.number === 'match' && match.consistency.set !== 'mismatch';
      const confidence = clamp(match.score * 0.78 + (structured ? 0.16 : 0.04), 0, structured ? 0.94 : 0.86);
      return {
        ...match.card,
        printingVariant: match.card.variant,
        confidence,
        finalConfidence: confidence,
        identificationScore: confidence,
        visualVariantScore: match.artwork,
        dataConfidence: structured ? 0.86 : 0.52,
        learnedVisualScore: match.score,
        learnedArtworkScore: match.artwork,
        correctionConfidence: clamp(match.corrections * 0.018, 0, 0.055),
        localReferencesMatched: match.references,
        localRecognition: true,
        offline: true,
        source: 'Lokales Lernsystem (offline)',
        evidence: ['Lokale Referenz', structured ? 'Kartennummer' : 'Artwork ähnlich'],
        matchDetails: {
          collector: match.consistency.number,
          set: match.consistency.set,
          language: match.consistency.language,
          artwork: match.artwork,
          learnedVisual: match.score,
          visualReliable: true
        }
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  function isFastBulkMatch(matchResult) {
    const matches = matchResult && matchResult.matches || [];
    const best = matches[0];
    if (!best) return false;
    const second = matches[1];
    return best.score >= 0.92 && best.artwork >= 0.88 && best.qualityScore >= 0.62
      && best.consistency.number === 'match' && best.consistency.set !== 'mismatch'
      && (!second || best.score - second.score >= 0.08);
  }

  function statistics(rawState) {
    const state = migrateState(rawState);
    const identities = new Set(state.references.map(reference => reference.cardIdentityId));
    return {
      confirmed: state.events.filter(event => event.eventType === 'CONFIRMED').length,
      corrected: state.events.filter(event => event.eventType === 'CORRECTED').length,
      rejected: state.events.filter(event => event.eventType === 'REJECTED').length,
      learnedCards: identities.size,
      references: state.references.length,
      storageBytes: JSON.stringify(state).length * 2
    };
  }

  function cardLearningStatus(rawState, card) {
    const state = migrateState(rawState);
    const identity = cardIdentityId(card);
    const references = state.references.filter(reference => reference.cardIdentityId === identity);
    const confirmedIds = new Set([cardId(card), ...references.map(reference => reference.confirmedReferenceId)]
      .filter(Boolean).map(key));
    const referenceIds = new Set(references.map(reference => reference.id));
    const events = state.events.filter(event => confirmedIds.has(key(event.confirmedCardId))
      || referenceIds.has(event.referenceId));
    const confidences = events.map(event => Number(event.confidenceAfter)).filter(Number.isFinite);
    return {
      references: references.length,
      lastConfidence: confidences.length ? confidences[confidences.length - 1] : 0,
      averageConfidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0,
      optimized: references.length >= 2
    };
  }

  return {
    SCHEMA_VERSION,
    DEFAULT_CONFIG,
    createState,
    migrateState,
    sanitizeFingerprint,
    fingerprintSimilarity,
    cardIdentityId,
    variantIdentityId,
    cardId,
    numberKey,
    recordOutcome,
    findMatches,
    enrichCandidates,
    offlineCandidates,
    isFastBulkMatch,
    statistics,
    cardLearningStatus,
    cardsEquivalent
  };
});
