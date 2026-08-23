'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const Recognition = window.PokeRecognition;
const Api = window.PokeApi;

let selectedTcg = 'auto';
let recognizedTcg = 'pokemon';
let filter = 'all';
let last = null;
let recognition = null;
let candidates = [];
let recognitionTimer = null;
let recognitionRun = 0;
let recognizedRotation = 0;
let requestSequence = 1;
const pendingOcr = new Map();
const pendingHttp = new Map();
const pendingVisual = new Map();
const pendingPreparation = new Map();
const previewUrls = new Map();

$$('nav button').forEach(button => {
  button.onclick = () => {
    $$('nav button').forEach(item => item.classList.remove('active'));
    $$('.page').forEach(page => page.classList.remove('active'));
    button.classList.add('active');
    $('#' + button.dataset.page).classList.add('active');
    if (button.dataset.page === 'collection') renderCollection();
  };
});

$$('.tcgs button').forEach(button => {
  button.onclick = () => {
    selectedTcg = button.dataset.tcg;
    $$('.tcgs button').forEach(item => item.classList.toggle('active', item === button));
    if ($('#front').files[0]) scheduleRecognition(120);
  };
});

$$('.filters button').forEach(button => {
  button.onclick = () => {
    $$('.filters button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    filter = button.dataset.filter;
    renderCollection();
  };
});

$('#lang').onchange = () => {
  if ($('#front').files[0]) scheduleRecognition(120);
};

function bindPhoto(id) {
  const input = $('#' + id);
  const image = $('#' + id + 'Img');
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (previewUrls.has(id)) URL.revokeObjectURL(previewUrls.get(id));
    const previewUrl = URL.createObjectURL(file);
    previewUrls.set(id, previewUrl);
    image.src = previewUrl;
    input.parentElement.classList.add('has');
    if (id === 'front') {
      recognition = null;
      candidates = [];
      recognizedRotation = 0;
      $('#comparisonScanImg').src = previewUrl;
      renderCandidates(false);
      scheduleRecognition(180);
    }
  };
}

bindPhoto('front');
bindPhoto('back');

function scheduleRecognition(delay = 220) {
  clearTimeout(recognitionTimer);
  recognitionTimer = setTimeout(() => runRecognition(false), delay);
}

function setRecState(kind, title, text) {
  $('#recognitionState').className = 'status ' + kind;
  $('#recognitionState').textContent = title;
  $('#recognitionText').textContent = text || '';
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function label(tcg) {
  return ({pokemon: 'Pokémon', yugioh: 'Yu-Gi-Oh!', onepiece: 'One Piece'})[tcg] || tcg;
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Das Bild konnte nicht geladen werden.'));
    reader.readAsDataURL(file);
  });
}

async function imageFromFile(file) {
  const source = await fileDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Das Bildformat wird nicht unterstützt.'));
    image.src = source;
  });
}

/** Sends the whole upload, not a premature center crop, through the native card detector. */
async function ocrDataUrl(file) {
  const image = await imageFromFile(file);
  const canvas = $('#work');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const factor = Math.min(1, 1900 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(2, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(2, Math.round(image.naturalHeight * factor));
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.91);
}

/** Locates and rectifies the printed card once before any candidate comparison. */
async function visualComparisonDataUrl(file) {
  const image = await imageFromFile(file);
  const canvas = $('#work');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const factor = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(2, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(2, Math.round(image.naturalHeight * factor));
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const sourceDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  try {
    return await nativePrepareCard(sourceDataUrl);
  } catch (error) {
    console.warn('Kartenkontur nicht vorab verfügbar:', error.message);
    return {dataUrl: sourceDataUrl, reliable: false, method: 'native-fallback', prepared: false};
  }
}

function drawRotated(image, rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  const swap = normalized === 90 || normalized === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? image.naturalHeight : image.naturalWidth;
  canvas.height = swap ? image.naturalWidth : image.naturalHeight;
  const context = canvas.getContext('2d');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(normalized * Math.PI / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas;
}

async function canonicalDataUrl(file, quality = 0.9, rotation = 0) {
  const image = await imageFromFile(file);
  const oriented = drawRotated(image, rotation);
  const canvas = $('#work');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const cardRatio = 63 / 88;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = oriented.width;
  let sourceHeight = oriented.height;
  const currentRatio = sourceWidth / sourceHeight;
  if (currentRatio > cardRatio) {
    sourceWidth = sourceHeight * cardRatio;
    sourceX = (oriented.width - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / cardRatio;
    sourceY = (oriented.height - sourceHeight) / 2;
  }
  canvas.width = 756;
  canvas.height = 1056;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    oriented,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL('image/jpeg', quality);
}

window.onNativeOcrResult = json => {
  try {
    const response = JSON.parse(json);
    const pending = pendingOcr.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingOcr.delete(response.requestId);
    if (response.ok) pending.resolve(response);
    else pending.reject(new Error(response.error || 'OCR fehlgeschlagen.'));
  } catch (error) {
    console.error(error);
  }
};

window.onNativeHttpResult = json => {
  try {
    const response = JSON.parse(json);
    const pending = pendingHttp.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingHttp.delete(response.requestId);
    if (!response.ok) {
      pending.reject(Api.createHttpError({
        url: response.url || pending.url,
        status: response.status,
        body: response.body,
        retryAfterMs: response.retryAfterMs,
        error: response.error || ('HTTP ' + (response.status || 0))
      }));
      return;
    }
    try {
      pending.resolve(JSON.parse(response.body));
    } catch (error) {
      pending.reject(Api.createHttpError({
        url: response.url || pending.url,
        status: response.status,
        body: response.body,
        error: 'Die Kartendatenbank hat ungültige Daten geliefert.'
      }));
    }
  } catch (error) {
    console.error(error);
  }
};

window.onNativeVisualResult = json => {
  try {
    const response = JSON.parse(json);
    const pending = pendingVisual.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingVisual.delete(response.requestId);
    if (response.ok) pending.resolve(response);
    else pending.reject(new Error(response.error || 'Bildvergleich fehlgeschlagen.'));
  } catch (error) {
    console.error(error);
  }
};

window.onNativePreparedCard = json => {
  try {
    const response = JSON.parse(json);
    const pending = pendingPreparation.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingPreparation.delete(response.requestId);
    if (response.ok) pending.resolve({...response, prepared: true});
    else pending.reject(new Error(response.error || 'Karte konnte nicht ausgeschnitten werden.'));
  } catch (error) {
    console.error(error);
  }
};

function nativeOcr(dataUrl, language) {
  return new Promise((resolve, reject) => {
    if (!window.PokeNative || (!PokeNative.recognizeCard && !PokeNative.recognizeText)) {
      reject(new Error('Das lokale OCR-Modul ist nicht verfügbar.'));
      return;
    }
    const requestId = 'ocr' + requestSequence++;
    const timeout = setTimeout(() => {
      pendingOcr.delete(requestId);
      reject(new Error('Die Bilderkennung hat zu lange gedauert.'));
    }, 45000);
    pendingOcr.set(requestId, {resolve, reject, timeout});
    if (PokeNative.recognizeCard) PokeNative.recognizeCard(dataUrl, requestId, language);
    else PokeNative.recognizeText(dataUrl, requestId, language);
  });
}

function nativePrepareCard(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!window.PokeNative || !PokeNative.prepareCardImage) {
      reject(new Error('Lokale Kartenlokalisierung nicht verfügbar.'));
      return;
    }
    const requestId = 'prepare' + requestSequence++;
    const timeout = setTimeout(() => {
      pendingPreparation.delete(requestId);
      reject(new Error('Die Kartenlokalisierung hat zu lange gedauert.'));
    }, 16000);
    pendingPreparation.set(requestId, {resolve, reject, timeout});
    PokeNative.prepareCardImage(dataUrl, requestId);
  });
}

function nativeVisualCompare(preparedCard, imageUrl) {
  return new Promise((resolve, reject) => {
    if (!window.PokeNative || !PokeNative.compareCardImage || !imageUrl) {
      reject(new Error('Lokaler Bildvergleich nicht verfügbar.'));
      return;
    }
    const requestId = 'visual' + requestSequence++;
    const timeout = setTimeout(() => {
      pendingVisual.delete(requestId);
      reject(new Error('Der Bildvergleich hat zu lange gedauert.'));
    }, 15000);
    pendingVisual.set(requestId, {resolve, reject, timeout});
    if (preparedCard.prepared && PokeNative.comparePreparedCardImage) {
      PokeNative.comparePreparedCardImage(
        preparedCard.dataUrl,
        imageUrl,
        requestId,
        preparedCard.reliable !== false,
        preparedCard.method || 'prepared'
      );
    } else {
      PokeNative.compareCardImage(preparedCard.dataUrl, imageUrl, requestId);
    }
  });
}

function nativeGetOnce(url) {
  return new Promise((resolve, reject) => {
    if (window.PokeNative && PokeNative.httpGet) {
      const requestId = 'http' + requestSequence++;
      const timeout = setTimeout(() => {
        pendingHttp.delete(requestId);
        reject(Api.createHttpError({
          url,
          status: 0,
          body: '',
          error: 'Die Kartendatenbank antwortet nicht.'
        }));
      }, 16000);
      pendingHttp.set(requestId, {resolve, reject, timeout, url});
      PokeNative.httpGet(url, requestId);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(url, {headers: {'Accept': 'application/json'}, signal: controller.signal})
      .then(async response => {
        const body = await response.text();
        if (!response.ok) {
          const retryAfter = Number(response.headers.get('Retry-After'));
          throw Api.createHttpError({
            url,
            status: response.status,
            body,
            retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
            error: 'HTTP ' + response.status
          });
        }
        try {
          return JSON.parse(body);
        } catch (error) {
          throw Api.createHttpError({
            url,
            status: response.status,
            body,
            error: 'Die Kartendatenbank hat ungültige Daten geliefert.'
          });
        }
      })
      .then(resolve, error => {
        if (error && error.name === 'AbortError') {
          reject(Api.createHttpError({url, status: 0, error: 'Zeitüberschreitung der Kartendatenbank.'}));
        } else {
          reject(error);
        }
      })
      .finally(() => clearTimeout(timeout));
  });
}

function nativeGet(url) {
  return Api.requestJsonWithRetry(url, nativeGetOnce, {
    attempts: 3,
    backoffMs: [250, 650],
    logger: message => console.error(message)
  });
}

function chooseRecognitionRotation(ocrResult) {
  let best = {rotation: 0, score: -1};
  (ocrResult.passes || []).forEach(pass => {
    const hints = Recognition.extractHints({passes: [pass]});
    const score = (hints.collectorNumbers.length * 6)
      + (hints.hp ? 2 : 0)
      + (hints.nameHints[0] ? hints.nameHints[0].votes : 0)
      + (pass.text || '').length / 500;
    const match = String(pass.variant || '').match(/-(0|90|180|270)$/);
    if (score > best.score && match) best = {rotation: Number(match[1]), score};
  });
  return best.rotation;
}

function pokemonCardFromApi(card) {
  const cardmarket = card.cardmarket && card.cardmarket.prices || {};
  const tcgPrices = card.tcgplayer && card.tcgplayer.prices || {};
  const usdPrice = Object.values(tcgPrices)
    .map(entry => entry && (entry.market || entry.mid || entry.low))
    .find(value => Number.isFinite(Number(value)));
  const eurPrice = cardmarket.averageSellPrice || cardmarket.trendPrice || cardmarket.lowPrice;
  return {
    tcg: 'pokemon',
    id: card.id,
    name: card.name,
    number: card.number,
    set: card.set && card.set.name,
    setId: card.set && card.set.id,
    series: card.set && card.set.series,
    printedTotal: card.set && card.set.printedTotal,
    total: card.set && card.set.total,
    rarity: card.rarity || '',
    hp: card.hp || '',
    subtypes: card.subtypes || [],
    artist: card.artist || '',
    imageSmall: card.images && (card.images.small || card.images.large) || '',
    imageLarge: card.images && (card.images.large || card.images.small) || '',
    source: 'Pokémon TCG API',
    price: Number.isFinite(Number(eurPrice))
      ? {value: Number(eurPrice), currency: 'EUR', label: Number(eurPrice).toFixed(2).replace('.', ',') + ' €'}
      : Number.isFinite(Number(usdPrice))
        ? {value: Number(usdPrice), currency: 'USD', label: '$' + Number(usdPrice).toFixed(2)}
        : null
  };
}

function tcgdexImageUrl(value, quality) {
  const base = String(value || '').replace(/\/$/, '');
  if (!base) return '';
  if (/\.(?:avif|webp|png|jpe?g)$/i.test(base)) return base;
  return base + '/' + quality + '.webp';
}

function pokemonCardFromTcgdex(card) {
  const set = card.set || {};
  const cardCount = set.cardCount || {};
  return {
    tcg: 'pokemon',
    id: 'tcgdex:' + card.id,
    name: card.name,
    number: card.localId || card.number || '',
    set: set.name || '',
    setId: set.id || String(card.id || '').split('-')[0],
    series: set.serie && set.serie.name || '',
    printedTotal: cardCount.official || '',
    total: cardCount.total || '',
    rarity: card.rarity || '',
    hp: card.hp || '',
    subtypes: card.stage ? [card.stage] : [],
    artist: card.illustrator || '',
    imageSmall: tcgdexImageUrl(card.image, 'low'),
    imageLarge: tcgdexImageUrl(card.image, 'high'),
    source: 'TCGdex (Deutsch)',
    price: null
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, values.length)}, () => worker()));
  return output;
}

async function hydrateTcgdexCards(cards, language, runToken) {
  const unique = [...new Map(cards.map(card => [card.id, card])).values()].slice(0, 60);
  let failures = 0;
  return mapWithConcurrency(unique, 4, async brief => {
    if (runToken !== undefined && runToken !== recognitionRun) return brief;
    if (brief.hp && brief.set && brief.rarity) return brief;
    if (failures >= 4) return brief;
    try {
      const full = await nativeGetOnce(
        'https://api.tcgdex.net/v2/' + encodeURIComponent(language)
          + '/cards/' + encodeURIComponent(brief.id)
      );
      return {...brief, ...full, image: full.image || brief.image, localId: full.localId || brief.localId};
    } catch (error) {
      failures++;
      console.warn('TCGdex-Detail konnte nicht geladen werden:', brief.id, error.message);
      return brief;
    }
  });
}

function pokemonVariantKey(candidate) {
  const setKey = Recognition.norm(candidate.setId || candidate.set || '')
    .replace(/\s+/g, '')
    .replace(/^([a-z]+)0+(\d)/, '$1$2');
  const numberKey = Recognition.numberKey(candidate.number || '');
  if (setKey && numberKey) return setKey + '|' + numberKey;
  return Recognition.norm(candidate.name) + '|' + setKey + '|' + numberKey;
}

function mergePokemonCandidate(current, incoming, language) {
  if (!current) return incoming;
  const incomingLocalized = incoming.source && incoming.source.includes('TCGdex');
  const preferIncomingText = language === 'de' && incomingLocalized;
  const sources = new Set(
    String(current.source || '').split(' + ').concat(String(incoming.source || '').split(' + ')).filter(Boolean)
  );
  return {
    ...current,
    name: preferIncomingText && incoming.name ? incoming.name : current.name || incoming.name,
    set: preferIncomingText && incoming.set ? incoming.set : current.set || incoming.set,
    setId: current.setId || incoming.setId,
    series: current.series || incoming.series,
    number: current.number || incoming.number,
    printedTotal: current.printedTotal || incoming.printedTotal,
    total: current.total || incoming.total,
    rarity: preferIncomingText && incoming.rarity ? incoming.rarity : current.rarity || incoming.rarity,
    hp: current.hp || incoming.hp,
    subtypes: current.subtypes && current.subtypes.length ? current.subtypes : incoming.subtypes,
    artist: current.artist || incoming.artist,
    imageSmall: current.imageSmall || incoming.imageSmall,
    imageLarge: current.imageLarge || incoming.imageLarge,
    price: current.price || incoming.price,
    source: [...sources].join(' + ')
  };
}

async function pokemonSearch(hints, manual = '', runToken) {
  const primaryCards = new Map();
  const language = $('#lang').value === 'de' ? 'de' : 'en';
  const primaryPromise = Api.settleSearchVariants(
    Api.buildPokemonTcgUrls(hints, manual),
    nativeGetOnce,
    {attempts: 3, backoffMs: [250, 650], logger: message => console.error(message)}
  );
  // German cards use the localized provider in parallel, so an unhealthy primary API adds no delay.
  const localizedPromise = language === 'de'
    ? Api.settleSearchVariants(
      Api.buildTcgdexUrls(hints, manual, language),
      nativeGetOnce,
      {attempts: 3, backoffMs: [250, 650], logger: message => console.error(message)}
    )
    : null;
  const primary = await primaryPromise;
  primary.values.forEach(response => {
    (response.value.data || []).forEach(card => primaryCards.set(card.id, pokemonCardFromApi(card)));
  });

  const useAlternative = language === 'de' || !primaryCards.size || primary.unavailable;
  const alternative = useAlternative
    ? await (localizedPromise || Api.settleSearchVariants(
      Api.buildTcgdexUrls(hints, manual, language),
      nativeGetOnce,
      {attempts: 3, backoffMs: [250, 650], logger: message => console.error(message)}
    ))
    : {values: [], errors: [], successCount: 0, unavailable: false};
  const tcgdexBriefs = new Map();
  alternative.values.forEach(response => {
    const list = Array.isArray(response.value) ? response.value : response.value && response.value.data || [];
    list.forEach(card => tcgdexBriefs.set(card.id, card));
  });
  const primaryVariantKeys = new Set([...primaryCards.values()].map(pokemonVariantKey));
  const briefCandidates = [...tcgdexBriefs.values()].map(pokemonCardFromTcgdex);
  const missingDetails = [...tcgdexBriefs.values()].filter((brief, index) => {
    return !primaryVariantKeys.has(pokemonVariantKey(briefCandidates[index]));
  });
  const hydratedMissing = useAlternative
    ? await hydrateTcgdexCards(missingDetails, language, runToken)
    : [];
  const hydratedById = new Map(hydratedMissing.map(card => [card.id, card]));
  const tcgdexCards = [...tcgdexBriefs.values()].map(brief => hydratedById.get(brief.id) || brief);

  const variants = new Map();
  [...primaryCards.values(), ...tcgdexCards.map(pokemonCardFromTcgdex)].forEach(candidate => {
    const key = pokemonVariantKey(candidate);
    variants.set(key, mergePokemonCandidate(variants.get(key), candidate, language));
  });
  const broadlyRanked = Recognition.rankPokemonCandidates(
    [...variants.values()], hints, manual, 80
  ).filter(candidate => {
    const details = candidate.matchDetails || {};
    return details.collector === 'match' || details.name >= 0.58;
  });

  return {
    candidates: broadlyRanked,
    status: {
      primaryUnavailable: primary.unavailable,
      alternativeUnavailable: useAlternative && alternative.unavailable,
      primaryErrors: primary.errors,
      alternativeErrors: alternative.errors
    }
  };
}

function emptyLookupStatus() {
  return {
    primaryUnavailable: false,
    alternativeUnavailable: false,
    primaryErrors: [],
    alternativeErrors: []
  };
}

function recoveryMessage(status) {
  if (!status || !status.primaryUnavailable) return '';
  $('#manualDetails').open = true;
  if (status.alternativeUnavailable) {
    return 'Die Pokémon-Kartendienste sind momentan nicht erreichbar. Die lokale OCR ist abgeschlossen; du kannst Name, Set und Nummer weiterhin manuell eintragen und später erneut suchen.';
  }
  return 'Die Pokémon-TCG-API ist momentan nicht erreichbar. Die deutschsprachige Ausweichsuche wurde weiter ausgewertet; du kannst außerdem jederzeit manuell suchen.';
}

async function yugiohSearch(hints, manual = '') {
  const language = $('#lang').value;
  const languageArgument = language === 'de' ? '&language=de' : '';
  if (hints.yugiohSetCode) {
    try {
      const result = await nativeGet(
        'https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=' + encodeURIComponent(hints.yugiohSetCode)
      );
      const list = Array.isArray(result) ? result : result && result.data || [];
      if (list.length) {
        return list.slice(0, 7).map(card => ({
          tcg: 'yugioh',
          id: card.id,
          name: card.name,
          number: card.set_code || hints.yugiohSetCode,
          set: card.set_name || '',
          rarity: card.set_rarity || '',
          imageSmall: (card.card_images && card.card_images[0] && (card.card_images[0].image_url_small || card.card_images[0].image_url)) || '',
          imageLarge: (card.card_images && card.card_images[0] && (card.card_images[0].image_url || card.card_images[0].image_url_small)) || '',
          source: 'YGOPRODeck',
          confidence: 0.98,
          evidence: ['Setcode']
        }));
      }
    } catch (error) {
      console.warn(error);
    }
  }
  const query = (manual || hints.nameHint || '').trim();
  if (!query) return [];
  const result = await nativeGet(
    'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=' + encodeURIComponent(query)
      + languageArgument + '&num=30&offset=0'
  );
  return (result.data || []).map(card => {
    const firstSet = (card.card_sets || [])[0] || {};
    return {
      tcg: 'yugioh',
      id: card.id,
      name: card.name,
      number: firstSet.set_code || '',
      set: firstSet.set_name || '',
      rarity: firstSet.set_rarity || '',
      imageSmall: (card.card_images && card.card_images[0] && (card.card_images[0].image_url_small || card.card_images[0].image_url)) || '',
      imageLarge: (card.card_images && card.card_images[0] && (card.card_images[0].image_url || card.card_images[0].image_url_small)) || '',
      source: 'YGOPRODeck',
      confidence: Recognition.similarity(query, card.name),
      evidence: ['Name']
    };
  }).sort((a, b) => b.confidence - a.confidence).slice(0, 7);
}

function parseOnePieceCard(response, id) {
  let card = Array.isArray(response) ? response[0] : response;
  if (card && card.data) card = Array.isArray(card.data) ? card.data[0] : card.data;
  if (!card) return null;
  const image = card.image_url || card.card_image || card.image || card.imageUrl || '';
  return {
    tcg: 'onepiece',
    id: card.card_id || card.id || id,
    name: card.card_name || card.name || 'One Piece Karte',
    number: card.card_id || card.card_number || id,
    set: card.set_name || card.set || '',
    rarity: card.rarity || card.card_rarity || '',
    imageSmall: image,
    imageLarge: card.image_url_large || card.card_image_large || image,
    source: 'OPTCG API',
    confidence: 0.99,
    evidence: ['Kartencode']
  };
}

async function onePieceSearch(hints, manual = '') {
  const manualMatch = String(manual).toUpperCase().match(/\b(?:OP|ST|EB|PRB|EX|DON)\d{2}-\d{3}\b/);
  const code = (hints.onepieceId || (manualMatch && manualMatch[0]) || '').toUpperCase();
  if (!code) return [];
  for (const endpoint of ['sets', 'decks']) {
    try {
      const response = await nativeGet(
        'https://optcgapi.com/api/' + endpoint + '/card/' + encodeURIComponent(code) + '/'
      );
      const card = parseOnePieceCard(response, code);
      if (card) return [card];
    } catch (error) {
      console.warn(error);
    }
  }
  return [];
}

async function lookupCandidates(kind, hints, manual = '', runToken) {
  if (kind === 'pokemon') return pokemonSearch(hints, manual, runToken);
  if (kind === 'yugioh') return {candidates: await yugiohSearch(hints, manual), status: emptyLookupStatus()};
  if (kind === 'onepiece') return {candidates: await onePieceSearch(hints, manual), status: emptyLookupStatus()};
  return {candidates: [], status: emptyLookupStatus()};
}

async function enrichWithVisualSimilarity(list, preparedCard, runToken) {
  const visualLimit = Math.min(60, list.length);
  let consecutiveFailures = 0;
  const enriched = await mapWithConcurrency(list.slice(0, visualLimit), 3, async candidate => {
    if (runToken !== undefined && runToken !== recognitionRun) return candidate;
    if (candidate.tcg !== 'pokemon') return candidate;
    // The list keeps lightweight thumbnails, but variant discrimination needs
    // the highest-resolution artwork available (fine frame/footer differences).
    const imageUrl = candidate.imageLarge || candidate.imageSmall;
    if (!imageUrl) return candidate;
    if (consecutiveFailures >= 6) return candidate;
    try {
      const result = await nativeVisualCompare(preparedCard, imageUrl);
      consecutiveFailures = 0;
      return Recognition.combineVisualSimilarity(candidate, result);
    } catch (error) {
      consecutiveFailures++;
      console.warn('Bildvergleich für Kandidat fehlgeschlagen:', candidate.id, error.message);
      return candidate;
    }
  });
  return enriched.concat(list.slice(visualLimit))
    .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))
    .slice(0, 60);
}

function evidenceLabel(value) {
  return ({
    'Name': 'Name stimmt',
    'Kartennummer': 'Kartennummer stimmt',
    'Setnummer': 'Set stimmt',
    'Setcode': 'Set stimmt',
    'Artwork ähnlich': 'Artwork ähnlich',
    'Artwork abweichend': 'Artwork weicht ab',
    'KP/HP': 'KP/HP stimmt',
    'KP/HP abweichend': 'KP/HP weichen ab',
    'Kartennummer abweichend': 'Kartennummer weicht ab',
    'Set abweichend': 'Set weicht ab',
    'Seltenheit': 'Seltenheit stimmt',
    'Illustrator': 'Illustrator stimmt',
    'Entwicklungsstufe': 'Entwicklungsstufe stimmt'
  })[value] || value;
}

function matchStatus(value, unknownText = 'unbekannt') {
  return value === 'match' ? 'stimmt' : value === 'mismatch' ? 'abweichend' : unknownText;
}

function candidateBreakdown(candidate) {
  const details = candidate.matchDetails || {};
  const name = Number.isFinite(Number(details.name))
    ? Math.round(Number(details.name) * 100) + ' %' : 'nicht erkannt';
  const collector = matchStatus(details.collector, 'nicht erkannt');
  const hp = matchStatus(details.hp, 'unbekannt');
  const set = matchStatus(details.set, 'unbekannt');
  const artwork = Number.isFinite(Number(details.artwork))
    ? Math.round(Number(details.artwork) * 100) + ' %'
      + (details.visualReliable === false ? ' (Kontur unsicher)' : '')
    : 'nicht verfügbar';
  return `<div class="match-breakdown">
    <div><span>Name</span><b>${esc(name)}</b></div>
    <div><span>Kartennummer</span><b class="${esc(details.collector || 'unknown')}">${esc(collector)}</b></div>
    <div><span>Artwork</span><b>${esc(artwork)}</b></div>
    <div><span>KP/HP</span><b class="${esc(details.hp || 'unknown')}">${esc(hp)}</b></div>
    <div><span>Set</span><b class="${esc(details.set || 'unknown')}">${esc(set)}</b></div>
  </div>`;
}

function renderCandidates(showEmpty = false) {
  const box = $('#candidateList');
  const comparison = $('#matchComparison');
  const empty = $('#emptyMatches');
  if (!candidates.length) {
    box.innerHTML = '';
    comparison.hidden = true;
    empty.hidden = !showEmpty;
    return;
  }

  const shown = candidates.slice(0, 5);
  const confident = Recognition.isConfident(candidates);
  const plausible = Recognition.hasPlausibleCandidate(candidates);
  empty.hidden = true;
  comparison.hidden = false;
  $('#scanReference').hidden = !previewUrls.has('front');
  if (previewUrls.has('front')) $('#comparisonScanImg').src = previewUrls.get('front');
  $('#matchesTitle').textContent = confident
    ? 'Bester Treffer'
    : plausible ? 'Mögliche Treffer' : 'Keine eindeutige Karte gefunden';
  $('#matchesSubtitle').textContent = confident
    ? 'Deutlichste Übereinstimmung mit Alternativen'
    : plausible ? 'Mehrere Karten könnten passen' : 'Varianten weichen in wichtigen Merkmalen ab';

  box.innerHTML = shown.map((candidate, index) => {
    const confidence = Math.round(clamp(Number(candidate.confidence) || 0, 0, 1) * 100);
    const high = confidence >= 82;
    const selected = Boolean(recognition && recognition.accepted && recognition.id === candidate.id);
    const imageUrl = candidate.imageSmall || candidate.imageLarge || '';
    const reasons = (candidate.evidence || []).slice(0, 5)
      .map(value => `<span>${esc(evidenceLabel(value))}</span>`)
      .join('');
    const price = candidate.price ? esc(candidate.price.label) : 'Kein Preis verfügbar';
    const bestBadge = index === 0
      ? `<span class="best-badge">${confident ? 'Bester Treffer' : plausible ? 'Wahrscheinlichster Treffer' : 'Niedrige Übereinstimmung'}</span>`
      : '';
    const image = imageUrl
      ? `<img loading="lazy" decoding="async" src="${esc(imageUrl)}" alt="${esc(candidate.name)}" onerror="candidateImageFailed(this)">`
      : '';
    const imageContent = `<span class="candidate-image-placeholder${imageUrl ? '' : ' visible'}" aria-hidden="true"><b>Kartenbild</b><small>nicht verfügbar</small></span>${image}`;
    const imageWrapper = imageUrl
      ? `<button type="button" class="candidate-image-button" onclick="openCandidateImage(${index})" aria-label="${esc(candidate.name)} vergrößern">${imageContent}</button>`
      : `<div class="candidate-image-button no-image">${imageContent}</div>`;
    return `<article class="candidate-card${index === 0 ? ' best' : ''}${high ? ' high-confidence' : ''}${selected ? ' selected' : ''}">
      <div class="candidate-visual">${bestBadge}${imageWrapper}<span class="confidence-badge">${confidence} % Gesamt</span></div>
      <div class="candidate-content">
        <div class="candidate-title"><b>${esc(candidate.name || 'Unbekannte Karte')}</b><small>${esc(candidate.set || 'Set unbekannt')}</small></div>
        <dl class="candidate-meta">
          <div><dt>Nummer</dt><dd>${esc(candidate.number || '–')}</dd></div>
          <div><dt>Seltenheit</dt><dd>${esc(candidate.rarity || '–')}</dd></div>
          <div><dt>Preis</dt><dd>${price}</dd></div>
        </dl>
        <div class="confidence-track" aria-label="Trefferwahrscheinlichkeit ${confidence} Prozent"><span style="width:${confidence}%"></span></div>
        ${candidate.tcg === 'pokemon' ? candidateBreakdown(candidate) : ''}
        <div class="candidate-reasons">${reasons || '<span>Bild und Kartendaten prüfen</span>'}</div>
        <small class="candidate-source">Quelle: ${esc(candidate.source || 'Kartendatenbank')}</small>
        <button class="choose-card" type="button" onclick="applyCandidate(${index})">${selected ? 'Ausgewählt' : 'Diese Karte wählen'}</button>
      </div>
    </article>`;
  }).join('');
}

window.candidateImageFailed = image => {
  image.hidden = true;
  const placeholder = image.parentElement && image.parentElement.querySelector('.candidate-image-placeholder');
  if (placeholder) placeholder.classList.add('visible');
};

window.openCandidateImage = index => {
  const candidate = candidates[index];
  if (!candidate) return;
  const imageUrl = candidate.imageLarge || candidate.imageSmall;
  if (!imageUrl) return;
  $('#lightboxImage').src = imageUrl;
  $('#lightboxCaption').textContent = [candidate.name, candidate.set, candidate.number].filter(Boolean).join(' · ');
  $('#imageLightbox').hidden = false;
};

window.openScanPreview = () => {
  const imageUrl = previewUrls.get('front');
  if (!imageUrl) return;
  $('#lightboxImage').src = imageUrl;
  $('#lightboxCaption').textContent = 'Gescanntes Bild';
  $('#imageLightbox').hidden = false;
};

window.closeImageLightbox = () => {
  $('#imageLightbox').hidden = true;
  $('#lightboxImage').removeAttribute('src');
};

window.takeNewPhoto = () => $('#front').click();
window.openManualSearch = () => {
  $('#manualDetails').open = true;
  $('#manualQuery').focus();
};

$('#imageLightbox').onclick = event => {
  if (event.target === $('#imageLightbox')) closeImageLightbox();
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#imageLightbox').hidden) closeImageLightbox();
});

window.applyCandidate = index => {
  const candidate = candidates[index];
  if (!candidate) return;
  recognition = {...candidate, accepted: true};
  recognizedTcg = candidate.tcg;
  $('#name').value = candidate.name || '';
  $('#set').value = candidate.set || '';
  $('#number').value = candidate.number || '';
  setRecState(
    'good',
    'Erkannt',
    `${label(candidate.tcg)} · ${candidate.name}${candidate.set ? ' · ' + candidate.set : ''}`
  );
  renderCandidates(false);
};

async function runRecognition(manual = false) {
  const file = $('#front').files[0];
  if (!file) {
    setRecState('bad', 'Kein Foto', 'Bitte zuerst die Vorderseite aufnehmen oder aus der Galerie wählen.');
    return null;
  }
  const run = ++recognitionRun;
  setRecState(
    'busy',
    'Analysiere …',
    'Rotation, Perspektive, Kontrast und Kartenmerkmale werden lokal ausgewertet.'
  );
  recognition = null;
  candidates = [];
  renderCandidates(false);
  try {
    const dataUrl = await ocrDataUrl(file);
    const ocrResult = await nativeOcr(dataUrl, $('#lang').value);
    if (run !== recognitionRun) return null;
    recognizedRotation = chooseRecognitionRotation(ocrResult);
    const hints = Recognition.extractHints(ocrResult);
    const kind = Recognition.classifyTcg(hints, manual ? selectedTcg : selectedTcg);
    recognizedTcg = kind;
    const lookup = await lookupCandidates(kind, hints, '', run);
    if (run !== recognitionRun) return null;
    let foundCandidates = lookup.candidates;
    if (foundCandidates.some(candidate => candidate.tcg === 'pokemon' && (candidate.imageSmall || candidate.imageLarge))) {
      setRecState('busy', 'Vergleiche Kartenbilder …', 'Artwork und Bildstruktur werden lokal mit den besten Treffern abgeglichen.');
      const visualDataUrl = await visualComparisonDataUrl(file);
      foundCandidates = await enrichWithVisualSimilarity(foundCandidates, visualDataUrl, run);
      if (run !== recognitionRun) return null;
    }
    candidates = foundCandidates;
    renderCandidates(!candidates.length);

    if (!candidates.length) {
      recognition = null;
      const recovery = recoveryMessage(lookup.status);
      if (recovery) {
        setRecState('warn', 'Kartendienst nicht erreichbar', recovery);
        return null;
      }
      const hint = hints.nameHint
        || hints.onepieceId
        || hints.yugiohSetCode
        || (hints.collectorNumbers[0] && `${hints.collectorNumbers[0].number}/${hints.collectorNumbers[0].total}`)
        || 'keine eindeutigen Merkmale';
      setRecState(
        'warn',
        'Keine eindeutige Karte gefunden',
        `Gelesen: ${hint}. Bitte TCG auswählen oder Name bzw. Kartencode manuell suchen.`
      );
      return null;
    }

    const best = candidates[0];
    if (!Recognition.hasPlausibleCandidate(candidates)) {
      recognition = null;
      setRecState(
        'warn',
        'Keine eindeutige Karte gefunden',
        'Die gefundenen Varianten stimmen bei Artwork, Kartennummer oder anderen starken Merkmalen nicht ausreichend überein. Bitte erneut scannen oder manuell suchen.'
      );
      return best;
    }
    if (Recognition.isConfident(candidates)) {
      recognition = null;
      setRecState(
        'good',
        'Bester Treffer',
        'Ein Treffer hebt sich deutlich ab. Bitte vergleiche das Kartenbild und bestätige mit „Diese Karte wählen“.'
      );
      return best;
    }
    recognition = null;
    setRecState(
      'warn',
      'Mehrere Karten könnten passen',
      `${Math.min(5, candidates.length)} wahrscheinliche Treffer aus Name, Kartennummer, Set, Artwork und weiteren Merkmalen gefunden.`
    );
    return best;
  } catch (error) {
    if (run !== recognitionRun) return null;
    recognition = null;
    candidates = [];
    renderCandidates(true);
    setRecState('bad', 'Erkennung fehlgeschlagen', error.message || 'Unbekannter Fehler.');
    return null;
  }
}

$('#recognize').onclick = () => runRecognition(false);

$('#manualSearch').onclick = async () => {
  const query = $('#manualQuery').value.trim();
  if (!query) return;
  const run = ++recognitionRun;
  const kind = selectedTcg === 'auto' ? recognizedTcg : selectedTcg;
  setRecState('busy', 'Suche …', 'Manuelle Kartensuche läuft.');
  try {
    const hints = Recognition.extractHints(query);
    if (kind === 'onepiece') {
      const match = query.toUpperCase().match(/\b(?:OP|ST|EB|PRB|EX|DON)\d{2}-\d{3}\b/);
      if (match) hints.onepieceId = match[0];
    }
    const lookup = await lookupCandidates(kind, hints, query, run);
    if (run !== recognitionRun) return;
    let foundCandidates = lookup.candidates;
    const frontFile = $('#front').files[0];
    if (frontFile && foundCandidates.some(candidate => candidate.tcg === 'pokemon' && (candidate.imageSmall || candidate.imageLarge))) {
      const dataUrl = await visualComparisonDataUrl(frontFile);
      foundCandidates = await enrichWithVisualSimilarity(foundCandidates, dataUrl, run);
      if (run !== recognitionRun) return;
    }
    candidates = foundCandidates;
    renderCandidates(!candidates.length);
    const recovery = !candidates.length && recoveryMessage(lookup.status);
    const plausible = Recognition.hasPlausibleCandidate(candidates);
    setRecState(
      candidates.length || recovery ? 'warn' : 'bad',
      candidates.length
        ? plausible ? 'Treffer gefunden' : 'Keine eindeutige Karte gefunden'
        : recovery ? 'Kartendienst nicht erreichbar' : 'Keine Treffer',
      candidates.length
        ? plausible
          ? 'Bitte Bilder und Kartendaten vergleichen und die passende Karte wählen.'
          : 'Die Varianten weichen in wichtigen Merkmalen ab. Versuche zusätzliche Set- oder Nummernangaben.'
        : recovery || 'Versuche Name, Setcode oder Kartennummer anders einzugeben.'
    );
  } catch (error) {
    $('#manualDetails').open = true;
    setRecState(
      'warn',
      'Suche vorübergehend nicht möglich',
      (error.message || 'Unbekannter Fehler.') + ' Du kannst Name, Set und Nummer weiterhin manuell eintragen.'
    );
  }
};

function regionScore(data, width, height, x0, y0, x1, y1) {
  let luminance = 0;
  let luminanceSquared = 0;
  let difference = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(width / 220));
  for (let y = Math.floor(height * y0); y < Math.floor(height * y1); y += step) {
    for (let x = Math.floor(width * x0); x < Math.floor(width * x1); x += step) {
      const pixel = (y * width + x) * 4;
      const value = 0.2126 * data[pixel] + 0.7152 * data[pixel + 1] + 0.0722 * data[pixel + 2];
      luminance += value;
      luminanceSquared += value * value;
      count++;
      if (x + step < width) {
        const next = (y * width + x + step) * 4;
        const nextValue = 0.2126 * data[next] + 0.7152 * data[next + 1] + 0.0722 * data[next + 2];
        difference += Math.abs(value - nextValue);
      }
    }
  }
  const mean = luminance / Math.max(count, 1);
  const contrast = Math.sqrt(Math.max(0, luminanceSquared / Math.max(count, 1) - mean * mean));
  return {mean, contrast, difference: difference / Math.max(count, 1)};
}

async function analyzeSide(file, rotation = 0) {
  if (!file) return null;
  const dataUrl = await canonicalDataUrl(file, 0.9, rotation);
  const image = await new Promise((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = reject;
    value.src = dataUrl;
  });
  const canvas = $('#work');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  canvas.width = 504;
  canvas.height = 704;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const full = regionScore(data, canvas.width, canvas.height, 0, 0, 1, 1);
  const edge = regionScore(data, canvas.width, canvas.height, 0, 0.04, 1, 0.96);
  const corners = [
    regionScore(data, canvas.width, canvas.height, 0, 0, 0.14, 0.14),
    regionScore(data, canvas.width, canvas.height, 0.86, 0, 1, 0.14),
    regionScore(data, canvas.width, canvas.height, 0, 0.86, 0.14, 1),
    regionScore(data, canvas.width, canvas.height, 0.86, 0.86, 1, 1)
  ];
  const exposure = 100 - clamp(Math.abs(full.mean - 132) * 0.42, 0, 36);
  const sharpness = clamp(58 + full.difference * 0.95, 55, 98);
  const contrast = clamp(65 + full.contrast * 0.45, 58, 98);
  const surface = clamp(exposure * 0.32 + sharpness * 0.40 + contrast * 0.28, 55, 98);
  const cornerConsistency = 100 - clamp(
    Math.max(...corners.map(item => item.mean)) - Math.min(...corners.map(item => item.mean)),
    0,
    28
  );
  const cornerScore = clamp(surface * 0.72 + cornerConsistency * 0.28, 55, 98);
  const edgeScore = clamp(surface * 0.76 + clamp(62 + edge.contrast * 0.48, 55, 98) * 0.24, 55, 98);
  return {
    centering: Math.round(clamp(86 + contrast * 0.07, 70, 96)),
    corners: Math.round(cornerScore),
    edges: Math.round(edgeScore),
    surface: Math.round(surface),
    quality: Math.round((exposure + sharpness + contrast) / 3),
    preview: dataUrl
  };
}

$('#analyze').onclick = async () => {
  const frontFile = $('#front').files[0];
  if (!frontFile) {
    alert('Bitte zuerst die Vorderseite aufnehmen oder auswählen.');
    return;
  }
  $('#analyze').disabled = true;
  $('#analyze').textContent = 'Analyse …';
  try {
    if (!recognition) await runRecognition(false);
    const front = await analyzeSide(frontFile, recognizedRotation);
    const back = await analyzeSide($('#back').files[0], 0);
    const values = [front.centering, front.corners, front.edges, front.surface];
    if (back) values.push(back.centering, back.corners, back.edges, back.surface);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const score = Math.round(clamp(650 + (average - 60) * 8.7, 600, 970));
    const grade = score >= 950 ? '9.5–10 Vorprüfung'
      : score >= 900 ? '9 Mint-Bereich'
        : score >= 850 ? '8.5 NM-MT+'
          : score >= 800 ? '8 NM-MT'
            : score >= 700 ? '7 Near Mint'
              : '6 oder niedriger';
    const cardTcg = recognition && recognition.tcg || recognizedTcg || 'pokemon';
    last = {
      id: Date.now(),
      tcg: cardTcg,
      name: recognition && recognition.name || $('#name').value || 'Unbenannte Karte',
      set: recognition && recognition.set || $('#set').value,
      number: recognition && recognition.number || $('#number').value,
      rarity: recognition && recognition.rarity || '',
      price: recognition && recognition.price || null,
      lang: $('#lang').value,
      recognitionConfidence: recognition && recognition.confidence || 0,
      recognitionSource: recognition && recognition.source || '',
      score,
      grade,
      front,
      back,
      date: new Date().toISOString(),
      image: front.preview
    };
    renderResult(last);
  } finally {
    $('#analyze').disabled = false;
    $('#analyze').textContent = 'Vorgrading starten';
  }
};

function metrics(side, labelText) {
  if (!side) return '';
  return `<div class="metric"><b>${labelText} Centering</b><br>${side.centering}/100</div>
    <div class="metric"><b>${labelText} Ecken</b><br>${side.corners}/100</div>
    <div class="metric"><b>${labelText} Kanten</b><br>${side.edges}/100</div>
    <div class="metric"><b>${labelText} Oberfläche</b><br>${side.surface}/100</div>`;
}

function renderResult(result) {
  const price = result.price ? `<br><small>Preisindikator: ca. ${esc(result.price.label)}</small>` : '';
  const recognized = result.recognitionConfidence
    ? `<div class="recognition-note"><b>Erkannt:</b> ${esc(result.name)}${result.set ? ' · ' + esc(result.set) : ''}${result.number ? ' · ' + esc(result.number) : ''}<br><small>${Math.round(result.recognitionConfidence * 100)} % · ${esc(result.recognitionSource)}</small>${price}</div>`
    : '<div class="recognition-note warn"><b>Karte nicht sicher identifiziert.</b><br><small>Der Score ist nur eine grobe Zustands-Vorprüfung. Nutze „Manuell suchen“, bevor du sie speicherst.</small></div>';
  $('#result').innerHTML = `<div class="result">
    <div class="score">${result.score}<small>/1000</small></div>
    <h2>${result.grade}</h2>
    <p>${label(result.tcg)} · ${esc(result.name)}</p>
    ${recognized}
    <div class="grid">${metrics(result.front, 'Front')}${metrics(result.back, 'Back')}</div>
    <div class="warning"><b>Echtheit:</b> Nicht eindeutig<br><small>Ohne geprüfte sprach- und setspezifische Referenz wird die Karte nicht als Fake markiert.</small></div>
    <div class="decision"><button class="primary" onclick="saveCard()">Zur Sammlung</button><button class="secondary" onclick="discard()">Nur prüfen</button></div>
  </div>`;
}

window.saveCard = () => {
  if (!last) return;
  const collection = JSON.parse(localStorage.getItem('pf_collection') || '[]');
  collection.unshift(last);
  localStorage.setItem('pf_collection', JSON.stringify(collection));
  reset();
  alert('Zur Sammlung hinzugefügt.');
};

window.discard = () => reset();

function reset() {
  recognitionRun++;
  last = null;
  recognition = null;
  candidates = [];
  recognizedRotation = 0;
  ['front', 'back'].forEach(id => {
    const input = $('#' + id);
    input.value = '';
    input.parentElement.classList.remove('has');
    $('#' + id + 'Img').src = '';
    if (previewUrls.has(id)) URL.revokeObjectURL(previewUrls.get(id));
    previewUrls.delete(id);
  });
  ['name', 'set', 'number'].forEach(id => $('#' + id).value = '');
  $('#result').innerHTML = '';
  $('#comparisonScanImg').removeAttribute('src');
  renderCandidates(false);
  setRecState(
    'neutral',
    'Noch kein Scan',
    'Nach der Vorderseitenaufnahme werden Name, Set und Kartennummer automatisch gesucht.'
  );
}

function renderCollection() {
  const collection = JSON.parse(localStorage.getItem('pf_collection') || '[]')
    .filter(card => filter === 'all' || card.tcg === filter);
  const box = $('#collectionList');
  box.innerHTML = collection.length ? collection.map(card => {
    const price = card.price ? `<div>Preisindikator: ca. ${esc(card.price.label)}</div>` : '';
    return `<div class="item">
      <img src="${card.image}">
      <div>
        <small>${label(card.tcg)}</small>
        <h3>${esc(card.name)}</h3>
        <div>${esc(card.set || '')} ${esc(card.number || '')}</div>
        ${price}
        <b>${card.score}/1000 · ${esc(card.grade)}</b>
        <button class="danger" style="margin-top:8px" onclick="delCard(${card.id})">Löschen</button>
      </div>
    </div>`;
  }).join('') : '<div class="card muted">Noch keine Karten gespeichert.</div>';
}

window.delCard = id => {
  let collection = JSON.parse(localStorage.getItem('pf_collection') || '[]');
  collection = collection.filter(card => card.id !== id);
  localStorage.setItem('pf_collection', JSON.stringify(collection));
  renderCollection();
};
