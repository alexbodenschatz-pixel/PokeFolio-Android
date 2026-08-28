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
      this.kind = String(details && (details.kind || details.errorType) || inferErrorKind(details));
    }
  }

  function inferErrorKind(details) {
    const explicit = String(details && (details.kind || details.errorType) || '').toLowerCase();
    if (explicit) return explicit;
    if (Number(details && details.status) > 0) return 'http';
    return 'network';
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
      kind: String(error && error.kind || inferErrorKind(error)),
      message: String(error && error.message || 'Netzwerkanfrage fehlgeschlagen.')
    };
  }

  function isRetryableStatus(status) {
    const value = Number(status) || 0;
    return value === 429 || value >= 500 && value <= 599;
  }

  function isRetryableError(details) {
    const kind = String(details && details.kind || '');
    return isRetryableStatus(details && details.status) || kind === 'network' || kind === 'timeout';
  }

  function compactBody(body, maximum = 1200) {
    const value = String(body || '').replace(/\s+/g, ' ').trim();
    if (!value) return '<leer>';
    return value.length > maximum ? value.slice(0, maximum) + '…' : value;
  }

  function formatHttpFailure(details, attempt) {
    const suffix = attempt ? ` Versuch=${attempt}` : '';
    return `[PokeFolio HTTP] Art=${details.kind || 'network'} URL=${details.url || '<unbekannt>'} Status=${details.status || 0}`
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
        if (!isRetryableError(details) || attempt >= attempts) break;
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
    return cleaned.split(/[^\p{L}\p{N}]+/u)
      .filter(token => token.length >= 3 && !ignoredNameTokens.has(token))
      .sort((left, right) => right.length - left.length);
  }

  /** Uses a single validated name token; wildcard/quoted variants currently trigger API 500s. */
  function safePokemonNameQuery(value) {
    const token = nameTokens(value).find(value => !pokemonVariantTokens.has(value));
    if (!token) return '';
    return 'name:' + token;
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
    const cardType = String(hints && hints.cardType || 'unknown');
    const names = manual
      ? [manual]
      : (cardType === 'trainer' || cardType === 'energy')
        ? hints && hints.language === 'en' && Number(hints.titleConfidence) >= 0.76
          ? [hints.mainTitle]
          : []
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
        + '&pageSize=100&select=id,name,number,images,set,rarity,hp,supertype,subtypes,artist,attacks,abilities,rules,cardmarket,tcgplayer'
    );
  }

  function tcgdexNames(hints, manual, language) {
    const identity = hints && hints.pokemonIdentity || {};
    const cardType = String(hints && hints.cardType || 'unknown');
    const localizedBase = String(language || '').toLowerCase() === 'de'
      ? identity.germanName
      : identity.englishName;
    const localizedIdentity = [localizedBase, identity.variant].filter(Boolean).join(' ');
    const values = manual
      ? [manual]
      : (cardType === 'trainer' || cardType === 'energy')
        ? Number(hints && hints.titleConfidence) >= 0.76 && hints.mainTitle
          ? [hints.mainTitle]
          : []
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
    const cardType = String(hints && hints.cardType || 'unknown');
    if ((cardType === 'trainer' || cardType === 'energy') && numbers.length) {
      // Trainer/energy identity starts with the footer number. The localized
      // title then confirms the otherwise non-unique localId across sets.
      numbers.forEach(localId => variants.push({localId}));
      if (names[0]) variants.push({name: names[0], localId: numbers[0]});
      names.forEach(name => variants.push({name}));
    } else {
      names.forEach(name => variants.push({name}));
      // A localId such as 48 occurs in many unrelated sets. It is useful only as
      // a fallback when OCR found no reliable Pokemon name; otherwise the combined
      // query is both more precise and dramatically cheaper to hydrate.
      if (!names.length) numbers.forEach(localId => variants.push({localId}));
      if (names[0] && numbers[0]) variants.unshift({name: names[0], localId: numbers[0]});
    }
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
  /** Only documented YGOPRODeck v7 parameters; empty values are never emitted. */
  function buildYuGiOhUrls(features, manual, language) {
    const data = features || {};
    const urls = [];
    const setCode = String(data.setCode || '').trim().toUpperCase();
    const passcode = String(data.passcode || '').replace(/\D/g, '');
    const name = String(manual || data.name || '').replace(/\s+/g, ' ').trim();
    const localized = /^(?:de|fr|it|pt)$/i.test(String(language || ''))
      ? String(language).toLowerCase() : '';
    if (/^\d{8}$/.test(passcode)) {
      const params = {id: passcode};
      if (localized) params.language = localized;
      urls.push('https://db.ygoprodeck.com/api/v7/cardinfo.php?' + new URLSearchParams(params).toString());
    }
    if (setCode) {
      urls.push('https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?'
        + new URLSearchParams({setcode: setCode}).toString());
    }
    if (name) {
      const params = {fname: name, num: '30', offset: '0'};
      if (localized) params.language = localized;
      urls.push('https://db.ygoprodeck.com/api/v7/cardinfo.php?' + new URLSearchParams(params).toString());
    }
    return [...new Set(urls)];
  }

  function buildOnePieceUrls(features, manual) {
    const hint = String(manual || features && features.cardCode || '').toUpperCase();
    const match = hint.match(/\b(?:(?:OP|ST|EB|PRB|EX|DON)\d{2}-\d{3}|P-\d{3})\b/);
    if (!match) return [];
    return ['sets', 'decks'].map(endpoint =>
      'https://optcgapi.com/api/' + endpoint + '/card/' + encodeURIComponent(match[0]) + '/');
  }

  async function settleSearchVariants(urls, request, options) {
    const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
    const settled = await Promise.allSettled(uniqueUrls.map(url =>
      requestJsonWithRetry(url, request, options)
    ));
    const values = [];
    const errors = [];
    let resultCount = 0;
    let emptyCount = 0;
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const value = result.value;
        const count = Array.isArray(value)
          ? value.length
          : Array.isArray(value && value.data) ? value.data.length : value ? 1 : 0;
        resultCount += count;
        if (count === 0) emptyCount++;
        values.push({url: uniqueUrls[index], value, resultCount: count});
      }
      else errors.push({...errorDetails(result.reason, uniqueUrls[index]), error: result.reason});
    });
    const allFailed = uniqueUrls.length > 0 && values.length === 0 && errors.length === uniqueUrls.length;
    return {
      values,
      errors,
      requestedCount: uniqueUrls.length,
      successCount: values.length,
      emptyCount,
      resultCount,
      unavailable: allFailed && errors.every(error => ['network', 'timeout', 'http'].includes(error.kind))
    };
  }

  /** Distinguishes no matches from transport, HTTP, parsing and bridge configuration failures. */
  function summarizeSearchFailure(results) {
    const sources = (results || []).filter(Boolean);
    const requestedCount = sources.reduce((sum, source) => sum + Number(source.requestedCount || 0), 0);
    const successCount = sources.reduce((sum, source) => sum + Number(source.successCount || 0), 0);
    const resultCount = sources.reduce((sum, source) => sum + Number(source.resultCount || 0), 0);
    const errors = sources.flatMap(source => source.errors || []);
    const statuses = [...new Set(errors.map(error => Number(error.status) || 0).filter(Boolean))];
    if (!requestedCount || successCount > 0) {
      return {kind: resultCount > 0 ? 'results' : 'empty', requestedCount, successCount, resultCount, statuses};
    }
    const kinds = [...new Set(errors.map(error => error.kind || inferErrorKind(error)))];
    let kind = 'mixed';
    if (kinds.includes('allowlist') || kinds.includes('request')) kind = 'configuration';
    else if (kinds.length === 1) kind = kinds[0];
    else if (kinds.every(value => value === 'network' || value === 'timeout')) kind = 'network';
    return {kind, requestedCount, successCount, resultCount, statuses};
  }

  return {
    HttpRequestError,
    createHttpError,
    errorDetails,
    isRetryableStatus,
    isRetryableError,
    formatHttpFailure,
    requestJsonWithRetry,
    cleanNameCandidate,
    safePokemonNameQuery,
    normalizedCollectorNumber,
    buildPokemonTcgQueries,
    buildPokemonTcgUrls,
    buildTcgdexUrls,
    buildYuGiOhUrls,
    buildOnePieceUrls,
    settleSearchVariants,
    summarizeSearchFailure
  };
});
