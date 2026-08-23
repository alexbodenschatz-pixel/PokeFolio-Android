'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const Recognition = window.PokeRecognition;

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
      pending.reject(new Error('HTTP ' + (response.status || '') + ' ' + (response.error || '')));
      return;
    }
    try {
      pending.resolve(JSON.parse(response.body));
    } catch (error) {
      pending.reject(new Error('Die Kartendatenbank hat ungültige Daten geliefert.'));
    }
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

function nativeGet(url) {
  return new Promise((resolve, reject) => {
    if (window.PokeNative && PokeNative.httpGet) {
      const requestId = 'http' + requestSequence++;
      const timeout = setTimeout(() => {
        pendingHttp.delete(requestId);
        reject(new Error('Die Kartendatenbank antwortet nicht.'));
      }, 22000);
      pendingHttp.set(requestId, {resolve, reject, timeout});
      PokeNative.httpGet(url, requestId);
      return;
    }
    fetch(url).then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(resolve, reject);
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
    source: 'Pokémon TCG API',
    price: Number.isFinite(Number(eurPrice))
      ? {value: Number(eurPrice), currency: 'EUR', label: Number(eurPrice).toFixed(2).replace('.', ',') + ' €'}
      : Number.isFinite(Number(usdPrice))
        ? {value: Number(usdPrice), currency: 'USD', label: '$' + Number(usdPrice).toFixed(2)}
        : null
  };
}

async function pokemonSearch(hints, manual = '') {
  const queries = [];
  (hints.collectorNumbers || []).slice(0, 2).forEach(item => {
    const rawValue = String(item.number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const normalizedValue = Recognition.numberKey(rawValue);
    if (rawValue) queries.push('number:' + rawValue);
    if (normalizedValue && normalizedValue !== rawValue) queries.push('number:' + normalizedValue);
  });
  const names = manual
    ? [{value: manual}]
    : (hints.nameHints || []).slice(0, 2);
  names.forEach(item => {
    const value = String(item.value || '').replace(/["\\]/g, '').trim();
    if (value && /[A-Za-zÀ-ÿ]/.test(value)) queries.push('name:"' + value + '"');
  });
  if (!queries.length) return [];

  const uniqueQueries = [...new Set(queries)].slice(0, 4);
  const responses = await Promise.allSettled(uniqueQueries.map(query => nativeGet(
    'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(query) + '&pageSize=100'
  )));
  const byId = new Map();
  let lastError = null;
  responses.forEach(response => {
    if (response.status === 'fulfilled') {
      (response.value.data || []).forEach(card => byId.set(card.id, pokemonCardFromApi(card)));
    } else {
      lastError = response.reason;
    }
  });

  if (!byId.size && names.length) {
    const longestWord = String(names[0].value || '')
      .split(/\s+/)
      .sort((a, b) => b.length - a.length)[0];
    if (longestWord && longestWord.length > 3) {
      try {
        const fallback = await nativeGet(
          'https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent('name:*' + longestWord + '*') + '&pageSize=60'
        );
        (fallback.data || []).forEach(card => byId.set(card.id, pokemonCardFromApi(card)));
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (!byId.size && lastError) throw lastError;
  return Recognition.rankPokemonCandidates([...byId.values()], hints, manual);
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
  return {
    tcg: 'onepiece',
    id: card.card_id || card.id || id,
    name: card.card_name || card.name || 'One Piece Karte',
    number: card.card_id || card.card_number || id,
    set: card.set_name || card.set || '',
    rarity: card.rarity || card.card_rarity || '',
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

function lookupCandidates(kind, hints, manual = '') {
  if (kind === 'pokemon') return pokemonSearch(hints, manual);
  if (kind === 'yugioh') return yugiohSearch(hints, manual);
  if (kind === 'onepiece') return onePieceSearch(hints, manual);
  return Promise.resolve([]);
}

function renderCandidates() {
  const box = $('#candidateList');
  if (!candidates.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = candidates.map((candidate, index) => {
    const evidence = (candidate.evidence || []).length
      ? '<div class="candidate-evidence">Abgleich: ' + esc(candidate.evidence.join(', ')) + '</div>'
      : '';
    const price = candidate.price ? ' · ca. ' + esc(candidate.price.label) : '';
    return `<div class="candidate">
      <div>
        <b>${esc(candidate.name)}</b>
        <small>${esc(candidate.set || '')} ${esc(candidate.number || '')}${candidate.rarity ? ' · ' + esc(candidate.rarity) : ''}${price}</small>
        <div class="candidate-confidence">Treffer ${Math.round((candidate.confidence || 0) * 100)} % · ${esc(candidate.source)}</div>
        ${evidence}
      </div>
      <button aria-label="${esc(candidate.name)} übernehmen" onclick="applyCandidate(${index})">Übernehmen</button>
    </div>`;
  }).join('');
}

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
  renderCandidates();
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
  $('#candidateList').innerHTML = '';
  try {
    const dataUrl = await ocrDataUrl(file);
    const ocrResult = await nativeOcr(dataUrl, $('#lang').value);
    if (run !== recognitionRun) return null;
    recognizedRotation = chooseRecognitionRotation(ocrResult);
    const hints = Recognition.extractHints(ocrResult);
    const kind = Recognition.classifyTcg(hints, manual ? selectedTcg : selectedTcg);
    recognizedTcg = kind;
    candidates = await lookupCandidates(kind, hints, '');
    if (run !== recognitionRun) return null;
    renderCandidates();

    if (!candidates.length) {
      recognition = null;
      const hint = hints.nameHint
        || hints.onepieceId
        || hints.yugiohSetCode
        || (hints.collectorNumbers[0] && `${hints.collectorNumbers[0].number}/${hints.collectorNumbers[0].total}`)
        || 'keine eindeutigen Merkmale';
      setRecState(
        'warn',
        'Nicht eindeutig',
        `Gelesen: ${hint}. Bitte TCG auswählen oder Name bzw. Kartencode manuell suchen.`
      );
      return null;
    }

    const best = candidates[0];
    if (Recognition.isConfident(candidates)) {
      applyCandidate(0);
      return best;
    }
    recognition = null;
    setRecState(
      'warn',
      'Bitte auswählen',
      `${candidates.length} mögliche Treffer aus Name, Kartennummer, Set und weiteren Merkmalen gefunden.`
    );
    return best;
  } catch (error) {
    if (run !== recognitionRun) return null;
    recognition = null;
    candidates = [];
    renderCandidates();
    setRecState('bad', 'Erkennung fehlgeschlagen', error.message || 'Unbekannter Fehler.');
    return null;
  }
}

$('#recognize').onclick = () => runRecognition(false);

$('#manualSearch').onclick = async () => {
  const query = $('#manualQuery').value.trim();
  if (!query) return;
  const kind = selectedTcg === 'auto' ? recognizedTcg : selectedTcg;
  setRecState('busy', 'Suche …', 'Manuelle Kartensuche läuft.');
  try {
    const hints = Recognition.extractHints(query);
    if (kind === 'onepiece') {
      const match = query.toUpperCase().match(/\b(?:OP|ST|EB|PRB|EX|DON)\d{2}-\d{3}\b/);
      if (match) hints.onepieceId = match[0];
    }
    candidates = await lookupCandidates(kind, hints, query);
    renderCandidates();
    setRecState(
      candidates.length ? 'warn' : 'bad',
      candidates.length ? 'Treffer gefunden' : 'Keine Treffer',
      candidates.length
        ? 'Bitte die passende Karte übernehmen.'
        : 'Versuche Name, Setcode oder Kartennummer anders einzugeben.'
    );
  } catch (error) {
    setRecState('bad', 'Suche fehlgeschlagen', error.message || 'Unbekannter Fehler.');
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
  $('#candidateList').innerHTML = '';
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
