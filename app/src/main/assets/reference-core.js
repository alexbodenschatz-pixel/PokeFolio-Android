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

  function imageUrls(candidate, preferLarge = false) {
    const urls = preferLarge
      ? [candidate && candidate.imageLarge, candidate && candidate.imageSmall]
      : [candidate && candidate.imageSmall, candidate && candidate.imageLarge];
    return [...new Set(urls.filter(value => typeof value === 'string' && /^https:\/\//i.test(value)))];
  }

  async function compareWithFallback(candidate, compare, preferLarge = false) {
    let lastError;
    for (const url of imageUrls(candidate, preferLarge)) {
      try { return {...await compare(url), referenceUrl: url}; }
      catch (error) { lastError = error; }
    }
    throw lastError || new Error('Kein Referenzbild verfügbar.');
  }

  return {normalizeLanguage, languagePriority, selectLocalizedImage, imageUrls, compareWithFallback};
});
