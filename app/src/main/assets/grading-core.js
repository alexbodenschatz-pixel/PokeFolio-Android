(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokeGrading = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const COMPONENT_WEIGHTS = Object.freeze({
    centering: 0.18,
    corners: 0.27,
    edges: 0.24,
    surface: 0.31
  });
  const REGION_LABELS = Object.freeze({
    topLeft: 'oben links',
    topRight: 'oben rechts',
    bottomRight: 'unten rechts',
    bottomLeft: 'unten links',
    top: 'oben',
    right: 'rechts',
    bottom: 'unten',
    left: 'links',
    center: 'Kartenmitte'
  });

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

  function normalizeCentering(value) {
    const source = value && typeof value === 'object' ? value : {};
    const left = clamp(source.left == null ? 50 : source.left, 0, 100);
    const top = clamp(source.top == null ? 50 : source.top, 0, 100);
    return {
      left,
      right: clamp(source.right == null ? 100 - left : source.right, 0, 100),
      top,
      bottom: clamp(source.bottom == null ? 100 - top : source.bottom, 0, 100),
      confidence: clamp(source.confidence, 0, 1),
      method: text(source.method) || 'FRAME_GEOMETRY'
    };
  }

  function centeringScore(value) {
    const ratio = normalizeCentering(value);
    const horizontalDeviation = Math.abs(ratio.left - 50);
    const verticalDeviation = Math.abs(ratio.top - 50);
    const worstDeviation = Math.max(horizontalDeviation, verticalDeviation);
    const combinedDeviation = horizontalDeviation + verticalDeviation;
    return Math.round(clamp(100 - worstDeviation * 2.1 - combinedDeviation * 0.55, 35, 100));
  }

  function normalizeDefect(value) {
    const source = value && typeof value === 'object' ? value : {label: value};
    const severityInput = text(source.severity).toUpperCase();
    const severity = ['LOW', 'MEDIUM', 'HIGH'].includes(severityInput) ? severityInput : 'LOW';
    const box = source.box && typeof source.box === 'object' ? source.box : {};
    const region = text(source.region) || 'center';
    const type = text(source.type) || 'VISUAL_ANOMALY';
    return {
      side: /^back$/i.test(text(source.side)) ? 'back' : 'front',
      region,
      type,
      severity,
      confidence: clamp(source.confidence == null ? 0.5 : source.confidence, 0, 1),
      label: text(source.label) || `${type} ${REGION_LABELS[region] || region}`,
      positioned: source.positioned == null ? Boolean(source.box) : Boolean(source.positioned),
      box: {
        x: clamp(box.x, 0, 1),
        y: clamp(box.y, 0, 1),
        width: clamp(box.width == null ? 0.16 : box.width, 0.02, 1),
        height: clamp(box.height == null ? 0.16 : box.height, 0.02, 1)
      },
      source: text(source.source) || 'LOCAL_VISION'
    };
  }

  function normalizeCategoryConfidence(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalizeSide = side => {
      const input = source[side] && typeof source[side] === 'object' ? source[side] : {};
      return {
        centering: clamp(input.centering == null ? 0.5 : input.centering, 0, 1),
        corners: clamp(input.corners == null ? 0.5 : input.corners, 0, 1),
        edges: clamp(input.edges == null ? 0.5 : input.edges, 0, 1),
        surface: clamp(input.surface == null ? 0.5 : input.surface, 0, 1)
      };
    };
    return {front: normalizeSide('front'), back: normalizeSide('back')};
  }

  function aggregateSubgrades(subscores) {
    const normalized = normalizeSubscores(subscores);
    return Object.fromEntries(Object.keys(COMPONENT_WEIGHTS).map(component => [
      component,
      Math.round((normalized.front[component] * 0.55 + normalized.back[component] * 0.45) * 10) / 10
    ]));
  }

  function scoreFromSubscores(subscores) {
    const aggregate = aggregateSubgrades(subscores);
    let score = Object.entries(COMPONENT_WEIGHTS)
      .reduce((sum, [component, weight]) => sum + aggregate[component] * weight, 0);
    const weakest = Math.min(...Object.values(aggregate));
    // A serious local defect limits the total result even if all other categories are pristine.
    if (weakest < 55) score = Math.min(score, weakest + 13);
    else if (weakest < 70) score = Math.min(score, weakest + 17);
    return Math.round(clamp(score, 0, 100) * 10);
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
      reflection: reflectionRatio <= 0.20,
      completeCard: cropReliable && cardComplete,
      perspective: perspectiveConfidence >= 0.48
    };
    const qualityScore = clamp((
      (checks.resolution ? 1 : 0) * 0.20
      + clamp((sharpness - 45) / 45, 0, 1) * 0.25
      + (checks.exposure ? 1 : 0) * 0.18
      + clamp(1 - reflectionRatio * 2.8, 0, 1) * 0.14
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

  function qualityLabel(value) {
    const score = clamp(value, 0, 1);
    if (score >= 0.88) return 'sehr gut';
    if (score >= 0.72) return 'gut';
    if (score >= 0.52) return 'mittel';
    return 'eingeschränkt';
  }

  function sideCategoryConfidence(analysis, angleCount) {
    const source = analysis && typeof analysis === 'object' ? analysis : {};
    const quality = evaluateImageQuality(source);
    const geometry = clamp(source.centering && source.centering.confidence, 0, 1);
    const crop = source.cropReliable === false ? 0.25 : clamp(source.perspectiveConfidence || 0.65, 0, 1);
    const reflection = clamp(1 - finite(source.reflectionRatio) * 3.2, 0.2, 1);
    const surfaceFrames = clamp(0.54 + Math.min(3, Math.max(0, finite(angleCount))) * 0.12, 0, 0.9);
    return {
      centering: clamp(geometry * 0.72 + crop * 0.28, 0, 1),
      corners: clamp(quality.qualityScore * 0.55 + crop * 0.45, 0, 1),
      edges: clamp(quality.qualityScore * 0.56 + crop * 0.44, 0, 1),
      surface: clamp(quality.qualityScore * 0.34 + reflection * 0.34 + surfaceFrames * 0.32, 0, 1)
    };
  }

  function combineSurface(primary, angles) {
    const additional = (Array.isArray(angles) ? angles : []).filter(frame =>
      frame && evaluateImageQuality(frame).qualityScore >= 0.52);
    const frames = [primary].concat(additional).filter(Boolean);
    if (!frames.length) return {score: 0, confidence: 0, framesUsed: 0, limited: true};
    const scores = frames.map(frame => clamp(frame.surface, 0, 100)).sort((left, right) => left - right);
    const main = clamp(primary && primary.surface, 0, 100);
    const lowerQuartile = scores[Math.floor((scores.length - 1) * 0.25)];
    const reflection = frames.reduce((sum, frame) => sum + clamp(frame.reflectionRatio, 0, 1), 0) / frames.length;
    const usableAngles = additional.length;
    const score = Math.round(clamp(main * 0.68 + lowerQuartile * 0.32, 0, 100));
    const confidence = clamp(0.48 + usableAngles * 0.12 - reflection * 1.4, 0.22, 0.94);
    return {
      score,
      confidence,
      framesUsed: 1 + usableAngles,
      limited: confidence < 0.62,
      reflectionRatio: reflection
    };
  }

  function mergeDefects(values) {
    const unique = new Map();
    (Array.isArray(values) ? values.flat(Infinity) : []).filter(Boolean).forEach(value => {
      const defect = normalizeDefect(value);
      const key = [defect.side, defect.region, defect.type].join('|');
      const current = unique.get(key);
      if (!current || defect.confidence > current.confidence
          || defect.severity === 'HIGH' && current.severity !== 'HIGH') unique.set(key, defect);
    });
    return [...unique.values()].sort((left, right) => {
      const severity = {HIGH: 3, MEDIUM: 2, LOW: 1};
      return severity[right.severity] - severity[left.severity]
        || right.confidence - left.confidence;
    });
  }

  function externalGradeForecast(pregrade, analysisConfidence) {
    const grade = clamp(pregrade, 0, 10);
    const confidence = clamp(analysisConfidence, 0, 1);
    if (confidence < 0.58) return null;
    const sigma = 0.48 + (1 - confidence) * 0.82;
    const labels = [8, 9, 10];
    const weights = labels.map(label => Math.exp(-Math.pow(grade - label, 2) / (2 * sigma * sigma)));
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    const percentages = weights.map(value => Math.round(value / total * 100));
    percentages[1] += 100 - percentages.reduce((sum, value) => sum + value, 0);
    return {
      disclaimer: 'Unverbindliche PokéFolio-Prognose – kein offizielles PSA-, CGC- oder BGS-Grading.',
      psa: Object.fromEntries(labels.map((label, index) => [String(label), percentages[index]])),
      confidence
    };
  }

  function buildAssessment(input) {
    const source = input && typeof input === 'object' ? input : {};
    const front = source.front && typeof source.front === 'object' ? source.front : {};
    const back = source.back && typeof source.back === 'object' ? source.back : {};
    const frontAngles = Array.isArray(source.frontAngles) ? source.frontAngles.filter(Boolean) : [];
    const backAngles = Array.isArray(source.backAngles) ? source.backAngles.filter(Boolean) : [];
    const usableFrontAngles = frontAngles.filter(frame => evaluateImageQuality(frame).qualityScore >= 0.52);
    const usableBackAngles = backAngles.filter(frame => evaluateImageQuality(frame).qualityScore >= 0.52);
    const frontSurface = combineSurface(front, frontAngles);
    const backSurface = combineSurface(back, backAngles);
    const centerings = {
      front: normalizeCentering(front.centering),
      back: normalizeCentering(back.centering)
    };
    const subscores = normalizeSubscores({
      front: {...front, centering: centeringScore(centerings.front), surface: frontSurface.score},
      back: {...back, centering: centeringScore(centerings.back), surface: backSurface.score}
    });
    const categoryConfidence = normalizeCategoryConfidence({
      front: {...sideCategoryConfidence(front, Math.max(0, frontSurface.framesUsed - 1)), surface: frontSurface.confidence},
      back: {...sideCategoryConfidence(back, Math.max(0, backSurface.framesUsed - 1)), surface: backSurface.confidence}
    });
    const quality = {
      front: evaluateImageQuality(front),
      back: evaluateImageQuality(back),
      frontAngles: frontAngles.map(evaluateImageQuality),
      backAngles: backAngles.map(evaluateImageQuality)
    };
    const confidenceValues = ['front', 'back'].flatMap(side => Object.values(categoryConfidence[side]));
    const analysisConfidence = clamp(confidenceValues.reduce((sum, value) => sum + value, 0)
      / Math.max(1, confidenceValues.length), 0, 1);
    const conditionScore = scoreFromSubscores(subscores);
    const pregrade = pregradeFromScore(conditionScore);
    const defects = mergeDefects([
      front.defects || [], back.defects || [],
      ...usableFrontAngles.map(frame => frame.defects || []),
      ...usableBackAngles.map(frame => frame.defects || [])
    ]);
    return {
      subscores,
      aggregateSubgrades: aggregateSubgrades(subscores),
      centerings,
      categoryConfidence,
      analysisConfidence,
      analysisQualityLabel: qualityLabel(analysisConfidence),
      surfaceAnalysis: {front: frontSurface, back: backSurface},
      cornerDetails: {front: front.cornerDetails || {}, back: back.cornerDetails || {}},
      edgeDetails: {front: front.edgeDetails || {}, back: back.edgeDetails || {}},
      conditionScore,
      pregrade,
      gradeLabel: gradeLabel(conditionScore),
      defects,
      quality,
      externalGradeForecast: externalGradeForecast(pregrade, analysisConfidence)
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
      aggregateSubgrades: source.aggregateSubgrades && typeof source.aggregateSubgrades === 'object'
        ? source.aggregateSubgrades : aggregateSubgrades(subscores),
      centerings: {
        front: normalizeCentering(source.centerings && source.centerings.front),
        back: normalizeCentering(source.centerings && source.centerings.back)
      },
      categoryConfidence: normalizeCategoryConfidence(source.categoryConfidence),
      analysisConfidence: clamp(source.analysisConfidence == null
        ? source.quality && source.quality.analysisConfidence || 0.5 : source.analysisConfidence, 0, 1),
      analysisQualityLabel: text(source.analysisQualityLabel)
        || qualityLabel(source.analysisConfidence == null ? 0.5 : source.analysisConfidence),
      surfaceAnalysis: source.surfaceAnalysis && typeof source.surfaceAnalysis === 'object'
        ? source.surfaceAnalysis : null,
      cornerDetails: source.cornerDetails && typeof source.cornerDetails === 'object'
        ? source.cornerDetails : null,
      edgeDetails: source.edgeDetails && typeof source.edgeDetails === 'object'
        ? source.edgeDetails : null,
      authenticity: normalizeAuthenticity(source.authenticity),
      defects: Array.isArray(source.defects) ? source.defects.map(normalizeDefect) : [],
      captures: Array.isArray(source.captures) ? source.captures.slice(0, 8).map(capture => ({
        type: text(capture && capture.type),
        side: /^back$/i.test(text(capture && capture.side)) ? 'back' : 'front',
        preview: text(capture && capture.preview),
        qualityScore: clamp(capture && capture.qualityScore, 0, 1),
        accepted: capture && capture.accepted !== false
      })) : [],
      externalGradeForecast: source.externalGradeForecast && typeof source.externalGradeForecast === 'object'
        ? source.externalGradeForecast : externalGradeForecast(pregradeFromScore(conditionScore), source.analysisConfidence || 0),
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
      aggregateSubgrades: input.aggregateSubgrades,
      centerings: input.centerings,
      categoryConfidence: input.categoryConfidence,
      analysisConfidence: input.analysisConfidence,
      analysisQualityLabel: input.analysisQualityLabel,
      surfaceAnalysis: input.surfaceAnalysis,
      cornerDetails: input.cornerDetails,
      edgeDetails: input.edgeDetails,
      frontImage: text(input.frontImage),
      backImage: text(input.backImage),
      captures: input.captures,
      authenticity: input.authenticity,
      defects: input.defects,
      externalGradeForecast: input.externalGradeForecast,
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
    COMPONENT_WEIGHTS,
    REGION_LABELS,
    cardIdentityId,
    normalizeAuthenticity,
    normalizeSubscores,
    normalizeCentering,
    centeringScore,
    normalizeDefect,
    normalizeCategoryConfidence,
    aggregateSubgrades,
    scoreFromSubscores,
    pregradeFromScore,
    gradeLabel,
    evaluateImageQuality,
    qualityLabel,
    sideCategoryConfidence,
    combineSurface,
    mergeDefects,
    externalGradeForecast,
    buildAssessment,
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
