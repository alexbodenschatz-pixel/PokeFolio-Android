(function (root, factory) {
  const names = typeof module === 'object' && module.exports
    ? require('./pokemon-names.js')
    : root.PokeNames;
  const api = factory(names || {entries: []});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeAsia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PokemonNames) {
  'use strict';

  /**
   * Small, auditable metadata fallback for regional prints not yet covered by the configured
   * structured APIs. This is deliberately not an image mirror or a card database. Entries are
   * keyed by print identity and are only eligible after an exact collector-number/set-total hit.
   */
  const REGIONAL_PRINTS = Object.freeze([
    Object.freeze({
      id: 'regional:ja:M2a-198', tcg: 'pokemon', cardType: 'pokemon', speciesId: 322,
      canonicalIdentity: 'Numel', localizedName: 'ドンメル', name: 'ドンメル',
      language: 'ja', languages: ['ja'], region: 'JP', script: 'Japanese',
      setId: 'M2a', set: 'MEGAドリームex', number: '198', printedTotal: 193,
      rarity: 'AR', hp: '80', imageSmall: '', imageLarge: '', imagesByLanguage: {},
      source: 'PokéFolio Regional Print Index', regionalIdentityConfidence: 1
    }),
    Object.freeze({
      id: 'regional:zh-CN:CSV9C-151', tcg: 'pokemon', cardType: 'pokemon', speciesId: 890,
      canonicalIdentity: 'Eternatus', localizedName: '无极汰那', name: '无极汰那',
      localizedNames: {'zh-CN': '无极汰那', 'zh-TW': '無極汰那'},
      language: 'zh-CN', languages: ['zh-CN', 'zh-TW'], region: 'CN', script: 'Chinese',
      setId: 'CSV9C', set: '星彩晶璃', number: '151', printedTotal: 208,
      rarity: 'R', hp: '150',
      imageSmall: 'https://images.pokemontcg.io/sv8/141.png',
      imageLarge: 'https://images.pokemontcg.io/sv8/141_hires.png',
      imageLanguage: 'en', referenceLanguageFallback: true,
      imagesByLanguage: {en: {
        small: 'https://images.pokemontcg.io/sv8/141.png',
        large: 'https://images.pokemontcg.io/sv8/141_hires.png',
        source: 'Pokémon TCG API artwork equivalent (English)'
      }},
      source: 'PokéFolio Regional Print Index', regionalIdentityConfidence: 1
    })
  ]);

  function key(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '')
      .replace(/^0+(?=\d)/, '');
  }

  function language(value) {
    const normalized = String(value || '').replace('_', '-').toLowerCase();
    if (normalized === 'zh-cn' || normalized === 'zh-hans') return 'zh-CN';
    if (normalized === 'zh-tw' || normalized === 'zh-hant') return 'zh-TW';
    return /^(?:ja|ko|de|en)$/.test(normalized) ? normalized : '';
  }

  function canonicalBySpeciesId(speciesId) {
    const entry = (PokemonNames.entries || []).find(value => Number(value.id) === Number(speciesId));
    return entry ? {speciesId: Number(entry.id), englishName: entry.en, germanName: entry.de} : null;
  }

  function strongCollector(hints) {
    const collectors = hints && hints.collectorNumbers || [];
    return collectors.find(item => Number(item.votes) >= 1.45 && item.total)
      || collectors.find(item => item.total) || null;
  }

  function setHints(hints) {
    return (hints && hints.pokemonSetCodes || []).map(item => key(item.value)).filter(Boolean);
  }

  function exactRegionalPrints(hints) {
    const collector = strongCollector(hints);
    if (!collector || !collector.total) return [];
    const requestedLanguage = language(hints && hints.language);
    const sets = setHints(hints);
    const detectedHp = String(hints && hints.hp || '').replace(/\D/g, '');
    const detectedRarity = String(hints && hints.rarity || '').trim().toUpperCase();
    return REGIONAL_PRINTS.filter(print => {
      if (key(print.number) !== key(collector.number)
        || key(print.printedTotal) !== key(collector.total)) return false;
      if (requestedLanguage && !(print.languages || [print.language])
        .map(language).includes(requestedLanguage)) return false;
      if (detectedHp && print.hp && detectedHp !== String(print.hp)) return false;
      if (detectedRarity && print.rarity && detectedRarity !== String(print.rarity).toUpperCase()) {
        return false;
      }
      return !sets.length || sets.includes(key(print.setId));
    }).map(print => {
      const localizedName = print.localizedNames && print.localizedNames[requestedLanguage]
        || print.localizedName;
      return {
      ...print, name: localizedName, localizedName,
      language: requestedLanguage || print.language,
      languages: [...print.languages],
      imagesByLanguage: {...print.imagesByLanguage},
      fieldProvenance: {
        cardName: 'POKEFOLIO_REGIONAL_INDEX', cardNumber: 'POKEFOLIO_REGIONAL_INDEX',
        set: 'POKEFOLIO_REGIONAL_INDEX', canonicalIdentity: 'POKEMON_SPECIES_ID'
      },
      officialValidationStatus: 'NOT_AVAILABLE', availableVariants: [], pricesByVariant: {},
      genericPrice: null, price: null
    };
    });
  }

  function enrichCanonical(candidate) {
    if (!candidate) return candidate;
    const speciesId = Number(candidate.speciesId
      || (Array.isArray(candidate.dexId) && candidate.dexId[0]) || 0);
    const canonical = canonicalBySpeciesId(speciesId);
    if (!canonical) return {...candidate};
    return {
      ...candidate,
      speciesId,
      canonicalIdentity: candidate.canonicalIdentity || canonical.englishName,
      localizedName: candidate.localizedName || candidate.name || '',
      canonicalNames: {en: canonical.englishName, de: canonical.germanName}
    };
  }

  function retrievalStrategy(hints) {
    const collector = strongCollector(hints);
    return collector && collector.total ? 'NUMBER_FIRST' : 'STRUCTURED_FALLBACK';
  }

  return {
    REGIONAL_PRINTS,
    canonicalBySpeciesId,
    exactRegionalPrints,
    enrichCanonical,
    retrievalStrategy,
    strongCollector
  };
});
