(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PokeApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BACKOFF_MS = [250, 650];
  const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
  const TCGDEX_ENDPOINT = 'https://api.tcgdex.net/v2';
  const ignoredNameTokens = new Set([
    'basis', 'basic', 'stage', 'phase', 'pokemon', 'pokémon', 'karte', 'card',
    'kp', 'hp', 'break', 'level', 'lv'
  ]);
  const pokemonVariantTokens = new Set(['ex', 'gx', 'v', 'vmax', 'vstar']);

  class HttpRequestError extends Error {
    constructor(message, details) {
      super(message || 'Netzwerkanfrage fehlgeschlagen.');
      this.name = 'HttpRequestError';
      this.url = String(details && details.url || '');
      this.status = Number(details && details.status) || 0;
      this.body = String(details && details.body || '');
      this.retryAfterMs = Number(details && details.retryAfterMs) || 0;
    }
  }

  function createHttpError(details) {
    const status = Number(details && details.status) || 0;
    const fallback = status ? `HTTP ${status}` : 'Netzwerkanfrage fehlgeschlagen';
    return new HttpRequestError(String(details && details.error || fallback), details || {});
  }

  function errorDetails(error, fallbackUrl) {
    return {
      url: String(error && error.url || fallbackUrl || ''),
      status: Number(error && error.status) || 0,
      body: String(error && error.body || ''),
      retryAfterMs: Number(error && error.retryAfterMs) || 0,
      message: String(error && error.message || 'Netzwerkanfrage fehlgeschlagen.')
    };
  }

  function isRetryableStatus(status) {
    const value = Number(status) || 0;
    return value === 429 || value >= 500 && value <= 599;
  }

  function compactBody(body, maximum = 1200) {
    const value = String(body || '').replace(/\s+/g, ' ').trim();
    if (!value) return '<leer>';
    return value.length > maximum ? value.slice(0, maximum) + '…' : value;
  }

  function formatHttpFailure(details, attempt) {
    const suffix = attempt ? ` Versuch=${attempt}` : '';
    return `[PokeFolio HTTP] URL=${details.url || '<unbekannt>'} Status=${details.status || 0}`
      + `${suffix} Body=${compactBody(details.body)}`;
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
  }

  async function requestJsonWithRetry(url, request, options) {
    const settings = options || {};
    const backoff = Array.isArray(settings.backoffMs) ? settings.backoffMs : DEFAULT_BACKOFF_MS;
    const attempts = Math.max(1, Number(settings.attempts) || backoff.length + 1);
    const pause = settings.wait || wait;
    const logger = settings.logger || (message => console.error(message));
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await request(url);
      } catch (error) {
        const details = errorDetails(error, url);
        logger(formatHttpFailure(details, attempt), details);
        lastError = error instanceof Error ? error : createHttpError(details);
        if (!isRetryableStatus(details.status) || attempt >= attempts) break;
        const configured = Number(backoff[Math.min(attempt - 1, backoff.length - 1)]) || 0;
        const retryAfter = Math.min(3000, Math.max(0, details.retryAfterMs));
        await pause(Math.max(configured, retryAfter));
      }
    }
    throw lastError || createHttpError({url});
  }

  function cleanNameCandidate(value) {
    return String(value || '')
      .replace(/\b(?:KP|HP)\s*[0-9OIL|]{2,3}\b/ig, ' ')
      .replace(/\b(?:TG|GG|SV|RC|SH)?[0-9OIL|]{1,3}\s*[\/／]\s*(?:TG|GG|SV|RC|SH)?[0-9OIL|]{1,3}\b/ig, ' ')
      .replace(/["\\()[\]{}:+!^~?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nameTokens(value) {
    const cleaned = cleanNameCandidate(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
    return cleaned.split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3 && !ignoredNameTokens.has(token))
      .sort((left, right) => right.length - left.length);
  }

  /** Uses the documented trailing wildcard form; exact name queries currently produce API 500s. */
  function safePokemonNameQuery(value) {
    const token = nameTokens(value).find(value => !pokemonVariantTokens.has(value));
    if (!token) return '';
    return 'name:' + token.slice(0, Math.min(9, token.length)) + '*';
  }

  function normalizedCollectorNumber(value) {
    const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = raw.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
    if (!match) return raw;
    return match[1] ? raw : String(parseInt(match[2], 10)) + match[3];
  }

  function buildPokemonTcgQueries(hints, manual) {
    const queries = [];
    (hints && hints.collectorNumbers || []).slice(0, 3).forEach(item => {
      const raw = String(item.number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw) queries.push('number:' + raw);
      const normalized = normalizedCollectorNumber(raw);
      if (normalized && normalized !== raw) queries.push('number:' + normalized);
    });
    const identity = hints && hints.pokemonIdentity || {};
    const names = manual
      ? [manual]
      : identity.speciesId && (identity.reliable || Number(identity.nameConfidence) >= 0.88)
        ? [identity.englishName]
        : (hints && hints.validatedNameHints || [])
          .filter(item => Number(item.confidence) >= 0.88)
          .slice(0, 2)
          .map(item => item.baseName || item.value);
    names.forEach(value => {
      const query = safePokemonNameQuery(value);
      if (query) queries.push(query);
    });
    return [...new Set(queries)].slice(0, 5);
  }

  function buildPokemonTcgUrls(hints, manual) {
    return buildPokemonTcgQueries(hints, manual).map(query =>
      POKEMON_TCG_ENDPOINT + '?q=' + encodeURIComponent(query)
        + '&pageSize=100&select=id,name,number,images,set,rarity,hp,subtypes,artist,cardmarket,tcgplayer'
    );
  }

  function tcgdexNames(hints, manual, language) {
    const identity = hints && hints.pokemonIdentity || {};
    const localizedBase = String(language || '').toLowerCase() === 'de'
      ? identity.germanName
      : identity.englishName;
    const localizedIdentity = [localizedBase, identity.variant].filter(Boolean).join(' ');
    const values = manual
      ? [manual]
      : identity.speciesId && (identity.reliable || Number(identity.nameConfidence) >= 0.88)
        ? [localizedIdentity, localizedBase]
        : (hints && hints.validatedNameHints || [])
          .filter(item => Number(item.confidence) >= 0.88)
          .map(item => item.value);
    return [...new Set(values.map(cleanNameCandidate).filter(value => nameTokens(value).length))].slice(0, 3);
  }

  function buildTcgdexUrls(hints, manual, language) {
    const lang = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(language || '') ? language.toLowerCase() : 'de';
    const names = tcgdexNames(hints, manual, lang);
    const numbers = [...new Set((hints && hints.collectorNumbers || []).slice(0, 2)
      .map(item => String(item.number || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean))];
    const variants = [];
    names.forEach(name => variants.push({name}));
    numbers.forEach(localId => variants.push({localId}));
    if (names[0] && numbers[0]) variants.unshift({name: names[0], localId: numbers[0]});
    return [...new Set(variants.map(parameters => {
      const query = new URLSearchParams({
        ...parameters,
        'pagination:page': '1',
        'pagination:itemsPerPage': '100'
      });
      return `${TCGDEX_ENDPOINT}/${lang}/cards?${query.toString()}`;
    }))].slice(0, 5);
  }

  /** Settles every variant independently so one bad endpoint never cancels the other results. */
  async function settleSearchVariants(urls, request, options) {
    const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
    const settled = await Promise.allSettled(uniqueUrls.map(url =>
      requestJsonWithRetry(url, request, options)
    ));
    const values = [];
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') values.push({url: uniqueUrls[index], value: result.value});
      else errors.push({...errorDetails(result.reason, uniqueUrls[index]), error: result.reason});
    });
    return {
      values,
      errors,
      successCount: values.length,
      unavailable: uniqueUrls.length > 0 && values.length === 0 && errors.length === uniqueUrls.length
    };
  }

  return {
    HttpRequestError,
    createHttpError,
    errorDetails,
    isRetryableStatus,
    formatHttpFailure,
    requestJsonWithRetry,
    cleanNameCandidate,
    safePokemonNameQuery,
    normalizedCollectorNumber,
    buildPokemonTcgQueries,
    buildPokemonTcgUrls,
    buildTcgdexUrls,
    settleSearchVariants
  };
});
