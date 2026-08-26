(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokeGrading = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, finite(value)));
  }

  function keyPart(value) {
    return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function cardIdentityId(card) {
    if (!card) return 'unknown-card';
    if (text(card.collectionKey)) return text(card.collectionKey);
    const tcg = keyPart(card.tcg) || 'unknown';
    const set = keyPart(card.setId || card.setCode || card.set) || 'noset';
    const number = keyPart(card.number || card.collectorNumber || card.cardCode) || 'nonumber';
    const language = keyPart(card.language || card.lang) || 'unknown';
    const variant = keyPart(card.printingVariant || card.variant || card.finish) || 'normal';
    return [tcg, set, number, language, variant].join('|');
  }

  function normalizeAuthenticity(value) {
    const source = value && typeof value === 'object' ? value : {status: value};
    const input = text(source.status).toUpperCase();
    const status = input === 'LIKELY_ORIGINAL' || /ORIGINAL|WAHRSCHEINLICH/.test(input)
      ? 'LIKELY_ORIGINAL'
      : input === 'SUSPICIOUS' || /AUFFAELLIG|AUFFÄLLIG|VERDAECHTIG|VERDÄCHTIG/.test(input)
        ? 'SUSPICIOUS' : 'INCONCLUSIVE';
    return {
      status,
      confidence: clamp(source.confidence, 0, 1),
      reasons: Array.isArray(source.reasons) ? source.reasons.map(text).filter(Boolean) : []
    };
  }

  function normalizeSubscores(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalizeSide = side => {
      const input = source[side] && typeof source[side] === 'object' ? source[side] : {};
      return {
        centering: clamp(input.centering, 0, 100),
        corners: clamp(input.corners, 0, 100),
        edges: clamp(input.edges, 0, 100),
        surface: clamp(input.surface, 0, 100)
      };
    };
    return {front: normalizeSide('front'), back: normalizeSide('back')};
  }

  function scoreFromSubscores(subscores) {
    const normalized = normalizeSubscores(subscores);
    const values = ['front', 'back'].flatMap(side => [
      normalized[side].centering,
      normalized[side].corners,
      normalized[side].edges,
      normalized[side].surface
    ]).filter(value => Number.isFinite(value));
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10);
  }

  function pregradeFromScore(score) {
    return Math.round(clamp(score, 0, 1000)) / 100;
  }

  function gradeLabel(score) {
    const pregrade = pregradeFromScore(score);
    if (pregrade >= 9.5) return '9,5–10 sehr starker Bereich';
    if (pregrade >= 9) return '9 Mint-Bereich';
    if (pregrade >= 8.5) return '8,5 NM-MT+';
    if (pregrade >= 8) return '8 NM-MT';
    if (pregrade >= 7) return '7 Near Mint';
    return 'unter 7';
  }

  function evaluateImageQuality(metrics) {
    const value = metrics && typeof metrics === 'object' ? metrics : {};
    const width = finite(value.originalWidth || value.width);
    const height = finite(value.originalHeight || value.height);
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    const sharpness = finite(value.sharpness, finite(value.quality));
    const mean = finite(value.mean, 132);
    const reflectionRatio = clamp(value.reflectionRatio, 0, 1);
    const shadowRatio = clamp(value.shadowRatio, 0, 1);
    const cropReliable = value.cropReliable !== false;
    const cardComplete = value.cardComplete !== false;
    const perspectiveConfidence = value.perspectiveConfidence == null
      ? 1 : clamp(value.perspectiveConfidence, 0, 1);

    const checks = {
      resolution: shortSide >= 480 && longSide >= 650,
      sharpness: sharpness >= 66,
      exposure: mean >= 38 && mean <= 222 && shadowRatio <= 0.42,
      reflection: reflectionRatio <= 0.17,
      completeCard: cropReliable && cardComplete,
      perspective: perspectiveConfidence >= 0.48
    };
    const qualityScore = clamp((
      (checks.resolution ? 1 : 0) * 0.20
      + clamp((sharpness - 45) / 45, 0, 1) * 0.25
      + (checks.exposure ? 1 : 0) * 0.18
      + (1 - reflectionRatio) * 0.14
      + (checks.completeCard ? 1 : 0) * 0.15
      + perspectiveConfidence * 0.08
    ), 0, 1);
    const reasons = [];
    if (!checks.resolution) reasons.push('Auflösung zu niedrig');
    if (!checks.sharpness) reasons.push('Aufnahme zu unscharf');
    if (!checks.exposure) reasons.push('Belichtung oder Schatten ungeeignet');
    if (!checks.reflection) reasons.push('Zu starke Reflexion');
    if (!checks.completeCard) reasons.push('Karte nicht vollständig oder Crop unsicher');
    if (!checks.perspective) reasons.push('Perspektive zu unsicher');
    return {
      eligible: Object.values(checks).every(Boolean) && qualityScore >= 0.68,
      qualityScore,
      checks,
      reasons,
      width,
      height,
      sharpness,
      mean,
      reflectionRatio,
      shadowRatio,
      perspectiveConfidence
    };
  }

  function createState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      records: Array.isArray(source.records) ? source.records.map(normalizeRecord) : [],
      migratedLegacyIds: Array.isArray(source.migratedLegacyIds)
        ? [...new Set(source.migratedLegacyIds.map(text).filter(Boolean))] : []
    };
  }

  function normalizeRecord(record, index) {
    const source = record && typeof record === 'object' ? record : {};
    const subscores = normalizeSubscores(source.subscores || {
      front: source.front,
      back: source.back
    });
    const conditionScore = clamp(
      source.conditionScore != null ? source.conditionScore
        : source.score != null ? source.score : scoreFromSubscores(subscores),
      0,
      1000
    );
    return {
      ...source,
      id: text(source.id) || `grading-${Date.now()}-${index || 0}`,
      cardIdentityId: text(source.cardIdentityId) || cardIdentityId(source.cardIdentity || source),
      collectionId: text(source.collectionId),
      collectionKey: text(source.collectionKey),
      specimenIndex: Math.max(1, Math.floor(finite(source.specimenIndex, 1))),
      createdAt: text(source.createdAt || source.date) || new Date().toISOString(),
      conditionScore,
      pregrade: source.pregrade != null && Number.isFinite(Number(source.pregrade))
        ? clamp(source.pregrade, 0, 10) : pregradeFromScore(conditionScore),
      gradeLabel: text(source.gradeLabel || source.grade) || gradeLabel(conditionScore),
      subscores,
      authenticity: normalizeAuthenticity(source.authenticity),
      defects: Array.isArray(source.defects) ? source.defects : [],
      marketSnapshot: source.marketSnapshot && typeof source.marketSnapshot === 'object'
        ? source.marketSnapshot : null,
      quality: source.quality && typeof source.quality === 'object' ? source.quality : null,
      source: text(source.source) || 'POKEFOLIO_PREGRADING',
      notes: text(source.notes)
    };
  }

  function hasLegacyGrading(specimen) {
    return Boolean(specimen && (
      specimen.grade || specimen.pregrade || specimen.score || specimen.front || specimen.back
      || specimen.defects || specimen.authenticity
    ));
  }

  function legacyRecord(card, specimen, specimenIndex) {
    const legacyId = `${text(card.id)}|${text(specimen.id) || specimenIndex}`;
    const subscores = normalizeSubscores({front: specimen.front, back: specimen.back});
    const score = specimen.score != null ? finite(specimen.score) : scoreFromSubscores(subscores);
    return normalizeRecord({
      id: `legacy-${keyPart(legacyId)}`,
      legacyId,
      cardIdentityId: cardIdentityId(card),
      collectionId: text(card.id),
      collectionKey: text(card.collectionKey),
      cardIdentity: {
        id: card.id,
        tcg: card.tcg,
        name: card.name,
        set: card.set,
        setId: card.setId,
        number: card.number,
        language: card.language || card.lang,
        printingVariant: card.printingVariant,
        imageSmall: card.imageSmall || card.image,
        imageLarge: card.imageLarge || card.image
      },
      specimenIndex,
      createdAt: specimen.date || card.date || new Date(0).toISOString(),
      conditionScore: score,
      gradeLabel: specimen.grade || '',
      pregrade: specimen.pregrade,
      subscores,
      frontImage: specimen.front && specimen.front.preview || '',
      backImage: specimen.back && specimen.back.preview || '',
      authenticity: specimen.authenticity,
      defects: specimen.defects,
      notes: specimen.notes,
      source: 'LEGACY_MIGRATION'
    });
  }

  function migrateLegacyCollection(rawState, rawCollection) {
    const state = createState(rawState);
    const migrated = new Set(state.migratedLegacyIds);
    const recordIds = new Set(state.records.map(record => record.id));
    let migratedCount = 0;
    (Array.isArray(rawCollection) ? rawCollection : []).forEach(card => {
      const specimens = Array.isArray(card.specimens) ? card.specimens : [];
      specimens.forEach((specimen, index) => {
        if (!hasLegacyGrading(specimen)) return;
        const record = legacyRecord(card, specimen, index + 1);
        if (migrated.has(record.legacyId) || recordIds.has(record.id)) return;
        state.records.push(record);
        migrated.add(record.legacyId);
        recordIds.add(record.id);
        migratedCount++;
      });
    });
    state.migratedLegacyIds = [...migrated];
    return {state, changed: migratedCount > 0 || finite(rawState && rawState.schemaVersion) !== SCHEMA_VERSION, migratedCount};
  }

  function recordsForCard(rawState, card) {
    const state = createState(rawState);
    const identity = cardIdentityId(card);
    const collectionId = text(card && card.id);
    const key = text(card && card.collectionKey);
    return state.records.filter(record => (
      record.cardIdentityId === identity
      || collectionId && record.collectionId === collectionId
      || key && record.collectionKey === key
    )).sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)));
  }

  function gradedSpecimenCount(rawState, card) {
    return new Set(recordsForCard(rawState, card).map(record => record.specimenIndex)).size;
  }

  function nextUngradedSpecimen(rawState, card) {
    const quantity = Math.max(1, Math.floor(finite(card && card.quantity, 1)));
    const graded = new Set(recordsForCard(rawState, card).map(record => record.specimenIndex));
    for (let index = 1; index <= quantity; index++) {
      if (!graded.has(index)) return index;
    }
    return 1;
  }

  function addRecord(rawState, card, assessment) {
    const state = createState(rawState);
    const input = assessment && typeof assessment === 'object' ? assessment : {};
    const specimenIndex = Math.max(1, Math.floor(finite(input.specimenIndex, nextUngradedSpecimen(state, card))));
    const subscores = normalizeSubscores(input.subscores);
    const conditionScore = input.conditionScore != null
      ? clamp(input.conditionScore, 0, 1000) : scoreFromSubscores(subscores);
    const record = normalizeRecord({
      id: text(input.id) || `grading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cardIdentityId: cardIdentityId(card),
      collectionId: card && card.id != null ? text(card.id) : '',
      collectionKey: text(card && card.collectionKey),
      cardIdentity: {
        id: card && card.id,
        tcg: card && card.tcg,
        name: card && card.name,
        set: card && card.set,
        setId: card && card.setId,
        number: card && card.number,
        language: card && (card.language || card.lang),
        printingVariant: card && card.printingVariant,
        imageSmall: card && (card.imageSmall || card.image),
        imageLarge: card && (card.imageLarge || card.image)
      },
      specimenIndex,
      createdAt: input.createdAt || new Date().toISOString(),
      conditionScore,
      pregrade: pregradeFromScore(conditionScore),
      gradeLabel: gradeLabel(conditionScore),
      subscores,
      frontImage: text(input.frontImage),
      backImage: text(input.backImage),
      authenticity: input.authenticity,
      defects: input.defects,
      marketSnapshot: input.marketSnapshot,
      quality: input.quality,
      notes: input.notes,
      source: 'POKEFOLIO_PREGRADING'
    });
    state.records.unshift(record);
    return {state, record};
  }

  function statistics(rawState) {
    const state = createState(rawState);
    const identities = new Set(state.records.map(record => record.cardIdentityId));
    return {records: state.records.length, cards: identities.size};
  }

  return {
    SCHEMA_VERSION,
    cardIdentityId,
    normalizeAuthenticity,
    normalizeSubscores,
    scoreFromSubscores,
    pregradeFromScore,
    gradeLabel,
    evaluateImageQuality,
    createState,
    normalizeRecord,
    migrateLegacyCollection,
    recordsForCard,
    gradedSpecimenCount,
    nextUngradedSpecimen,
    addRecord,
    statistics
  };
});
