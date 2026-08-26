(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokeVariants = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATES = Object.freeze({
    IDENTITY_CONFIRMED_VARIANT_CONFIRMED: 'IDENTITY_CONFIRMED_VARIANT_CONFIRMED',
    IDENTITY_CONFIRMED_VARIANT_UNCERTAIN: 'IDENTITY_CONFIRMED_VARIANT_UNCERTAIN',
    IDENTITY_UNCERTAIN: 'IDENTITY_UNCERTAIN',
    NO_RELIABLE_MATCH: 'NO_RELIABLE_MATCH'
  });

  const LABELS = Object.freeze({
    unknown: 'Nicht bestimmt',
    normal: 'Normal',
    holo: 'Holo',
    'reverse-holo': 'Reverse Holo',
    'cosmos-holo': 'Cosmos Holo',
    promo: 'Promo',
    'full-art': 'Full Art',
    'alternate-art': 'Alternate Art',
    'illustration-rare': 'Illustration Rare',
    'special-illustration-rare': 'Special Illustration Rare',
    'secret-rare': 'Secret Rare',
    'poke-ball-pattern': 'Poké Ball Pattern',
    'master-ball-pattern': 'Master Ball Pattern',
    reprint: 'Reprint',
    common: 'Common',
    rare: 'Rare',
    'super-rare': 'Super Rare',
    'ultra-rare': 'Ultra Rare',
    'ultimate-rare': 'Ultimate Rare',
    'ghost-rare': 'Ghost Rare',
    'starlight-rare': 'Starlight Rare',
    'collectors-rare': "Collector's Rare",
    'quarter-century-secret-rare': 'Quarter Century Secret Rare',
    foil: 'Foil',
    parallel: 'Parallel',
    'manga-rare': 'Manga Rare',
    'leader-parallel': 'Leader Parallel',
    'don-parallel': 'DON!! Parallel'
  });

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function key(value) {
    return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function normalize(value) {
    const compact = key(value);
    if (!compact || compact === 'unknown' || compact === 'unbekannt' || compact === 'notdetermined') return 'unknown';
    if (compact.includes('masterball')) return 'master-ball-pattern';
    if (compact.includes('pokeball')) return 'poke-ball-pattern';
    if (compact.includes('cosmos')) return 'cosmos-holo';
    if (compact.includes('specialillustration') || compact === 'sir') return 'special-illustration-rare';
    if (compact.includes('illustration') || compact === 'ir') return 'illustration-rare';
    if (compact.includes('alternate') || compact.includes('alternativeart')) return 'alternate-art';
    if (compact.includes('fullart')) return 'full-art';
    if (compact.includes('quartercentury')) return 'quarter-century-secret-rare';
    if (compact.includes('starlight')) return 'starlight-rare';
    if (compact.includes('collectorsrare') || compact.includes('collectorra') || compact === 'cr') return 'collectors-rare';
    if (compact.includes('ultimate')) return 'ultimate-rare';
    if (compact.includes('ghost')) return 'ghost-rare';
    if (compact.includes('secretrare') || compact === 'secret') return 'secret-rare';
    if (compact.includes('ultrarare')) return 'ultra-rare';
    if (compact.includes('superrare')) return 'super-rare';
    if (compact.includes('mangarare') || compact === 'manga') return 'manga-rare';
    if (compact.includes('leaderparallel')) return 'leader-parallel';
    if (compact.includes('donparallel')) return 'don-parallel';
    if (compact.includes('reverse')) return 'reverse-holo';
    if (compact.includes('promo')) return 'promo';
    if (compact.includes('parallel')) return 'parallel';
    if (compact.includes('holo') || compact === 'foil' || compact === 'holofoil') return compact === 'foil' ? 'foil' : 'holo';
    if (compact === 'rare') return 'rare';
    if (compact === 'common') return 'common';
    if (compact === 'standard' || compact === 'regular' || compact === 'nonholo' || compact === 'normal') return 'normal';
    if (compact.includes('reprint')) return 'reprint';
    return compact;
  }

  function label(value) {
    const normalized = normalize(value);
    return LABELS[normalized] || text(value) || LABELS.unknown;
  }

  function unique(values) {
    return [...new Set((values || []).map(normalize).filter(value => value && value !== 'unknown'))];
  }

  function booleanSourceVariants(card) {
    const source = card && card.sourceVariants;
    if (!source || typeof source !== 'object') return [];
    const aliases = {
      normal: 'normal', holo: 'holo', reverse: 'reverse-holo', reverseHolo: 'reverse-holo',
      wPromo: 'promo', promo: 'promo', firstEdition: 'normal', foil: 'foil', parallel: 'parallel'
    };
    return Object.keys(source).filter(name => source[name] === true && aliases[name]).map(name => aliases[name]);
  }

  function explicitVariant(card) {
    if (!card) return 'unknown';
    return normalize(card.printingVariant || card.finish || card.foilType || card.selectedVariant);
  }

  function specialPokemonVariant(rarity) {
    const compact = key(rarity);
    if (compact.includes('specialillustration')) return 'special-illustration-rare';
    if (compact.includes('illustration')) return 'illustration-rare';
    if (compact.includes('alternate')) return 'alternate-art';
    if (compact.includes('fullart')) return 'full-art';
    if (compact.includes('secret') || compact.includes('hyperrare')) return 'secret-rare';
    if (compact.includes('promo')) return 'promo';
    return '';
  }

  function possiblePokemonVariants(card) {
    const declared = unique([
      ...(card && card.availableVariants || []),
      ...Object.keys(card && card.pricesByVariant || {}),
      ...booleanSourceVariants(card)
    ]);
    if (declared.length) return declared;
    const special = specialPokemonVariant(card && card.rarity);
    if (special) return [special];
    const rarity = key(card && card.rarity);
    if (rarity.includes('holorare') || rarity.includes('rareholo')) return ['holo', 'reverse-holo'];
    if (rarity.includes('common') || rarity.includes('uncommon')) return ['normal', 'reverse-holo'];
    if (rarity.includes('rare')) return ['normal', 'holo', 'reverse-holo'];
    return ['normal', 'holo', 'reverse-holo'];
  }

  function possibleYugiohVariants(card) {
    const declared = unique([...(card && card.availableVariants || []), ...Object.keys(card && card.pricesByVariant || {})]);
    if (declared.length) return declared;
    const rarity = normalize(card && card.rarity);
    if (rarity !== 'unknown' && rarity !== 'normal') return [rarity];
    return ['common'];
  }

  function possibleOnePieceVariants(card) {
    const declared = unique([...(card && card.availableVariants || []), ...Object.keys(card && card.pricesByVariant || {})]);
    if (declared.length) return declared;
    const rarity = key(card && card.rarity);
    if (rarity.includes('manga')) return ['manga-rare'];
    if (rarity.includes('parallel') && rarity.includes('leader')) return ['leader-parallel'];
    if (rarity.includes('parallel')) return ['parallel'];
    return ['normal', 'parallel'];
  }

  function possibleVariants(card) {
    const tcg = key(card && card.tcg);
    if (tcg === 'yugioh') return possibleYugiohVariants(card);
    if (tcg === 'onepiece') return possibleOnePieceVariants(card);
    return possiblePokemonVariants(card);
  }

  function variantScores(card) {
    const source = card && card.variantScores;
    if (!source || typeof source !== 'object') return [];
    return Object.entries(source).map(([variant, score]) => ({variant: normalize(variant), score: Number(score) || 0}))
      .filter(item => item.variant !== 'unknown').sort((left, right) => right.score - left.score);
  }

  function resolve(card) {
    const options = possibleVariants(card);
    const explicit = explicitVariant(card);
    const explicitConfirmed = explicit !== 'unknown' && Boolean(
      card && (card.variantSelectionConfirmed || card.variantSourceConfirmed || card.localRecognition)
    );
    if (explicitConfirmed || explicit !== 'unknown' && options.length === 1 && options[0] === explicit) {
      return {variant: explicit, confidence: explicitConfirmed ? 0.99 : 0.93, confirmed: true, options};
    }
    if (options.length === 1) {
      return {variant: options[0], confidence: 0.93, confirmed: true, options};
    }
    const ranked = variantScores(card);
    if (ranked.length && ranked[0].score >= 0.82
        && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.15)) {
      return {variant: ranked[0].variant, confidence: ranked[0].score, confirmed: true, options};
    }
    return {variant: 'unknown', confidence: ranked[0] ? ranked[0].score : 0,
      confirmed: false, options, suggestedVariant: ranked[0] && ranked[0].variant || explicit};
  }

  function priceForVariant(card, value) {
    const variant = normalize(value);
    const prices = card && card.pricesByVariant || {};
    const exact = prices[variant] || prices[text(value)];
    if (exact && Number.isFinite(Number(exact.value))) return {...exact, variantSpecific: true};
    const generic = card && card.genericPrice || card && card.price;
    return generic ? {...generic, variantSpecific: false} : null;
  }

  function selectVariant(card, value, source) {
    const variant = normalize(value);
    if (variant === 'unknown') {
      const neutralPrice = card && (card.genericPrice
        || card.price && card.price.variantSpecific !== true && card.price);
      return {...card, printingVariant: 'unknown', variantSelectionConfirmed: false,
        variantSelectionSource: '', variantConfidence: 0, price: neutralPrice || null};
    }
    return {
      ...card,
      printingVariant: variant,
      variantSelectionConfirmed: true,
      variantSelectionSource: source || 'USER_SELECTED',
      variantConfidence: 0.99,
      price: priceForVariant(card, variant)
    };
  }

  return {
    STATES,
    LABELS,
    normalize,
    label,
    explicitVariant,
    possibleVariants,
    possiblePokemonVariants,
    possibleYugiohVariants,
    possibleOnePieceVariants,
    resolve,
    priceForVariant,
    selectVariant
  };
});
