(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeReference = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeLanguage(language) {
    const value = String(language || '').replace('_', '-').toLowerCase();
    if (value === 'zh-tw' || value === 'zh-hant' || value === 'tw') return 'zh-TW';
    if (value === 'zh-cn' || value === 'zh-hans' || value === 'cn') return 'zh-CN';
    return /^(?:de|en|ja|ko)$/.test(value) ? value : '';
  }

  function languagePriority(requestedLanguage) {
    const requested = normalizeLanguage(requestedLanguage) || 'en';
    if (requested === 'zh-CN') return ['zh-CN', 'zh-TW', 'en'];
    if (requested === 'zh-TW') return ['zh-TW', 'zh-CN', 'en'];
    return [...new Set([requested, 'en'])];
  }

  function selectLocalizedImage(candidate, requestedLanguage) {
    const requested = normalizeLanguage(requestedLanguage) || 'en';
    const available = candidate && candidate.imagesByLanguage || {};
    const selectedLanguage = languagePriority(requested).find(language => {
      const image = available[language];
      return image && (image.small || image.large);
    }) || Object.keys(available).find(language => {
      const image = available[language];
      return image && (image.small || image.large);
    });
    if (!selectedLanguage) return {...candidate};
    const image = available[selectedLanguage];
    return {
      ...candidate,
      imageSmall: image.small || image.large || '',
      imageLarge: image.large || image.small || '',
      imageLanguage: selectedLanguage,
      referenceLanguageFallback: selectedLanguage !== requested,
      requestedReferenceLanguage: requested,
      fieldProvenance: {
        ...(candidate && candidate.fieldProvenance || {}),
        image: image.source || selectedLanguage
      }
    };
  }

  return {normalizeLanguage, languagePriority, selectLocalizedImage};
});
