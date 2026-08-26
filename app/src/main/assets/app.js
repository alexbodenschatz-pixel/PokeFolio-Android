'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const Recognition = window.PokeRecognition;
const Api = window.PokeApi;
const Collection = window.PokeCollection;
const Learning = window.PokeLearning;

let selectedTcg = 'auto';
let recognizedTcg = 'pokemon';
let scanMode = 'single';
let bulkSelectedTcg = 'auto';
let collectionFilters = {
  quantity: 'all', tcg: 'all', language: 'all', set: 'all', cardType: 'all',
  variant: 'all', graded: 'all', favorite: 'all', query: '', minValue: '', maxValue: ''
};
let collectionViewMode = localStorage.getItem('pf_collection_view') || 'grid';
let collectionSort = localStorage.getItem('pf_collection_sort') || 'newest';
let collectionVisibleLimit = 90;
let last = null;
let recognition = null;
let candidates = [];
let bulkCandidates = [];
let bulkHints = null;
let bulkSourceDataUrl = '';
let bulkPreviewUrl = '';
let bulkScanLock = Collection.createScanLock(1000);
let bulkSession = {active: false, scanned: 0, newCards: 0, duplicates: 0};
let recognitionTimer = null;
let recognitionRun = 0;
let recognizedRotation = 0;
let requestSequence = 1;
let pendingBulkScanner = null;
let learningState = loadLearningState();
let learningScan = null;
let bulkLearningScan = null;
const pendingOcr = new Map();
const pendingHttp = new Map();
const pendingVisual = new Map();
const pendingPreparation = new Map();
const previewUrls = new Map();
const normalizedCaptureMetadata = new Map();

/** The native normalized card is authoritative after detection; CSS must only contain it. */
function displayNormalizedCard(id, prepared) {
  if (!prepared || !prepared.dataUrl) return;
  const previous = previewUrls.get(id);
  if (previous && previous.startsWith('blob:')) URL.revokeObjectURL(previous);
  previewUrls.set(id, prepared.dataUrl);
  const image = $('#' + id + 'Img');
  if (image) image.src = prepared.dataUrl;
  if (id === 'front') $('#comparisonScanImg').src = prepared.dataUrl;
  console.debug('[PokeFolio Crop] method=' + (prepared.method || 'unknown')
    + ' confidence=' + Math.round((Number(prepared.confidence) || 0) * 100) + '%'
    + ' coverage=' + Math.round((Number(prepared.cardCoverage) || 0) * 100) + '%'
    + ' fallback=' + Boolean(prepared.fallbackUsed)
    + ' final=' + (prepared.width || '?') + 'x' + (prepared.height || '?'));
}

$$('nav button').forEach(button => {
  button.onclick = () => {
    $$('nav button').forEach(item => item.classList.remove('active'));
    $$('.page').forEach(page => page.classList.remove('active'));
    button.classList.add('active');
    $('#' + button.dataset.page).classList.add('active');
    if (button.dataset.page === 'collection') renderCollection();
    if (button.dataset.page === 'settings') renderLearningSettings();
  };
});

$$('.single-tcgs button').forEach(button => {
  button.onclick = () => {
    selectedTcg = button.dataset.tcg;
    $$('.single-tcgs button').forEach(item => item.classList.toggle('active', item === button));
    if ($('#front').files[0]) scheduleRecognition(120);
  };
});

$$('.scan-modes button').forEach(button => {
  button.onclick = () => {
    setScanMode(button.dataset.scanMode);
  };
});

$$('.bulk-tcgs button').forEach(button => {
  button.onclick = () => {
    bulkSelectedTcg = button.dataset.bulkTcg;
    $$('.bulk-tcgs button').forEach(item => item.classList.toggle('active', item === button));
  };
});

$$('.quantity-filters button').forEach(button => {
  button.onclick = () => {
    $$('.quantity-filters button').forEach(item => item.classList.toggle('active', item === button));
    collectionFilters.quantity = button.dataset.quantityFilter;
    collectionVisibleLimit = 90;
    renderCollection();
  };
});

const collectionSelectBindings = {
  collectionTcgFilter: 'tcg',
  collectionLanguageFilter: 'language',
  collectionSetFilter: 'set',
  collectionCardTypeFilter: 'cardType',
  collectionVariantFilter: 'variant',
  collectionGradedFilter: 'graded',
  collectionFavoriteFilter: 'favorite'
};
Object.entries(collectionSelectBindings).forEach(([id, key]) => {
  $('#' + id).onchange = event => {
    collectionFilters[key] = event.target.value;
    if (key === 'tcg') {
      $$('.collection-tcg-chips button').forEach(button => {
        button.classList.toggle('active', button.dataset.collectionTcg === event.target.value);
      });
    }
    collectionVisibleLimit = 90;
    renderCollection();
  };
});

$$('.collection-tcg-chips button').forEach(button => {
  button.onclick = () => {
    collectionFilters.tcg = button.dataset.collectionTcg;
    $('#collectionTcgFilter').value = collectionFilters.tcg;
    $$('.collection-tcg-chips button').forEach(item => item.classList.toggle('active', item === button));
    collectionVisibleLimit = 90;
    renderCollection();
  };
});

let collectionSearchTimer = null;
$('#collectionSearch').oninput = event => {
  clearTimeout(collectionSearchTimer);
  collectionSearchTimer = setTimeout(() => {
    collectionFilters.query = event.target.value;
    collectionVisibleLimit = 90;
    renderCollection();
  }, 90);
};
['collectionMinValue', 'collectionMaxValue'].forEach(id => {
  $('#' + id).oninput = event => {
    const value = String(event.target.value || '').replace(',', '.');
    collectionFilters[id === 'collectionMinValue' ? 'minValue' : 'maxValue'] = value;
    collectionVisibleLimit = 90;
    renderCollection();
  };
});
$('#collectionSort').onchange = event => {
  collectionSort = event.target.value;
  localStorage.setItem('pf_collection_sort', collectionSort);
  collectionVisibleLimit = 90;
  renderCollection();
};
$$('.collection-view-switch button').forEach(button => {
  button.onclick = () => {
    collectionViewMode = button.dataset.collectionView;
    localStorage.setItem('pf_collection_view', collectionViewMode);
    collectionVisibleLimit = 90;
    renderCollection();
  };
});
$('#collectionLoadMore').onclick = () => {
  collectionVisibleLimit += 90;
  renderCollection();
};

$('#lang').onchange = () => {
  if ($('#front').files[0]) scheduleRecognition(120);
};

function bindPhoto(id) {
  const input = $('#' + id);
  const image = $('#' + id + 'Img');
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const captureMetadata = consumeNativeCaptureMetadata();
    if (captureMetadata && captureMetadata.normalized) normalizedCaptureMetadata.set(id, captureMetadata);
    else normalizedCaptureMetadata.delete(id);
    if (previewUrls.has(id)) URL.revokeObjectURL(previewUrls.get(id));
    const previewUrl = URL.createObjectURL(file);
    previewUrls.set(id, previewUrl);
    image.src = previewUrl;
    input.parentElement.classList.add('has');
    if (id === 'front') {
      recognition = null;
      candidates = [];
      recognizedRotation = 0;
      renderRecognitionFeatures(null);
      $('#comparisonScanImg').src = previewUrl;
      renderCandidates(false);
      scheduleRecognition(180);
    }
  };
}

function consumeNativeCaptureMetadata() {
  if (!window.PokeNative || !PokeNative.consumeCaptureMetadata) return null;
  try {
    const json = PokeNative.consumeCaptureMetadata();
    return json ? JSON.parse(json) : null;
  } catch (error) {
    console.warn('[PokeFolio Crop] Aufnahmemetadaten konnten nicht gelesen werden: ' + error.message);
    return null;
  }
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

function renderRecognitionFeatures(hints) {
  const details = $('#recognitionFeatures');
  const list = $('#recognitionFeatureList');
  if (!hints) {
    details.hidden = true;
    list.innerHTML = '';
    return;
  }
  const identity = hints.pokemonIdentity || {};
  const collector = hints.collectorNumbers && hints.collectorNumbers[0];
  const setCode = hints.pokemonSetCodes && hints.pokemonSetCodes[0];
  const confidence = Number(identity.nameConfidence);
  const titleConfidence = Number(hints.titleConfidence);
  const cardTypeLabel = ({pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energie', unknown: 'Unbekannt'})[
    hints.cardType || 'unknown'
  ];
  const rows = [
    ['Kartentyp', cardTypeLabel],
    ['Haupttitel', hints.mainTitle || identity.baseName || 'nicht zuverlässig erkannt'],
    ['Ignorierte Zusatznamen', (hints.ignoredAdditionalNames || []).join(', ') || 'keine'],
    ['Pokémon-Name', identity.baseName || 'nicht erkannt'],
    ['Variante', identity.variant || 'nicht erkannt'],
    ['KP/HP', identity.hp || hints.hp || 'nicht erkannt'],
    ['Collector Number', collector
      ? [collector.number, collector.total].filter(Boolean).join('/')
      : 'nicht erkannt'],
    ['Set', setCode && setCode.value || 'nicht erkannt'],
    ['Attacken', (hints.attackHints || []).slice(0, 3).map(item => item.value).join(', ') || 'nicht erkannt'],
    ['Schadenswerte', (hints.damageValues || []).slice(0, 4).map(item => item.value).join(', ') || 'nicht erkannt'],
    ['Regeltext', (hints.ruleTextHints || []).slice(0, 2).map(item => item.value).join(' / ') || 'nicht erkannt'],
    ['Kartensprache', hints.language ? languageLabel(hints.language) : 'nicht sicher erkannt'],
    ['OCR-Sicherheit Titel', Number.isFinite(titleConfidence) ? Math.round(titleConfidence * 100) + ' %' : '0 %'],
    ['OCR-Sicherheit Name', Number.isFinite(confidence) ? Math.round(confidence * 100) + ' %' : '0 %'],
    ['Namensquelle', identity.source || 'keine validierte Pokémon-Kopfzeile'],
    ['Titelquelle', hints.titleSource || identity.source || 'keine validierte Kopfzeile']
  ];
  list.innerHTML = rows.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join('');
  details.hidden = false;
}

function debugRecognitionFeatures(hints) {
  const collector = hints && hints.collectorNumbers && hints.collectorNumbers[0];
  const setCode = hints && hints.pokemonSetCodes && hints.pokemonSetCodes[0];
  console.debug('[PokeFolio Recognition] Stufe=Merkmale'
    + ` Kartentyp=${hints && hints.cardType || 'unknown'}`
    + ` Haupttitel=${hints && hints.mainTitle || '<nicht erkannt>'}`
    + ` IgnorierteZusatznamen=${(hints && hints.ignoredAdditionalNames || []).join('|') || '<keine>'}`
    + ` Kartennummer=${collector ? [collector.number, collector.total].filter(Boolean).join('/') : '<nicht erkannt>'}`
    + ` Set=${setCode && setCode.value || '<nicht erkannt>'}`
    + ` Sprache=${hints && hints.language || '<unsicher>'}`
    + ` Titelsicherheit=${Math.round((Number(hints && hints.titleConfidence) || 0) * 100)}%`);
}

function debugRecognitionCandidates(stage, candidatesToLog) {
  const decision = Recognition.confidenceDecision(candidatesToLog || []);
  (candidatesToLog || []).slice(0, 12).forEach((candidate, index) => {
    const details = candidate.matchDetails || {};
    console.debug('[PokeFolio Recognition] Stufe=' + stage
      + ` Rang=${index + 1} Kandidat=${candidate.name || '<ohne Titel>'}`
      + ` Nummer=${candidate.number || '<keine>'}`
      + ` Set=${candidate.set || '<unbekannt>'}`
      + ` Gesamt=${Math.round((Number(candidate.confidence) || 0) * 100)}%`
      + ` Identifikation=${Math.round((Number(candidate.identificationScore) || 0) * 100)}%`
      + ` VarianteVisuell=${Number.isFinite(Number(candidate.visualVariantScore)) ? Math.round(Number(candidate.visualVariantScore) * 100) + '%' : 'unknown'}`
      + ` Datensicherheit=${Math.round((Number(candidate.dataConfidence) || 0) * 100)}%`
      + ` Abstand=${Math.round((Number(decision.margin) || 0) * 100)}%`
      + ` Entscheidung=${decision.status}`
      + ` Typ=${details.cardType || 'unknown'}`
      + ` Titel=${Math.round((Number(details.title != null ? details.title : details.name) || 0) * 100)}%`
      + ` NummerScore=${details.collector || 'unknown'}`
      + ` SetScore=${details.set || 'unknown'}`
      + ` Sprache=${details.language || 'unknown'}`
      + ` Regeltext=${details.rules || 'unknown'}`
      + ` Artwork=${Number.isFinite(Number(details.artwork)) ? Math.round(Number(details.artwork) * 100) + '%' : 'unknown'}`);
  });
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

function activeRecognitionLanguage() {
  return scanMode === 'bulk' ? $('#bulkLang').value : $('#lang').value;
}

function loadCollection() {
  let raw = [];
  try {
    raw = JSON.parse(localStorage.getItem('pf_collection') || '[]');
  } catch (error) {
    console.error('[PokeFolio Collection] Migration konnte Altbestand nicht lesen:', error.message);
  }
  const migrated = Collection.migrateCollection(raw);
  const storedSchema = Number(localStorage.getItem('pf_collection_schema') || 0);
  if (migrated.changed || storedSchema !== Collection.SCHEMA_VERSION) {
    localStorage.setItem('pf_collection', JSON.stringify(migrated.collection));
    localStorage.setItem('pf_collection_schema', String(Collection.SCHEMA_VERSION));
    console.debug('[PokeFolio Collection] Migration Schema=' + Collection.SCHEMA_VERSION
      + ' Einträge=' + migrated.collection.length + ' Zusammengeführt=' + migrated.mergedCount);
  }
  return migrated.collection;
}

function persistCollection(collection) {
  localStorage.setItem('pf_collection', JSON.stringify(collection));
  localStorage.setItem('pf_collection_schema', String(Collection.SCHEMA_VERSION));
}

function loadLearningState() {
  try {
    const raw = JSON.parse(localStorage.getItem('pf_learning_state') || 'null');
    return Learning.migrateState(raw);
  } catch (error) {
    console.warn('[PokeFolio Learning] Lernspeicher konnte nicht gelesen werden: ' + error.message);
    return Learning.createState();
  }
}

function persistLearningState(state) {
  learningState = Learning.migrateState(state);
  try {
    localStorage.setItem('pf_learning_state', JSON.stringify(learningState));
    localStorage.setItem('pf_learning_schema', String(Learning.SCHEMA_VERSION));
  } catch (error) {
    console.error('[PokeFolio Learning] Lokaler Lernspeicher voll: ' + error.message);
  }
  renderLearningSettings();
}

function formatLearningBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  return Math.max(1, Math.round(value / 1024)) + ' KB';
}

function renderLearningSettings() {
  if (!$('#learningEnabled')) return;
  const stats = Learning.statistics(learningState);
  $('#learningConfirmed').textContent = String(stats.confirmed);
  $('#learningCorrected').textContent = String(stats.corrected);
  $('#learningCards').textContent = String(stats.learnedCards);
  $('#learningReferences').textContent = String(stats.references);
  $('#learningStorage').textContent = formatLearningBytes(stats.storageBytes);
  $('#learningEnabled').checked = learningState.config.learnFromConfirmed !== false;
  $('#learningUseReferences').checked = learningState.config.useLearnedReferences !== false;
  const active = learningState.config.learnFromConfirmed !== false;
  $('#learningStatus').className = 'status ' + (active ? 'good' : 'neutral');
  $('#learningStatus').textContent = active ? 'Lokales Lernen aktiv' : 'Neues Lernen deaktiviert';
}

function renderLearnedData() {
  const panel = $('#learningDataPanel');
  const references = learningState.references.slice().sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  ).slice(0, 60);
  panel.innerHTML = references.length
    ? `<div class="learning-reference-list">${references.map(reference => `<article>
        <b>${esc(reference.cardName || reference.cardIdentity && reference.cardIdentity.name || 'Unbekannte Karte')}</b>
        <span>${esc(reference.setId || 'Set unbekannt')} · ${esc(reference.cardNumber || 'Nummer unbekannt')} · ${esc(languageLabel(reference.language))}</span>
        <small>${esc(reference.confirmationType === 'USER_CORRECTED' ? 'Nutzerkorrektur' : 'Bestätigt')} · Qualität ${Math.round((reference.qualityScore || 0) * 100)} %</small>
      </article>`).join('')}</div>`
    : '<p class="muted">Noch keine bestätigten lokalen Kartenreferenzen vorhanden.</p>';
}

function renderLearningStatistics() {
  const panel = $('#learningStatsPanel');
  const stats = Learning.statistics(learningState);
  const adaptive = Object.entries(learningState.adaptiveSignals || {}).map(([name, signal]) =>
    `<div><span>${esc(({number: 'Kartennummer', set: 'Set', name: 'Name', artwork: 'Artwork', ocr: 'OCR', language: 'Sprache', variant: 'Variante'})[name] || name)}</span><b>${Math.round((signal.multiplier || 1) * 100)} %</b><small>${Number(signal.samples) || 0} Lernereignisse</small></div>`
  ).join('');
  panel.innerHTML = `<p>${stats.confirmed} Bestätigungen · ${stats.corrected} Korrekturen · ${stats.rejected} Ablehnungen</p>
    <div class="learning-weights">${adaptive}</div>
    <small class="muted">Adaptive Faktoren bleiben immer zwischen 92 % und 108 % und ergänzen nur die unveränderten Basisregeln.</small>`;
}

$('#learningEnabled').onchange = event => {
  learningState.config.learnFromConfirmed = Boolean(event.target.checked);
  persistLearningState(learningState);
};
$('#learningUseReferences').onchange = event => {
  learningState.config.useLearnedReferences = Boolean(event.target.checked);
  persistLearningState(learningState);
};
$('#learningShowData').onclick = () => {
  const panel = $('#learningDataPanel');
  panel.hidden = !panel.hidden;
  $('#learningStatsPanel').hidden = true;
  if (!panel.hidden) renderLearnedData();
};
$('#learningShowStats').onclick = () => {
  const panel = $('#learningStatsPanel');
  panel.hidden = !panel.hidden;
  $('#learningDataPanel').hidden = true;
  if (!panel.hidden) renderLearningStatistics();
};
$('#learningReset').onclick = () => {
  if (!confirm('Wirklich nur das lokale Lernwissen zurücksetzen? Sammlung, Stückzahlen, Preise und Pregrades bleiben erhalten.')) return;
  const config = {...learningState.config};
  learningState = Learning.createState();
  learningState.config = {...learningState.config, ...config};
  persistLearningState(learningState);
  $('#learningDataPanel').hidden = true;
  $('#learningStatsPanel').hidden = true;
  alert('Lokales Lernwissen wurde zurückgesetzt. Deine Sammlung ist unverändert.');
};

function setScanMode(mode) {
  scanMode = mode === 'bulk' ? 'bulk' : 'single';
  $$('.scan-modes button').forEach(button => {
    const active = button.dataset.scanMode === scanMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#singleScanPanel').hidden = scanMode !== 'single';
  $('#bulkScanPanel').hidden = scanMode !== 'bulk';
  if (scanMode === 'bulk') {
    startBulkSession();
    setBulkStatus('ready', 'Bereit zum Scannen', 'Vorderseite vollständig in den Kartenrahmen halten.');
  } else {
    recognitionRun++;
  }
}

function startBulkSession() {
  if (!bulkSession.active) bulkSession = {active: true, scanned: 0, newCards: 0, duplicates: 0};
  renderBulkSession();
}

function renderBulkSession() {
  $('#bulkScanned').textContent = String(bulkSession.scanned);
  $('#bulkNew').textContent = String(bulkSession.newCards);
  $('#bulkDuplicates').textContent = String(bulkSession.duplicates);
}

function setBulkStatus(kind, title, text) {
  $('#bulkStatusDot').className = 'bulk-status-dot ' + kind;
  $('#bulkStatusTitle').textContent = title;
  $('#bulkStatusText').textContent = text || '';
}

function showBulkFeedback(title, detail, warn = false) {
  const box = $('#bulkFeedback');
  box.className = 'bulk-feedback' + (warn ? ' warn' : '');
  box.innerHTML = `<b>${esc(title)}</b><span>${esc(detail || '')}</span>`;
  box.hidden = false;
  clearTimeout(showBulkFeedback.timer);
  showBulkFeedback.timer = setTimeout(() => { box.hidden = true; }, 1800);
}

async function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    // Android's system media picker can expose a readable blob URL while
    // FileReader.readAsDataURL fails for the same scoped content URI.
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(source);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error('Das Bildformat wird nicht unterstützt.'));
    };
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

function learningImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Normalisierter Karten-Crop konnte nicht gelesen werden.'));
    image.src = dataUrl;
  });
}

function grayAt(data, width, x, y) {
  const index = (y * width + x) * 4;
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function differenceHash(data, width, height, yStart = 0, yEnd = 1) {
  let bits = '';
  for (let row = 0; row < 8; row++) {
    const y = Math.min(height - 1, Math.floor(height * (yStart + (row + 0.5) / 8 * (yEnd - yStart))));
    for (let column = 0; column < 8; column++) {
      const left = Math.min(width - 1, Math.floor((column + 0.25) * width / 9));
      const right = Math.min(width - 1, Math.floor((column + 1.25) * width / 9));
      bits += grayAt(data, width, left, y) <= grayAt(data, width, right, y) ? '1' : '0';
    }
  }
  return bits;
}

function perceptualHash(data, width, height) {
  const size = 32;
  const sample = Array.from({length: size}, (_, y) => Array.from({length: size}, (_, x) =>
    grayAt(data, width, Math.min(width - 1, Math.floor((x + 0.5) * width / size)),
      Math.min(height - 1, Math.floor((y + 0.5) * height / size)))
  ));
  const coefficients = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let value = 0;
      for (let y = 0; y < size; y++) {
        const cosineY = Math.cos((2 * y + 1) * v * Math.PI / (2 * size));
        for (let x = 0; x < size; x++) {
          value += sample[y][x] * Math.cos((2 * x + 1) * u * Math.PI / (2 * size)) * cosineY;
        }
      }
      coefficients.push(value);
    }
  }
  const threshold = median(coefficients.slice(1));
  return coefficients.map((value, index) => index && value >= threshold ? '1' : '0').join('');
}

async function createLearningFingerprint(dataUrl, preparation) {
  const image = await learningImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 88;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const histogram = new Array(16).fill(0);
  const layout = [];
  let sum = 0;
  let squared = 0;
  let gradient = 0;
  let clipped = 0;
  let samples = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const value = grayAt(pixels, canvas.width, x, y);
      histogram[Math.min(15, Math.floor(value / 16))]++;
      sum += value;
      squared += value * value;
      if (value >= 247 || value <= 8) clipped++;
      if (x) gradient += Math.abs(value - grayAt(pixels, canvas.width, x - 1, y));
      if (y) gradient += Math.abs(value - grayAt(pixels, canvas.width, x, y - 1));
      samples++;
    }
  }
  for (let row = 0; row < 6; row++) {
    for (let column = 0; column < 4; column++) {
      let region = 0;
      let count = 0;
      const y0 = Math.floor(row * canvas.height / 6);
      const y1 = Math.floor((row + 1) * canvas.height / 6);
      const x0 = Math.floor(column * canvas.width / 4);
      const x1 = Math.floor((column + 1) * canvas.width / 4);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        region += grayAt(pixels, canvas.width, x, y);
        count++;
      }
      layout.push(clamp(region / Math.max(1, count) / 255, 0, 1));
    }
  }
  const mean = sum / Math.max(1, samples);
  const contrastValue = Math.sqrt(Math.max(0, squared / Math.max(1, samples) - mean * mean));
  const exposure = clamp(1 - Math.abs(mean - 132) / 150, 0, 1);
  const sharpness = clamp(gradient / Math.max(1, samples * 24), 0, 1);
  const contrast = clamp(contrastValue / 64, 0, 1);
  const reflection = clamp(1 - clipped / Math.max(1, samples) * 3.2, 0, 1);
  const crop = preparation && preparation.reliable !== false ? 1 : 0.58;
  const qualityScore = clamp(exposure * 0.22 + sharpness * 0.30 + contrast * 0.20
    + reflection * 0.12 + crop * 0.16, 0, 1);
  return {
    fingerprint: {
      perceptualHash: perceptualHash(pixels, canvas.width, canvas.height),
      differenceHash: differenceHash(pixels, canvas.width, canvas.height),
      artworkHash: differenceHash(pixels, canvas.width, canvas.height, 0.18, 0.60),
      histogram: histogram.map(value => value / Math.max(1, samples)),
      layout
    },
    qualityScore,
    quality: {
      sharpness: Math.round(sharpness * 100) / 100,
      brightness: Math.round(exposure * 100) / 100,
      contrast: Math.round(contrast * 100) / 100,
      reflection: Math.round(reflection * 100) / 100,
      crop: Math.round(crop * 100) / 100,
      cropMethod: preparation && preparation.method || 'fallback'
    }
  };
}

function learningContext(hints, tcg) {
  const collector = hints && hints.collectorNumbers && hints.collectorNumbers[0];
  const setCode = hints && hints.pokemonSetCodes && hints.pokemonSetCodes[0];
  return {
    tcg: tcg || 'pokemon',
    number: collector ? [collector.number, collector.total].filter(Boolean).join('/') : '',
    setId: setCode && setCode.value || '',
    language: hints && hints.language || activeRecognitionLanguage()
  };
}

function learningOcrFeatures(hints) {
  const identity = hints && hints.pokemonIdentity || {};
  const collector = hints && hints.collectorNumbers && hints.collectorNumbers[0];
  const setCode = hints && hints.pokemonSetCodes && hints.pokemonSetCodes[0];
  return {
    cardType: hints && hints.cardType || '',
    name: hints && hints.mainTitle || identity.fullName || identity.baseName || hints && hints.nameHint || '',
    number: collector ? [collector.number, collector.total].filter(Boolean).join('/') : '',
    set: setCode && setCode.value || '',
    language: hints && hints.language || activeRecognitionLanguage(),
    attacks: (hints && hints.attackHints || []).map(item => item.value),
    damages: (hints && hints.damageValues || []).map(item => item.value)
  };
}

async function buildLearningScan(prepared, hints, tcg, source) {
  let visual;
  try {
    visual = await createLearningFingerprint(prepared.dataUrl, prepared);
  } catch (error) {
    console.warn('[PokeFolio Learning] Fingerprint konnte nicht erstellt werden: ' + error.message);
    visual = {fingerprint: null, qualityScore: 0, quality: {crop: prepared.reliable === false ? 0.58 : 1}};
  }
  const context = learningContext(hints, tcg);
  const matchResult = Learning.findMatches(learningState, visual.fingerprint, context, 16);
  const scan = {
    id: source + '-' + Date.now(),
    source,
    prepared,
    hints,
    context,
    fingerprint: visual.fingerprint,
    qualityScore: visual.qualityScore,
    quality: visual.quality,
    matchResult,
    initialPrediction: null,
    rejectedIds: [],
    recorded: new Set()
  };
  debugLearningMatch(scan, null, null);
  return scan;
}

function mergeLocalOfflineCandidates(online, scan) {
  const merged = (online || []).slice();
  Learning.offlineCandidates(scan && scan.matchResult, scan && scan.context).forEach(local => {
    if (!merged.some(candidate => Learning.cardsEquivalent(candidate, local))) merged.push(local);
  });
  return merged;
}

function applyLocalLearning(candidatesToRank, scan) {
  const ranked = Learning.enrichCandidates(
    learningState,
    candidatesToRank || [],
    scan && scan.matchResult,
    scan && scan.context
  );
  if (scan && !scan.initialPrediction && ranked.length) scan.initialPrediction = {...ranked[0]};
  debugLearningMatch(scan, candidatesToRank && candidatesToRank[0], ranked[0]);
  return ranked;
}

function debugLearningMatch(scan, baseCandidate, finalCandidate) {
  if (!scan) return;
  const best = scan.matchResult && scan.matchResult.matches && scan.matchResult.matches[0];
  console.debug('[PokeFolio Learning] LEARNING_MATCH'
    + ' cardId=' + (best && Learning.cardId(best.card) || '<none>')
    + ' localReferencesChecked=' + (scan.matchResult && scan.matchResult.referencesChecked || 0)
    + ' bestLocalScore=' + Math.round((Number(best && best.score) || 0) * 100) + '%'
    + ' baseScore=' + Math.round((Number(baseCandidate && baseCandidate.confidence) || 0) * 100) + '%'
    + ' finalScore=' + Math.round((Number(finalCandidate && finalCandidate.confidence) || 0) * 100) + '%'
    + ' correctionBoost=' + Math.round((Number(finalCandidate && finalCandidate.correctionConfidence) || 0) * 100) + '%'
    + ' qualityScore=' + Math.round((Number(scan.qualityScore) || 0) * 100) + '%');
}

function learningSignalResults(candidate) {
  const details = candidate && candidate.matchDetails || {};
  return {
    number: details.collector,
    set: details.set,
    name: Number(details.name) >= 0.88 ? 'match' : Number.isFinite(Number(details.name)) ? 'mismatch' : 'unknown',
    artwork: Number(details.artwork) >= 0.72 ? 'match' : Number.isFinite(Number(details.artwork)) ? 'mismatch' : 'unknown',
    language: details.language,
    variant: details.variant,
    ocr: Number(candidate && candidate.dataConfidence) >= 0.65 ? 'match' : 'unknown'
  };
}

function logLearningOutcome(result) {
  if (!result || !result.event) return;
  const eventName = result.event.eventType === 'CORRECTED' ? 'LEARNING_CORRECTED'
    : result.event.eventType === 'REJECTED' ? 'LEARNING_REJECTED' : 'LEARNING_CONFIRMED';
  console.debug('[PokeFolio Learning] ' + eventName
    + ' predictedCardId=' + (result.event.predictedCardId || '<none>')
    + ' confirmedCardId=' + (result.event.confirmedCardId || '<none>')
    + ' confidenceBefore=' + Math.round((result.event.confidenceBefore || 0) * 100) + '%'
    + ' confidenceAfter=' + Math.round((result.event.confidenceAfter || 0) * 100) + '%');
  if (result.referenceAction === 'ADDED' || result.referenceAction === 'REPLACED_DUPLICATE') {
    console.debug('[PokeFolio Learning] LEARNING_REFERENCE_ADDED cardId='
      + (result.event.confirmedCardId || '<none>') + ' qualityScore='
      + Math.round((result.reference && result.reference.qualityScore || 0) * 100) + '%');
  } else if (result.referenceAction === 'SKIPPED_DUPLICATE') {
    console.debug('[PokeFolio Learning] LEARNING_REFERENCE_SKIPPED_DUPLICATE cardId='
      + (result.event.confirmedCardId || '<none>'));
  }
}

function recordLearningSelection(scan, confirmedCard, source) {
  if (!scan || !confirmedCard) return null;
  const predicted = scan.initialPrediction;
  const corrected = Boolean(predicted && !Learning.cardsEquivalent(predicted, confirmedCard))
    || scan.rejectedIds.some(id => String(id) === String(Learning.cardId(predicted)));
  const eventType = corrected ? 'CORRECTED' : 'CONFIRMED';
  const recordKey = eventType + '|' + Learning.cardId(confirmedCard);
  if (scan.recorded.has(recordKey)) return null;
  const result = Learning.recordOutcome(learningState, {
    eventType,
    predictedCard: predicted,
    confirmedCard,
    confidenceBefore: Number(predicted && predicted.confidence) || 0,
    confidenceAfter: Number(confirmedCard.confidence) || 0,
    source,
    fingerprint: scan.fingerprint,
    qualityScore: scan.qualityScore,
    quality: scan.quality,
    ocrFeatures: learningOcrFeatures(scan.hints),
    signalResults: learningSignalResults(confirmedCard)
  });
  scan.recorded.add(recordKey);
  persistLearningState(result.state);
  logLearningOutcome(result);
  return result;
}

function recordLearningRejection(scan, rejectedCard, source) {
  if (!scan || !rejectedCard) return null;
  const rejectedId = Learning.cardId(rejectedCard);
  if (!scan.rejectedIds.includes(rejectedId)) scan.rejectedIds.push(rejectedId);
  const recordKey = 'REJECTED|' + rejectedId;
  if (scan.recorded.has(recordKey)) return null;
  const result = Learning.recordOutcome(learningState, {
    eventType: 'REJECTED',
    predictedCard: rejectedCard,
    confidenceBefore: Number(rejectedCard.confidence) || 0,
    source,
    ocrFeatures: learningOcrFeatures(scan.hints)
  });
  scan.recorded.add(recordKey);
  persistLearningState(result.state);
  logLearningOutcome(result);
  return result;
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
        kind: response.errorType,
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
        kind: 'parse',
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

window.onNativeBulkScannerResult = json => {
  try {
    const response = JSON.parse(json);
    if (!pendingBulkScanner || response.requestId !== pendingBulkScanner.requestId) return;
    const pending = pendingBulkScanner;
    pendingBulkScanner = null;
    clearTimeout(pending.timeout);
    if (response.ok && response.dataUrl) pending.resolve(response);
    else if (response.cancelled) pending.resolve({cancelled: true});
    else pending.reject(new Error(response.error || 'Die Kameraaufnahme konnte nicht übernommen werden.'));
  } catch (error) {
    if (pendingBulkScanner) {
      const pending = pendingBulkScanner;
      pendingBulkScanner = null;
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }
};

function nativeOpenBulkScanner() {
  return new Promise((resolve, reject) => {
    if (!window.PokeNative || !PokeNative.openBulkScanner) {
      reject(new Error('Der native Bulk-Scanner ist nicht verfügbar.'));
      return;
    }
    if (pendingBulkScanner) {
      reject(new Error('Der Scanner ist bereits geöffnet.'));
      return;
    }
    const requestId = 'bulk-camera-' + requestSequence++;
    const timeout = setTimeout(() => {
      pendingBulkScanner = null;
      reject(new Error('Die Kameraaufnahme wurde nicht abgeschlossen.'));
    }, 5 * 60 * 1000);
    pendingBulkScanner = {requestId, resolve, reject, timeout};
    PokeNative.openBulkScanner(requestId);
  });
}

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
          kind: 'timeout',
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
            kind: 'http',
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
            kind: 'parse',
            error: 'Die Kartendatenbank hat ungültige Daten geliefert.'
          });
        }
      })
      .then(resolve, error => {
        if (error && error.name === 'AbortError') {
          reject(Api.createHttpError({
            url, status: 0, kind: 'timeout', error: 'Zeitüberschreitung der Kartendatenbank.'
          }));
        } else if (error && error.name === 'HttpRequestError') {
          reject(error);
        } else {
          reject(Api.createHttpError({
            url, status: 0, kind: 'network', error: error && error.message || 'Netzwerkfehler.'
          }));
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
  const eurPrice = cardmarket.trendPrice || cardmarket.averageSellPrice || cardmarket.avg7 || cardmarket.lowPrice;
  return {
    tcg: 'pokemon',
    cardType: Recognition.normalizedPokemonCardType(card.supertype),
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
    attacks: card.attacks || [],
    abilities: card.abilities || [],
    rules: card.rules || [],
    language: 'en',
    languages: ['en'],
    imageSmall: card.images && (card.images.small || card.images.large) || '',
    imageLarge: card.images && (card.images.large || card.images.small) || '',
    source: 'Pokémon TCG API',
    price: Number.isFinite(Number(eurPrice))
      ? {value: Number(eurPrice), currency: 'EUR', label: Number(eurPrice).toFixed(2).replace('.', ',') + ' €', source: 'Cardmarket', kind: 'raw-market'}
      : Number.isFinite(Number(usdPrice))
        ? {value: Number(usdPrice), currency: 'USD', label: '$' + Number(usdPrice).toFixed(2), source: 'TCGplayer', kind: 'raw-market'}
        : null
  };
}

function tcgdexImageUrl(value, quality) {
  const base = String(value || '').replace(/\/$/, '');
  if (!base) return '';
  if (/\.(?:avif|webp|png|jpe?g)$/i.test(base)) return base;
  return base + '/' + quality + '.webp';
}

function pokemonCardFromTcgdex(card, language = 'de') {
  const set = card.set || {};
  const cardCount = set.cardCount || {};
  return {
    tcg: 'pokemon',
    cardType: Recognition.normalizedPokemonCardType(card.category),
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
    attacks: card.attacks || [],
    abilities: card.abilities || [],
    effect: card.effect || '',
    rules: card.effect ? [card.effect] : [],
    trainerType: card.trainerType || '',
    language,
    languages: [language],
    imageSmall: tcgdexImageUrl(card.image, 'low'),
    imageLarge: tcgdexImageUrl(card.image, 'high'),
    source: `TCGdex (${languageLabel(language)})`,
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
  return mapWithConcurrency(unique, 4, async brief => {
    if (runToken !== undefined && runToken !== recognitionRun) return brief;
    if (brief.hp && brief.set && brief.rarity && Array.isArray(brief.attacks) && brief.attacks.length) {
      return brief;
    }
    const detailUrl = 'https://api.tcgdex.net/v2/' + encodeURIComponent(language)
      + '/cards/' + encodeURIComponent(brief.id);
    try {
      const full = await nativeGet(detailUrl);
      return {...brief, ...full, image: full.image || brief.image, localId: full.localId || brief.localId};
    } catch (error) {
      console.warn(Api.formatHttpFailure(Api.errorDetails(error, detailUrl)));
      return brief;
    }
  });
}

function pokemonVariantKey(candidate) {
  const setKey = Recognition.norm(candidate.setId || candidate.set || '')
    // Provider IDs differ only typographically for some sets (for example
    // swsh45 vs. swsh4.5). Set plus collector number still identifies the
    // same printed card and should carry both English and localized evidence.
    .replace(/[^a-z0-9]/g, '')
    .replace(/^([a-z]+)0+(\d)/, '$1$2');
  const numberKey = Recognition.numberKey(candidate.number || '');
  if (setKey && numberKey) return setKey + '|' + numberKey;
  return Recognition.norm(candidate.name) + '|' + setKey + '|' + numberKey;
}

function mergePokemonCandidate(current, incoming, language) {
  if (!current) return incoming;
  const incomingLocalized = incoming.source && incoming.source.includes('TCGdex');
  const preferIncomingText = language !== 'en' && incomingLocalized;
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
    cardType: current.cardType !== 'unknown' && current.cardType
      ? current.cardType : incoming.cardType || current.cardType,
    subtypes: current.subtypes && current.subtypes.length ? current.subtypes : incoming.subtypes,
    artist: current.artist || incoming.artist,
    attacks: preferIncomingText && incoming.attacks && incoming.attacks.length
      ? incoming.attacks
      : current.attacks && current.attacks.length ? current.attacks : incoming.attacks || [],
    abilities: preferIncomingText && incoming.abilities && incoming.abilities.length
      ? incoming.abilities
      : current.abilities && current.abilities.length ? current.abilities : incoming.abilities || [],
    effect: preferIncomingText && incoming.effect ? incoming.effect : current.effect || incoming.effect || '',
    rules: preferIncomingText && incoming.rules && incoming.rules.length
      ? incoming.rules
      : current.rules && current.rules.length ? current.rules : incoming.rules || [],
    trainerType: preferIncomingText && incoming.trainerType
      ? incoming.trainerType : current.trainerType || incoming.trainerType || '',
    language: preferIncomingText ? incoming.language || current.language : current.language || incoming.language,
    languages: [...new Set([...(current.languages || []), ...(incoming.languages || [])])],
    imageSmall: preferIncomingText && incoming.imageSmall
      ? incoming.imageSmall : current.imageSmall || incoming.imageSmall,
    imageLarge: preferIncomingText && incoming.imageLarge
      ? incoming.imageLarge : current.imageLarge || incoming.imageLarge,
    price: current.price || incoming.price,
    source: [...sources].join(' + ')
  };
}

async function pokemonSearch(hints, manual = '', runToken) {
  const selectedLanguage = activeRecognitionLanguage();
  const detectedLanguage = Number(hints && hints.languageConfidence) >= 0.70
    ? hints.language
    : '';
  const requestedLanguage = detectedLanguage || selectedLanguage;
  const language = ({de: 'de', en: 'en', ja: 'ja', 'zh-TW': 'zh-tw'})[requestedLanguage] || 'en';
  const candidateLanguage = language === 'zh-tw' ? 'zh-TW' : language;
  const pokemonTcgUrls = Api.buildPokemonTcgUrls(hints, manual);
  const tcgdexUrls = Api.buildTcgdexUrls(hints, manual, language);
  console.debug('[PokeFolio Recognition] Stufe=Suchanfrage Quelle=PokemonTCG URLs=' + (pokemonTcgUrls.join(' | ') || '<keine>'));
  console.debug('[PokeFolio Recognition] Stufe=Suchanfrage Quelle=TCGdex URLs=' + (tcgdexUrls.join(' | ') || '<keine>'));
  const pokemonTcgPromise = Api.settleSearchVariants(
    pokemonTcgUrls,
    nativeGetOnce,
    {attempts: 3, backoffMs: [250, 650], logger: message => console.error(message)}
  );
  // TCGdex is the primary localized source for German cards. The independent
  // Pokémon TCG API runs in parallel as a fallback, so its 5xx responses never
  // delay or cancel usable German results.
  const tcgdexPromise = Api.settleSearchVariants(
    tcgdexUrls,
    nativeGetOnce,
    {attempts: 3, backoffMs: [250, 650], logger: message => console.error(message)}
  );
  const [pokemonTcg, tcgdex] = await Promise.all([pokemonTcgPromise, tcgdexPromise]);

  const pokemonTcgCards = new Map();
  pokemonTcg.values.forEach(response => {
    (response.value.data || []).forEach(card => pokemonTcgCards.set(card.id, pokemonCardFromApi(card)));
  });
  const tcgdexBriefs = new Map();
  tcgdex.values.forEach(response => {
    const list = Array.isArray(response.value) ? response.value : response.value && response.value.data || [];
    list.forEach(card => tcgdexBriefs.set(card.id, card));
  });
  let tcgdexToHydrate = [...tcgdexBriefs.values()];
  if (!manual && (hints.cardType === 'trainer' || hints.cardType === 'energy')) {
    const title = String(hints.mainTitle || '');
    const collector = hints.collectorNumbers && hints.collectorNumbers[0];
    const exactNumber = collector
      ? tcgdexToHydrate.filter(card => Recognition.numberKey(card.localId) === Recognition.numberKey(collector.number))
      : tcgdexToHydrate;
    const matchingTitle = title
      ? exactNumber.filter(card => Recognition.similarity(title, card.name) >= 0.76)
      : exactNumber;
    tcgdexToHydrate = matchingTitle.length ? matchingTitle : [];
  }
  const hydratedMissing = await hydrateTcgdexCards(tcgdexToHydrate, language, runToken);
  const hydratedById = new Map(hydratedMissing.map(card => [card.id, card]));
  const tcgdexCards = [...tcgdexBriefs.values()].map(brief => hydratedById.get(brief.id) || brief);

  const variants = new Map();
  [...pokemonTcgCards.values(), ...tcgdexCards.map(card => pokemonCardFromTcgdex(card, candidateLanguage))].forEach(candidate => {
    const key = pokemonVariantKey(candidate);
    variants.set(key, mergePokemonCandidate(variants.get(key), candidate, candidateLanguage));
  });
  const identityFiltered = Recognition.prefilterPokemonCandidates(
    [...variants.values()], hints, manual
  );
  const broadlyRanked = Recognition.rankPokemonCandidates(
    identityFiltered, hints, manual, 80
  ).filter(candidate => {
    const details = candidate.matchDetails || {};
    if (manual) return details.collector === 'match' || details.name >= 0.84;
    if (hints.cardType === 'trainer' || hints.cardType === 'energy') {
      return details.cardType !== 'mismatch'
        && (details.collector === 'match' || details.name >= 0.82);
    }
    const identity = hints.pokemonIdentity || {};
    if (identity.speciesId && (identity.reliable || identity.nameConfidence >= 0.88)) {
      return details.name >= 0.88
        && (identity.variantConfidence < 0.82 || details.variant !== 'mismatch')
        && (identity.hpConfidence < 0.8 || details.hp !== 'mismatch');
    }
    return details.collector === 'match';
  });
  debugRecognitionCandidates('TextRanking', broadlyRanked);

  return {
    candidates: broadlyRanked,
    status: language !== 'en'
      ? {primarySource: 'tcgdex-' + language, fallbackSource: 'pokemon-tcg', primary: tcgdex, fallback: pokemonTcg}
      : {primarySource: 'pokemon-tcg', fallbackSource: 'tcgdex-en', primary: pokemonTcg, fallback: tcgdex}
  };
}

function emptyLookupStatus() {
  return {
    primarySource: '',
    fallbackSource: '',
    primary: {requestedCount: 0, successCount: 0, resultCount: 0, errors: []},
    fallback: {requestedCount: 0, successCount: 0, resultCount: 0, errors: []}
  };
}

function recoveryState(status) {
  if (!status) return null;
  const summary = Api.summarizeSearchFailure([status.primary, status.fallback]);
  if (summary.kind === 'empty' || summary.kind === 'results') return null;
  $('#manualDetails').open = true;
  const manual = ' Die lokalen OCR-Merkmale bleiben sichtbar; du kannst Name, Set und Nummer manuell verwenden oder später erneut suchen.';
  if (summary.kind === 'timeout') {
    return {title: 'Zeitüberschreitung beim Kartendienst', message: 'Die Kartendienste haben nicht rechtzeitig geantwortet.' + manual};
  }
  if (summary.kind === 'network') {
    return {title: 'Netzwerkfehler beim Kartendienst', message: 'Die Kartendienste konnten über das Netzwerk nicht erreicht werden.' + manual};
  }
  if (summary.kind === 'http') {
    const statusText = summary.statuses.length ? ` (HTTP ${summary.statuses.join('/')})` : '';
    return {title: 'Kartendienst meldet einen HTTP-Fehler', message: 'Beide Datenquellen haben die Anfrage abgelehnt' + statusText + '.' + manual};
  }
  if (summary.kind === 'parse') {
    return {title: 'Kartendaten konnten nicht gelesen werden', message: 'Der Dienst war erreichbar, lieferte aber kein gültiges JSON.' + manual};
  }
  if (summary.kind === 'configuration') {
    return {title: 'Kartendienst in der App blockiert', message: 'Die native Netzwerkfreigabe hat die Datenquelle abgewiesen.' + manual};
  }
  return {title: 'Kartendienste teilweise gestört', message: 'Die Datenquellen sind aus unterschiedlichen Gründen fehlgeschlagen.' + manual};
}

async function yugiohSearch(hints, manual = '') {
  const language = activeRecognitionLanguage();
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
          setId: card.set_code ? String(card.set_code).replace(/-\w+$/, '') : '',
          rarity: card.set_rarity || '',
          language,
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
      setId: firstSet.set_code ? String(firstSet.set_code).replace(/-\w+$/, '') : '',
      rarity: firstSet.set_rarity || '',
      language,
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
    setId: card.set_id || String(card.card_id || id || '').split('-')[0],
    rarity: card.rarity || card.card_rarity || '',
    language: activeRecognitionLanguage(),
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
    'Titel': 'Titel stimmt',
    'Kartentyp': 'Kartentyp stimmt',
    'Kartentyp abweichend': 'Kartentyp weicht ab',
    'Kartennummer': 'Kartennummer stimmt',
    'Setnummer': 'Set stimmt',
    'Setcode': 'Set stimmt',
    'Variante': 'Variante stimmt',
    'Variante abweichend': 'Variante weicht ab',
    'Artwork ähnlich': 'Artwork ähnlich',
    'Artwork abweichend': 'Artwork weicht ab',
    'KP/HP': 'KP/HP stimmt',
    'KP/HP abweichend': 'KP/HP weichen ab',
    'Kartennummer abweichend': 'Kartennummer weicht ab',
    'Set abweichend': 'Set weicht ab',
    'Seltenheit': 'Seltenheit stimmt',
    'Illustrator': 'Illustrator stimmt',
    'Entwicklungsstufe': 'Entwicklungsstufe stimmt',
    'Attacke': 'Attacke stimmt',
    'Attacke abweichend': 'Attacke weicht ab',
    'Schadenswert': 'Schadenswert stimmt',
    'Schadenswert abweichend': 'Schadenswert weicht ab',
    'Sprache': 'Sprache stimmt',
    'Sprache abweichend': 'Sprache weicht ab',
    'Regeltext': 'Regeltext stimmt',
    'Regeltext abweichend': 'Regeltext weicht ab',
    'Setnummer abweichend': 'Setnummer weicht ab',
    'Lokale Referenz': 'Lokal gelernt'
  })[value] || value;
}

function matchStatus(value, unknownText = 'unbekannt') {
  return value === 'match' ? 'stimmt' : value === 'mismatch' ? 'abweichend' : unknownText;
}

function candidateBreakdown(candidate) {
  const details = candidate.matchDetails || {};
  const nonPokemonCard = candidate.cardType === 'trainer' || candidate.cardType === 'energy';
  const name = Number.isFinite(Number(details.name))
    ? Math.round(Number(details.name) * 100) + ' %' : 'nicht erkannt';
  const collector = matchStatus(details.collector, 'nicht erkannt');
  const hp = matchStatus(details.hp, 'unbekannt');
  const set = matchStatus(details.set, 'unbekannt');
  const variant = matchStatus(details.variant, 'nicht erkannt');
  const attack = matchStatus(details.attack, 'nicht erkannt');
  const damage = matchStatus(details.damage, 'nicht erkannt');
  const language = matchStatus(details.language, 'nicht erkannt');
  const artwork = Number.isFinite(Number(details.artwork))
    ? Math.round(Number(details.artwork) * 100) + ' %'
      + (details.visualReliable === false ? ' (Kontur unsicher)' : '')
    : 'nicht verfügbar';
  const identityRow = nonPokemonCard
    ? `<div><span>Titel</span><b>${esc(name)}</b></div>`
    : `<div><span>Name</span><b>${esc(name)}</b></div>`;
  const common = `${identityRow}
    <div><span>Kartentyp</span><b class="${esc(details.cardType || 'unknown')}">${esc(matchStatus(details.cardType, 'unbekannt'))}</b></div>
    <div><span>Kartennummer</span><b class="${esc(details.collector || 'unknown')}">${esc(collector)}</b></div>
    <div><span>Artwork</span><b>${esc(artwork)}</b></div>
    <div><span>Sprache</span><b class="${esc(details.language || 'unknown')}">${esc(language)}</b></div>
    <div><span>Set</span><b class="${esc(details.set || 'unknown')}">${esc(set)}</b></div>`;
  const typeSpecific = nonPokemonCard
    ? `<div><span>Regeltext</span><b class="${esc(details.rules || 'unknown')}">${esc(matchStatus(details.rules, 'nicht erkannt'))}</b></div>`
    : `<div><span>Variante</span><b class="${esc(details.variant || 'unknown')}">${esc(variant)}</b></div>
    <div><span>KP/HP</span><b class="${esc(details.hp || 'unknown')}">${esc(hp)}</b></div>
    <div><span>Attacke</span><b class="${esc(details.attack || 'unknown')}">${esc(attack)}</b></div>
    <div><span>Schaden</span><b class="${esc(details.damage || 'unknown')}">${esc(damage)}</b></div>`;
  const overall = Math.round(clamp(Number(candidate.finalConfidence != null
    ? candidate.finalConfidence : candidate.confidence) || 0, 0, 1) * 100);
  const identification = Math.round(clamp(Number(candidate.identificationScore) || 0, 0, 1) * 100);
  const visualVariant = Number.isFinite(Number(candidate.visualVariantScore))
    ? Math.round(clamp(Number(candidate.visualVariantScore), 0, 1) * 100) + ' %'
    : 'nicht verfügbar';
  const dataConfidence = Math.round(clamp(Number(candidate.dataConfidence) || 0, 0, 1) * 100);
  const learnedComponents = Number.isFinite(Number(candidate.learnedVisualScore))
    ? `<div><span>Lokale Referenz</span><b>${Math.round(Number(candidate.learnedVisualScore) * 100)} %</b></div>
      <div><span>Lokales Artwork</span><b>${Math.round((Number(candidate.learnedArtworkScore) || 0) * 100)} %</b></div>
      <div><span>Korrekturbonus</span><b>${Math.round((Number(candidate.correctionConfidence) || 0) * 100)} Punkte</b></div>`
    : '';
  return `<details class="candidate-details">
    <summary>Score-Details</summary>
    <div class="score-components">
      <div><span>Gesamt</span><b>${overall} %</b></div>
      <div><span>Identität</span><b>${identification} %</b></div>
      <div><span>Druckvariante</span><b>${esc(visualVariant)}</b></div>
      <div><span>Datensicherheit</span><b>${dataConfidence} %</b></div>
      ${learnedComponents}
    </div>
    <div class="match-breakdown">${common}${typeSpecific}</div>
  </details>`;
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
  const decision = Recognition.confidenceDecision(candidates);
  const confident = decision.autoAccept;
  const plausible = Recognition.hasPlausibleCandidate(candidates);
  empty.hidden = true;
  comparison.hidden = false;
  $('#scanReference').hidden = !previewUrls.has('front');
  if (previewUrls.has('front')) $('#comparisonScanImg').src = previewUrls.get('front');
  $('#matchesTitle').textContent = confident
    ? 'Karte erkannt'
    : decision.status === 'variant-uncertain' ? 'Karte erkannt – Variante noch nicht eindeutig'
    : plausible ? 'Mögliche Treffer' : 'Keine eindeutige Karte gefunden';
  $('#matchesSubtitle').textContent = confident
    ? `Platz 1 liegt ${Math.round(decision.margin * 100)} Punkte vor Platz 2`
    : decision.status === 'variant-uncertain' ? 'Identität stimmt; bitte Druckvariante vergleichen'
    : plausible ? 'Mehrere Karten könnten passen' : 'Varianten weichen in wichtigen Merkmalen ab';

  box.innerHTML = shown.map((candidate, index) => {
    const confidence = Math.round(clamp(Number(candidate.confidence) || 0, 0, 1) * 100);
    const level = Recognition.confidenceLevel(candidate.confidence);
    const high = confidence >= 80;
    const selected = Boolean(recognition && recognition.accepted && recognition.id === candidate.id);
    const imageUrl = candidate.imageSmall || candidate.imageLarge || '';
    const reasons = (candidate.evidence || []).slice(0, 5)
      .map(value => `<span>${esc(evidenceLabel(value))}</span>`)
      .join('');
    const price = candidate.price
      ? `${esc(candidate.price.label)}<small>Quelle: ${esc(candidate.price.source || 'Marktdatenanbieter')}</small>`
      : 'Keine aktuellen Marktdaten verfügbar';
    const bestBadge = index === 0
      ? `<span class="best-badge">${confident ? 'Bester Treffer' : decision.status === 'variant-uncertain' ? 'Identität erkannt' : plausible ? 'Wahrscheinlichster Treffer' : 'Niedrige Übereinstimmung'}</span>`
      : '';
    const image = imageUrl
      ? `<img loading="lazy" decoding="async" src="${esc(imageUrl)}" alt="${esc(candidate.name)}" onerror="candidateImageFailed(this)">`
      : '';
    const imageContent = `<span class="candidate-image-placeholder${imageUrl ? '' : ' visible'}" aria-hidden="true"><b>Kartenbild</b><small>nicht verfügbar</small></span>${image}`;
    const imageWrapper = imageUrl
      ? `<button type="button" class="candidate-image-button" onclick="openCandidateImage(${index})" aria-label="${esc(candidate.name)} vergrößern">${imageContent}</button>`
      : `<div class="candidate-image-button no-image">${imageContent}</div>`;
    return `<article class="candidate-card${index === 0 ? ' best' : ' alternative'}${high ? ' high-confidence' : ''}${selected ? ' selected' : ''}">
      <div class="candidate-visual">${bestBadge}${imageWrapper}<span class="confidence-badge">${confidence} % Gesamt</span></div>
      <div class="candidate-content">
        <div class="candidate-title"><b>${esc(candidate.name || 'Unbekannte Karte')}</b><small>${esc(candidate.set || 'Set unbekannt')}</small></div>
        <dl class="candidate-meta">
          <div><dt>Nummer</dt><dd>${esc(candidate.number || '–')}</dd></div>
          <div><dt>Seltenheit</dt><dd>${esc(candidate.rarity || '–')}</dd></div>
          <div><dt>Preis</dt><dd>${price}</dd></div>
        </dl>
        <b class="confidence-label ${esc(level.key)}">${esc(level.label)}</b>
        <div class="confidence-track" aria-label="Trefferwahrscheinlichkeit ${confidence} Prozent"><span style="width:${confidence}%"></span></div>
        ${candidate.tcg === 'pokemon' ? candidateBreakdown(candidate) : ''}
        <div class="candidate-reasons">${reasons || '<span>Bild und Kartendaten prüfen</span>'}</div>
        <small class="candidate-source">Quelle: ${esc(candidate.source || 'Kartendatenbank')}</small>
        <div class="candidate-actions"><button class="choose-card" type="button" onclick="applyCandidate(${index})">${selected ? 'Ausgewählt' : 'Diese Karte'}</button><button class="candidate-detail-button" type="button" onclick="toggleCandidateDetails(this)">Details</button><button class="candidate-reject-button" type="button" onclick="rejectCandidate(${index})">Nicht diese Karte</button></div>
      </div>
    </article>`;
  }).join('');
}

window.toggleCandidateDetails = button => {
  const details = button.closest('.candidate-content').querySelector('.candidate-details');
  if (details) details.open = !details.open;
};

window.rejectCandidate = index => {
  const rejected = candidates[index];
  if (!rejected) return;
  recordLearningRejection(learningScan, rejected, 'single-candidate');
  if (recognition && Learning.cardsEquivalent(recognition, rejected)) recognition = null;
  candidates.splice(index, 1);
  renderCandidates(true);
  setRecState('warn', 'Kandidat ausgeschlossen', candidates.length
    ? 'Der abgelehnte Treffer wird für diesen Scan nicht gelernt. Bitte eine andere Karte wählen.'
    : 'Keine passenden Kandidaten übrig. Erkennung erneut starten oder manuell suchen.');
};

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
  if (event.key === 'Escape' && !$('#collectionDetail').hidden) closeCollectionDetail();
});

function renderBulkFeatures(hints) {
  const box = $('#bulkDebugFeatures');
  const list = $('#bulkFeatureList');
  if (!hints) {
    box.hidden = true;
    list.innerHTML = '';
    return;
  }
  const identity = hints.pokemonIdentity || {};
  const collector = hints.collectorNumbers && hints.collectorNumbers[0];
  const setCode = hints.pokemonSetCodes && hints.pokemonSetCodes[0];
  const type = ({pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energie', unknown: 'Unbekannt'})[
    hints.cardType || 'unknown'
  ];
  const rows = [
    ['Kartentyp', type],
    ['Name/Titel', hints.mainTitle || identity.baseName || hints.nameHint || 'nicht erkannt'],
    ['Ignoriert', (hints.ignoredAdditionalNames || []).join(', ') || 'keine'],
    ['Set', setCode && setCode.value || 'nicht erkannt'],
    ['Nummer', collector ? [collector.number, collector.total].filter(Boolean).join('/') : 'nicht erkannt'],
    ['Sprache', hints.language || activeRecognitionLanguage()],
    ['Variante', identity.variant || $('#bulkVariant').value],
    ['Sicherheit Titel', Math.round((Number(hints.titleConfidence || identity.nameConfidence) || 0) * 100) + ' %']
  ];
  list.innerHTML = rows.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join('');
  box.hidden = false;
}

function debugBulkScan(hints, kind, query, rawOcrText) {
  const identity = hints && hints.pokemonIdentity || {};
  const collector = hints && hints.collectorNumbers && hints.collectorNumbers[0];
  const setCode = hints && hints.pokemonSetCodes && hints.pokemonSetCodes[0];
  console.debug('[PokeFolio Bulk] OCR=' + String(rawOcrText || '').replace(/\s+/g, ' ').slice(0, 900));
  console.debug('[PokeFolio Bulk] Kartentyp=' + (hints && hints.cardType || kind || 'unknown')
    + ' TCG=' + (kind || 'unknown')
    + ' Name=' + (hints && hints.mainTitle || identity.baseName || hints && hints.nameHint || '<nicht erkannt>')
    + ' Set=' + (setCode && setCode.value || '<nicht erkannt>')
    + ' Nummer=' + (collector ? [collector.number, collector.total].filter(Boolean).join('/') : '<nicht erkannt>')
    + ' Sprache=' + (hints && hints.language || activeRecognitionLanguage())
    + ' Variante=' + (identity.variant || $('#bulkVariant').value)
    + ' Confidence=' + Math.round((Number(hints && (hints.titleConfidence || identity.nameConfidence)) || 0) * 100) + '%'
    + ' Suchanfrage=' + (query || '<automatisch>'));
}

function isBulkAutoAcceptable(list) {
  if (!list || !list.length) return false;
  const best = list[0];
  const second = list[1];
  const confidence = Number(best.confidence) || 0;
  const gap = second ? confidence - (Number(second.confidence) || 0) : 1;
  if (best.tcg !== 'pokemon') {
    return confidence >= 0.95
      && (best.evidence || []).some(value => value === 'Setcode' || value === 'Kartencode')
      && gap >= 0.08;
  }
  const details = best.matchDetails || {};
  const decision = Recognition.confidenceDecision(list);
  const exactPrintedIdentity = details.collector === 'match'
    && details.set !== 'mismatch'
    && (details.set === 'match' || Number(details.name) >= 0.93);
  const noContradiction = details.language !== 'mismatch'
    && details.cardType !== 'mismatch'
    && details.variant !== 'mismatch'
    && !(details.visualReliable !== false && Number.isFinite(Number(details.artwork)) && Number(details.artwork) < 0.55);
  return decision.autoAccept && confidence >= 0.80
    && exactPrintedIdentity && noContradiction && gap >= 0.05;
}

function renderBulkCandidates() {
  const panel = $('#bulkCandidatePanel');
  const list = $('#bulkCandidateList');
  const shown = bulkCandidates.slice(0, 3);
  panel.hidden = !shown.length;
  if (!shown.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = shown.map((candidate, index) => {
    const image = candidate.imageSmall || candidate.imageLarge;
    const visual = image
      ? `<span class="bulk-choice-visual"><img loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(candidate.name)}" onerror="bulkCandidateImageFailed(this)"><span class="bulk-choice-placeholder" hidden>Kein Bild</span></span>`
      : '<span class="bulk-choice-placeholder">Kein Bild</span>';
    const confidence = Math.round(clamp(Number(candidate.confidence) || 0, 0, 1) * 100);
    return `<article class="bulk-choice">
      ${visual}<span><b>${esc(candidate.name || 'Unbekannte Karte')}</b>
      <small>${esc(candidate.set || 'Set unbekannt')} · ${esc(candidate.number || 'Nummer unbekannt')}</small>
      <small>${esc(candidate.rarity || '')}</small><strong>${confidence} %</strong>
      <span class="bulk-choice-actions"><button type="button" onclick="selectBulkCandidate(${index})">Diese Karte</button><button type="button" onclick="rejectBulkCandidate(${index})">Nicht diese Karte</button></span></span>
    </article>`;
  }).join('');
}

window.bulkCandidateImageFailed = image => {
  image.hidden = true;
  const placeholder = image.parentElement && image.parentElement.querySelector('.bulk-choice-placeholder');
  if (placeholder) placeholder.hidden = false;
};

window.rejectBulkCandidate = index => {
  const rejected = bulkCandidates[index];
  if (!rejected) return;
  recordLearningRejection(bulkLearningScan, rejected, 'bulk-candidate');
  bulkCandidates.splice(index, 1);
  renderBulkCandidates();
  setBulkStatus('warn', 'Kandidat ausgeschlossen', bulkCandidates.length
    ? 'Bitte einen anderen Treffer wählen.'
    : 'Keine passenden Kandidaten übrig. Erneut scannen oder manuell suchen.');
};

function bulkCollectionEntry(candidate) {
  const number = candidate.number || '';
  let setId = candidate.setId || candidate.setCode || '';
  if (!setId && candidate.tcg === 'onepiece') setId = String(number).split('-')[0];
  if (!setId && candidate.tcg === 'yugioh') setId = String(number).replace(/-\w+$/, '');
  return {
    id: Date.now(),
    tcg: candidate.tcg || recognizedTcg,
    cardType: candidate.cardType || bulkHints && bulkHints.cardType || '',
    name: candidate.name || 'Unbenannte Karte',
    set: candidate.set || '',
    setId,
    number,
    printedTotal: candidate.printedTotal || '',
    rarity: candidate.rarity || '',
    lang: candidate.language || activeRecognitionLanguage(),
    language: candidate.language || activeRecognitionLanguage(),
    printingVariant: candidate.localRecognition && (candidate.printingVariant || candidate.variant)
      ? candidate.printingVariant || candidate.variant
      : $('#bulkVariant').value,
    entryMode: 'bulk',
    quantity: 1,
    image: candidate.imageSmall || candidate.imageLarge || '',
    imageSmall: candidate.imageSmall || '',
    imageLarge: candidate.imageLarge || '',
    price: candidate.price || null,
    recognitionConfidence: Number(candidate.confidence) || 0,
    recognitionSource: candidate.source || '',
    date: new Date().toISOString()
  };
}

function commitBulkCandidate(candidate, trigger) {
  if (!candidate) return false;
  const entry = bulkCollectionEntry(candidate);
  if (!Collection.hasMergeIdentity(entry)) {
    setBulkStatus('warn', 'Unsichere Erkennung', 'Set und Kartennummer fehlen. Die Karte wurde nicht gespeichert.');
    showBulkFeedback('Nicht gespeichert', 'Bitte Set oder Kartencode manuell ergänzen.', true);
    console.debug('[PokeFolio Bulk] Aktion=REJECTED_LOW_CONFIDENCE Grund=UNSTABLE_COLLECTION_KEY');
    return false;
  }
  const key = Collection.collectionKey(entry);
  const gate = Collection.registerScan(bulkScanLock, key, Date.now());
  if (!gate.accepted) {
    setBulkStatus('warn', 'Karte bereits erfasst', 'Diese Karte ist noch für den aktuellen Scan gesperrt. Karte entfernen oder wechseln.');
    showBulkFeedback('Nicht doppelt gezählt', 'Karte zuerst aus dem Rahmen entfernen.', true);
    console.debug('[PokeFolio Bulk] Aktion=REJECTED_DUPLICATE_FRAME collectionKey=' + key
      + ' Grund=' + gate.reason);
    return false;
  }
  bulkScanLock = gate.lock;
  const saved = Collection.upsertCollection(loadCollection(), entry);
  persistCollection(saved.collection);
  if (trigger === 'MANUAL_SELECTION') {
    recordLearningSelection(bulkLearningScan, candidate, 'bulk-manual-selection');
  }
  bulkSession.scanned++;
  if (saved.action === 'NEW_CARD') bulkSession.newCards++;
  else bulkSession.duplicates++;
  renderBulkSession();
  $('#bulkCandidatePanel').hidden = true;
  $('#bulkNoMatch').hidden = true;
  const quantity = saved.entry.quantity;
  const statusTitle = saved.action === 'NEW_CARD' ? 'Neue Karte hinzugefügt' : 'Karte bereits vorhanden – Stückzahl erhöht';
  setBulkStatus('success', statusTitle, `+1 ${saved.entry.name} · Bestand: ${quantity}`);
  showBulkFeedback('✓ ' + saved.entry.name + ' hinzugefügt',
    (saved.entry.number ? saved.entry.number + ' · ' : '') + 'Bestand: ' + quantity);
  if (window.PokeNative && PokeNative.vibrateBulkSuccess) PokeNative.vibrateBulkSuccess();
  const event = trigger === 'MANUAL_SELECTION' ? 'MANUAL_SELECTION' : saved.action;
  console.debug('[PokeFolio Bulk] Aktion=' + event
    + (event === 'MANUAL_SELECTION' ? ' Speicheraktion=' + saved.action : '')
    + ' Name=' + saved.entry.name
    + ' Set=' + (saved.entry.setId || saved.entry.set)
    + ' Nummer=' + saved.entry.number
    + ' Sprache=' + saved.entry.language
    + ' Variante=' + saved.entry.printingVariant
    + ' Confidence=' + Math.round(saved.entry.recognitionConfidence * 100) + '%'
    + ' collectionKey=' + saved.entry.collectionKey);
  setTimeout(() => {
    if (scanMode === 'bulk') setBulkStatus('ready', 'Bereit für die nächste Karte', 'Karte entfernen, dann „Nächste Karte scannen“ wählen.');
  }, 1200);
  return true;
}

window.selectBulkCandidate = index => commitBulkCandidate(bulkCandidates[index], 'MANUAL_SELECTION');

async function runBulkRecognition(dataUrl, previewUrl, normalizedCapture = null) {
  const run = ++recognitionRun;
  startBulkSession();
  bulkSourceDataUrl = dataUrl;
  bulkCandidates = [];
  bulkHints = null;
  bulkLearningScan = null;
  renderBulkCandidates();
  $('#bulkNoMatch').hidden = true;
  $('#bulkFeedback').hidden = true;
  if (bulkPreviewUrl && bulkPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(bulkPreviewUrl);
  bulkPreviewUrl = previewUrl || dataUrl;
  $('#bulkPreview').src = bulkPreviewUrl;
  $('#bulkPreview').hidden = false;
  setBulkStatus('busy', 'Karte wird erkannt', 'OCR, Kartennummer und Set werden ausgewertet.');
  try {
    let prepared;
    if (normalizedCapture && normalizedCapture.normalized) {
      prepared = {...normalizedCapture, dataUrl, prepared: true};
      console.debug('[PokeFolio Crop] AUTHORITATIVE_CAMERA_CROP_REUSED mode=bulk method=' + prepared.method);
    } else {
      try {
        prepared = await nativePrepareCard(dataUrl);
      } catch (error) {
        prepared = {dataUrl, reliable: false, method: 'bulk-fallback', prepared: false};
        console.warn('[PokeFolio Bulk] Kartenkontur unsicher: ' + error.message);
      }
    }
    if (bulkPreviewUrl && bulkPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(bulkPreviewUrl);
    bulkSourceDataUrl = prepared.dataUrl || dataUrl;
    bulkPreviewUrl = bulkSourceDataUrl;
    $('#bulkPreview').src = bulkPreviewUrl;
    const ocrResult = await nativeOcr(prepared.dataUrl || dataUrl, activeRecognitionLanguage());
    if (run !== recognitionRun || scanMode !== 'bulk') return;
    bulkHints = Recognition.extractHints(ocrResult);
    renderBulkFeatures(bulkHints);
    const kind = Recognition.classifyTcg(bulkHints, bulkSelectedTcg);
    recognizedTcg = kind;
    debugBulkScan(bulkHints, kind, 'automatisch', ocrResult.text);
    debugRecognitionFeatures(bulkHints);
    bulkLearningScan = await buildLearningScan(prepared, bulkHints, kind, 'bulk');
    if (Learning.isFastBulkMatch(bulkLearningScan.matchResult)) {
      bulkCandidates = applyLocalLearning(
        Learning.offlineCandidates(bulkLearningScan.matchResult, bulkLearningScan.context),
        bulkLearningScan
      ).slice(0, 5);
      if (bulkCandidates.length) {
        console.debug('[PokeFolio Bulk] Aktion=LOCAL_FAST_MATCH API_SKIPPED cardId='
          + Learning.cardId(bulkCandidates[0]));
        commitBulkCandidate(bulkCandidates[0], 'LOCAL_FAST');
        return;
      }
    }
    let lookup;
    let serviceError = null;
    try {
      lookup = await lookupCandidates(kind, bulkHints, '', run);
    } catch (error) {
      serviceError = error;
      lookup = {candidates: [], status: emptyLookupStatus()};
    }
    if (run !== recognitionRun || scanMode !== 'bulk') return;
    let found = mergeLocalOfflineCandidates(lookup.candidates || [], bulkLearningScan);
    if (found.some(candidate => candidate.tcg === 'pokemon' && (candidate.imageSmall || candidate.imageLarge))) {
      setBulkStatus('busy', 'Kandidaten werden geprüft', 'Eindeutige Kartendaten werden durch den Bildvergleich bestätigt.');
      found = await enrichWithVisualSimilarity(found, prepared, run);
    }
    if (run !== recognitionRun || scanMode !== 'bulk') return;
    found = applyLocalLearning(found, bulkLearningScan);
    if (!found.length && serviceError) throw serviceError;
    bulkCandidates = found.slice(0, 5);
    debugRecognitionCandidates('BulkFinalRanking', bulkCandidates);
    if (isBulkAutoAcceptable(bulkCandidates)) {
      commitBulkCandidate(bulkCandidates[0], 'AUTO');
      return;
    }
    if (Recognition.hasPlausibleCandidate(bulkCandidates)) {
      setBulkStatus('warn', 'Unsichere Erkennung', 'Mehrere Karten könnten passen. Bitte einen der drei besten Treffer wählen.');
      $('#bulkCandidateText').textContent = 'Bitte die passende Karte auswählen. Erst danach wird die Stückzahl verändert.';
      renderBulkCandidates();
      return;
    }
    bulkCandidates = [];
    renderBulkCandidates();
    $('#bulkNoMatch').hidden = false;
    const recovery = recoveryState(lookup.status);
    setBulkStatus(recovery ? 'bad' : 'warn',
      recovery ? recovery.title : 'Keine eindeutige Karte erkannt',
      recovery ? recovery.message : 'Die Karte wurde nicht gespeichert. Bitte erneut scannen oder manuell suchen.');
    console.debug('[PokeFolio Bulk] Aktion=REJECTED_LOW_CONFIDENCE Confidence='
      + Math.round((Number(found[0] && found[0].confidence) || 0) * 100) + '%');
  } catch (error) {
    if (run !== recognitionRun) return;
    bulkCandidates = [];
    renderBulkCandidates();
    $('#bulkNoMatch').hidden = false;
    setBulkStatus('bad', 'Kartendienst oder Erkennung nicht verfügbar',
      (error.message || 'Unbekannter Fehler.') + ' Die Karte wurde nicht gespeichert.');
    console.error('[PokeFolio Bulk] Aktion=REJECTED_LOW_CONFIDENCE Fehler=' + (error.message || error));
  }
}

window.startBulkCamera = async () => {
  if (scanMode !== 'bulk') return;
  setBulkStatus('busy', 'Kamera wird geöffnet', 'Torch bleibt ausgeschaltet, bis du ihn bewusst aktivierst.');
  try {
    const response = await nativeOpenBulkScanner();
    if (response.cancelled) {
      setBulkStatus('ready', 'Bereit zum Scannen', 'Kameraaufnahme wurde abgebrochen.');
      return;
    }
    await runBulkRecognition(response.dataUrl, response.dataUrl, response);
  } catch (error) {
    if (/nicht verfügbar/i.test(error.message || '')) {
      $('#bulkFile').click();
      return;
    }
    setBulkStatus('bad', 'Kamera konnte nicht geöffnet werden', error.message);
  }
};

window.bulkMarkRemovedAndScan = () => {
  bulkScanLock = Collection.markCardRemoved(bulkScanLock);
  $('#bulkCandidatePanel').hidden = true;
  $('#bulkNoMatch').hidden = true;
  setBulkStatus('ready', 'Bereit zum Scannen', 'Die nächste Karte kann aufgenommen werden.');
  window.startBulkCamera();
};

window.openBulkManualSearch = () => {
  $('#bulkManualDetails').open = true;
  $('#bulkManualQuery').focus();
};

$('#bulkCameraButton').onclick = () => window.startBulkCamera();
$('#bulkNextButton').onclick = () => window.bulkMarkRemovedAndScan();
$('#bulkGalleryButton').onclick = () => $('#bulkFile').click();
$('#bulkFile').onchange = async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const preview = URL.createObjectURL(file);
  try {
    const dataUrl = await ocrDataUrl(file);
    await runBulkRecognition(dataUrl, preview);
  } catch (error) {
    URL.revokeObjectURL(preview);
    setBulkStatus('bad', 'Bild konnte nicht verarbeitet werden', error.message);
  } finally {
    event.target.value = '';
  }
};

$('#bulkManualSearch').onclick = async () => {
  const query = $('#bulkManualQuery').value.trim();
  if (!query) return;
  const run = ++recognitionRun;
  const hints = bulkHints || Recognition.extractHints(query);
  const kind = bulkSelectedTcg === 'auto' ? Recognition.classifyTcg(hints, 'auto') : bulkSelectedTcg;
  setBulkStatus('busy', 'Manuelle Suche', 'Passende Karten werden geladen.');
  try {
    const lookup = await lookupCandidates(kind, hints, query, run);
    if (run !== recognitionRun) return;
    let found = mergeLocalOfflineCandidates(lookup.candidates || [], bulkLearningScan);
    if (bulkSourceDataUrl && found.some(candidate => candidate.tcg === 'pokemon' && (candidate.imageSmall || candidate.imageLarge))) {
      let prepared = bulkLearningScan && bulkLearningScan.prepared;
      if (!prepared) {
        try { prepared = await nativePrepareCard(bulkSourceDataUrl); } catch (_) {
          prepared = {dataUrl: bulkSourceDataUrl, prepared: false, reliable: false, method: 'manual-fallback'};
        }
      }
      found = await enrichWithVisualSimilarity(found, prepared, run);
    }
    found = applyLocalLearning(found, bulkLearningScan);
    bulkCandidates = found.slice(0, 3);
    renderBulkCandidates();
    $('#bulkNoMatch').hidden = Boolean(bulkCandidates.length);
    setBulkStatus(bulkCandidates.length ? 'warn' : 'bad',
      bulkCandidates.length ? 'Bitte Treffer auswählen' : 'Keine passenden Kartenkandidaten gefunden',
      bulkCandidates.length ? 'Die manuelle Auswahl wird erst beim Antippen gespeichert.' : 'Suchbegriff, Set oder Kartennummer prüfen.');
  } catch (error) {
    setBulkStatus('bad', 'Kartendienst nicht erreichbar', error.message || 'Netzwerkfehler.');
  }
};

$('#bulkEndSession').onclick = () => {
  const summary = `${bulkSession.scanned} gescannt · ${bulkSession.newCards} neu · ${bulkSession.duplicates} Duplikate`;
  recognitionRun++;
  bulkSession.active = false;
  showBulkFeedback('Scan-Sitzung beendet', summary);
  setBulkStatus('ready', 'Sitzung beendet', 'Alle erfassten Karten bleiben in der Sammlung gespeichert.');
};

window.applyCandidate = (index, automatic = false) => {
  const candidate = candidates[index];
  if (!candidate) return;
  recognition = {...candidate, accepted: true, automaticallyAccepted: Boolean(automatic)};
  if (!automatic) recordLearningSelection(learningScan, recognition, 'single-candidate-selection');
  recognizedTcg = candidate.tcg;
  $('#name').value = candidate.name || '';
  $('#set').value = candidate.set || '';
  $('#number').value = candidate.number || '';
  setRecState(
    'good',
    automatic ? '✓ Karte erkannt' : 'Erkannt',
    `${label(candidate.tcg)} · ${candidate.name}${candidate.set ? ' · ' + candidate.set : ''}`
      + `${candidate.number ? ' · ' + candidate.number : ''} · Confidence ${Math.round((candidate.confidence || 0) * 100)} %`
      + (automatic ? ' · Mit „Ändern“ kannst du die Alternativen wählen.' : '')
  );
  renderCandidates(false);
};

window.changeRecognizedCandidate = () => {
  recognition = null;
  renderCandidates(false);
  setRecState('warn', 'Auswahl ändern', 'Vergleiche die Kandidaten und wähle die passende Karte.');
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
  learningScan = null;
  candidates = [];
  renderRecognitionFeatures(null);
  renderCandidates(false);
  try {
    const dataUrl = await ocrDataUrl(file);
    let prepared;
    const normalizedCapture = normalizedCaptureMetadata.get('front');
    if (normalizedCapture && normalizedCapture.normalized) {
      prepared = {...normalizedCapture, dataUrl, prepared: true};
      console.debug('[PokeFolio Crop] AUTHORITATIVE_CAMERA_CROP_REUSED mode=single method=' + prepared.method);
    } else {
      try {
        prepared = await nativePrepareCard(dataUrl);
      } catch (error) {
        prepared = {dataUrl, reliable: false, method: 'single-fallback', prepared: false};
        console.warn('[PokeFolio Learning] Kartenkontur unsicher: ' + error.message);
      }
    }
    displayNormalizedCard('front', prepared);
    const ocrResult = await nativeOcr(prepared.dataUrl || dataUrl, $('#lang').value);
    if (run !== recognitionRun) return null;
    recognizedRotation = chooseRecognitionRotation(ocrResult);
    const hints = Recognition.extractHints(ocrResult);
    renderRecognitionFeatures(hints);
    debugRecognitionFeatures(hints);
    const kind = Recognition.classifyTcg(hints, manual ? selectedTcg : selectedTcg);
    recognizedTcg = kind;
    learningScan = await buildLearningScan(prepared, hints, kind, 'single');
    let lookup;
    let serviceError = null;
    try {
      lookup = await lookupCandidates(kind, hints, '', run);
    } catch (error) {
      serviceError = error;
      lookup = {candidates: [], status: emptyLookupStatus()};
    }
    if (run !== recognitionRun) return null;
    let foundCandidates = mergeLocalOfflineCandidates(lookup.candidates, learningScan);
    if (foundCandidates.some(candidate => candidate.tcg === 'pokemon' && (candidate.imageSmall || candidate.imageLarge))) {
      setRecState('busy', 'Vergleiche Kartenbilder …', 'Artwork und Bildstruktur werden lokal mit den besten Treffern abgeglichen.');
      foundCandidates = await enrichWithVisualSimilarity(foundCandidates, prepared, run);
      if (run !== recognitionRun) return null;
    }
    foundCandidates = applyLocalLearning(foundCandidates, learningScan);
    if (!foundCandidates.length && serviceError) throw serviceError;
    debugRecognitionCandidates('FinalRanking', foundCandidates);
    candidates = foundCandidates;
    renderCandidates(!candidates.length);

    if (!candidates.length) {
      recognition = null;
      const recovery = recoveryState(lookup.status);
      if (recovery) {
        setRecState('warn', recovery.title, recovery.message);
        return null;
      }
      const hint = hints.mainTitle
        || hints.nameHint
        || hints.onepieceId
        || hints.yugiohSetCode
        || (hints.collectorNumbers[0] && `${hints.collectorNumbers[0].number}/${hints.collectorNumbers[0].total}`)
        || 'keine eindeutigen Merkmale';
      setRecState(
        'warn',
        'Keine passenden Kartenkandidaten gefunden',
        `Gelesen: ${hint}. Starte die Erkennung erneut, nimm ein neues Bild auf oder gib den Namen manuell ein.`
      );
      return null;
    }

    const best = candidates[0];
    const decision = Recognition.confidenceDecision(candidates);
    if (!Recognition.hasPlausibleCandidate(candidates)) {
      recognition = null;
      setRecState(
        'warn',
        'Keine eindeutige Karte gefunden',
        'Die gefundenen Varianten stimmen bei Artwork, Kartennummer oder anderen starken Merkmalen nicht ausreichend überein. Bitte erneut scannen oder manuell suchen.'
      );
      return best;
    }
    if (decision.autoAccept) {
      window.applyCandidate(0, true);
      return best;
    }
    if (decision.status === 'variant-uncertain') {
      recognition = null;
      setRecState(
        'warn',
        'Karte erkannt – Variante noch nicht eindeutig',
        'Name, Nummer und Set passen. Bitte vergleiche Holo-/Druckvarianten und bestätige die richtige Karte.'
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
    let foundCandidates = mergeLocalOfflineCandidates(lookup.candidates, learningScan);
    const frontFile = $('#front').files[0];
    if (frontFile && foundCandidates.some(candidate => candidate.tcg === 'pokemon' && (candidate.imageSmall || candidate.imageLarge))) {
      const prepared = learningScan && learningScan.prepared || await visualComparisonDataUrl(frontFile);
      foundCandidates = await enrichWithVisualSimilarity(foundCandidates, prepared, run);
      if (run !== recognitionRun) return;
    }
    foundCandidates = applyLocalLearning(foundCandidates, learningScan);
    candidates = foundCandidates;
    renderCandidates(!candidates.length);
    const recovery = !candidates.length && recoveryState(lookup.status);
    const plausible = Recognition.hasPlausibleCandidate(candidates);
    setRecState(
      candidates.length || recovery ? 'warn' : 'bad',
      candidates.length
        ? plausible ? 'Treffer gefunden' : 'Keine eindeutige Karte gefunden'
        : recovery ? recovery.title : 'Keine Treffer',
      candidates.length
        ? plausible
          ? 'Bitte Bilder und Kartendaten vergleichen und die passende Karte wählen.'
          : 'Die Varianten weichen in wichtigen Merkmalen ab. Versuche zusätzliche Set- oder Nummernangaben.'
        : recovery ? recovery.message : 'Versuche Name, Setcode oder Kartennummer anders einzugeben.'
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
      setId: recognition && recognition.setId || '',
      number: recognition && recognition.number || $('#number').value,
      printedTotal: recognition && recognition.printedTotal || '',
      cardType: recognition && recognition.cardType || '',
      rarity: recognition && recognition.rarity || '',
      price: recognition && recognition.price || null,
      lang: $('#lang').value,
      language: $('#lang').value,
      printingVariant: Collection.normalizedVariant(recognition || {}),
      entryMode: 'individual',
      quantity: 1,
      recognitionConfidence: recognition && recognition.confidence || 0,
      recognitionSource: recognition && recognition.source || '',
      score,
      grade,
      front,
      back,
      date: new Date().toISOString(),
      image: recognition && (recognition.imageSmall || recognition.imageLarge) || front.preview,
      imageSmall: recognition && recognition.imageSmall || '',
      imageLarge: recognition && recognition.imageLarge || ''
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
  if (recognition && recognition.accepted) {
    recordLearningSelection(learningScan, recognition, 'single-collection-save');
  }
  const saved = Collection.upsertCollection(loadCollection(), last);
  persistCollection(saved.collection);
  reset();
  alert(saved.action === 'NEW_CARD'
    ? 'Zur Sammlung hinzugefügt.'
    : 'Karte bereits vorhanden – Stückzahl erhöht.');
};

window.discard = () => reset();

function reset() {
  recognitionRun++;
  last = null;
  recognition = null;
  learningScan = null;
  candidates = [];
  recognizedRotation = 0;
  ['front', 'back'].forEach(id => {
    const input = $('#' + id);
    input.value = '';
    input.parentElement.classList.remove('has');
    $('#' + id + 'Img').src = '';
    if (previewUrls.has(id)) URL.revokeObjectURL(previewUrls.get(id));
    previewUrls.delete(id);
    normalizedCaptureMetadata.delete(id);
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
  const allCards = loadCollection();
  const portfolio = Collection.portfolioSummary(allCards);
  $('#portfolioTotal').textContent = formatInteger(portfolio.totalCards);
  $('#portfolioDistinct').textContent = formatInteger(portfolio.distinctCards);
  $('#portfolioValue').textContent = formatMoney(portfolio.estimatedValue);
  $('#portfolioDuplicates').textContent = formatInteger(portfolio.duplicates);
  $('#collectionSort').value = collectionSort;
  $$('.collection-view-switch button').forEach(button => {
    button.classList.toggle('active', button.dataset.collectionView === collectionViewMode);
  });
  const setSelect = $('#collectionSetFilter');
  const setOptions = Collection.summarizeSets(allCards).map(group => ({
    value: Collection.keyPart(group.setId || group.set),
    label: `${group.set} · ${label(group.tcg)} · ${languageLabel(group.language)}`
  }));
  const uniqueSets = [...new Map(setOptions.map(option => [option.value, option])).values()];
  const previousSet = collectionFilters.set;
  setSelect.innerHTML = '<option value="all">Alle Sets</option>'
    + uniqueSets.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
  if (previousSet !== 'all' && uniqueSets.some(option => option.value === previousSet)) {
    setSelect.value = previousSet;
  } else {
    setSelect.value = 'all';
    collectionFilters.set = 'all';
  }
  const view = Collection.collectionView(allCards, {
    filters: collectionFilters,
    sort: collectionSort,
    limit: collectionVisibleLimit
  });
  const filteredCollection = allCards.filter(card => Collection.matchesFilters(card, collectionFilters));
  const setsMode = collectionViewMode === 'sets';
  $('#setOverview').hidden = !setsMode;
  $('#collectionList').hidden = setsMode;
  $('#collectionLoadMore').hidden = setsMode || !view.hasMore;
  $('.collection-result-heading').hidden = setsMode;
  if (setsMode) renderSetOverview(filteredCollection);
  $('#collectionResultCount').textContent = `${formatInteger(view.total)} ${view.total === 1 ? 'Ergebnis' : 'Ergebnisse'}`;
  const box = $('#collectionList');
  box.className = collectionViewMode === 'list' ? 'collection-list-view' : 'collection-grid';
  box.innerHTML = view.cards.length ? view.cards.map(card => renderCollectionCard(card)).join('')
    : '<div class="card muted collection-empty">Keine Karten entsprechen den gewählten Filtern.</div>';
}

function formatInteger(value) {
  return new Intl.NumberFormat('de-DE').format(Number(value) || 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat('de-DE', {style: 'currency', currency: 'EUR'}).format(Number(value) || 0);
}

function cardThumbnail(card) {
  return card.imageSmall || card.image || card.front && card.front.preview || '';
}

function renderCollectionCard(card) {
  const image = cardThumbnail(card);
  const encodedId = encodeURIComponent(String(card.id));
  const unitValue = Number(card.estimatedUnitValue) || Collection.estimatedUnitValue(card);
  const grade = card.grade || card.pregrade || (card.specimens || []).find(item => item.grade || item.pregrade);
  return `<article class="collection-entry" data-collection-key="${esc(card.collectionKey)}">
    <button type="button" class="collection-entry-main" onclick="openCollectionDetail('${encodedId}')" aria-label="Details zu ${esc(card.name)}">
      <span class="collection-image-wrap">
        ${image ? `<img loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(card.name)}" onerror="collectionImageFailed(this)">` : '<span class="collection-image-placeholder">Kein Bild</span>'}
        <strong class="quantity-badge">×${card.quantity}</strong>
        ${card.favorite ? '<span class="favorite-badge" aria-label="Favorit">★</span>' : ''}
      </span>
      <span class="collection-entry-info"><small>${esc(label(card.tcg))}</small><b>${esc(card.name || 'Unbenannte Karte')}</b>
        <span>${esc(card.number || 'Nummer unbekannt')}</span><span class="collection-set-name">${esc(card.set || 'Set unbekannt')}</span>
        <span class="collection-entry-meta">${languageLabel(card.lang || card.language)} · ${esc(Collection.variantLabel(card.printingVariant))}${grade ? ' · Grading' : ''}</span>
        ${unitValue ? `<strong class="collection-value">${formatMoney(unitValue * card.quantity)}</strong>` : ''}
      </span>
    </button>
    <div class="collection-quick-quantity" aria-label="Stückzahl ${card.quantity}">
      <button type="button" onclick="adjustCardQuantity('${esc(card.id)}',-1)" aria-label="Stückzahl verringern">−</button>
      <output>${card.quantity}</output>
      <button type="button" onclick="adjustCardQuantity('${esc(card.id)}',1)" aria-label="Stückzahl erhöhen">+</button>
    </div>
  </article>`;
}

window.collectionImageFailed = image => {
  image.hidden = true;
  const placeholder = document.createElement('span');
  placeholder.className = 'collection-image-placeholder';
  placeholder.textContent = 'Kein Bild';
  image.parentElement.insertBefore(placeholder, image);
};

function languageLabel(value) {
  return ({de: 'Deutsch', en: 'Englisch', ja: 'Japanisch', ko: 'Koreanisch', 'zh-CN': 'Chinesisch (vereinfacht)', 'zh-TW': 'Chinesisch (traditionell)'})[
    Collection.normalizedLanguage({lang: value})
  ] || String(value || 'Unbekannt');
}

function renderSetOverview(collection) {
  const box = $('#setOverview');
  const sets = Collection.summarizeSets(collection);
  box.innerHTML = sets.length ? sets.map(group => {
    const percent = Math.round(group.completion * 1000) / 10;
    return `<article class="set-summary">
      <button type="button" onclick="openSetDetail('${encodeURIComponent(group.key)}')">
        <span><small>${esc(label(group.tcg))} · ${languageLabel(group.language)}</small><b>${esc(group.set)}</b></span>
        <span class="set-summary-stats"><strong>${group.ownedNumbers}${group.printedTotal ? ' / ' + group.printedTotal : ''}</strong><small>verschiedene Karten</small></span>
        <span class="set-progress"><i style="width:${Math.min(100, percent)}%"></i></span>
        <span class="set-summary-footer"><span>${percent ? String(percent).replace('.', ',') + ' % komplett' : 'Setgröße unbekannt'}</span><span>${group.total} Karten insgesamt</span><span>${formatMoney(group.estimatedValue)}</span></span>
      </button>
    </article>`;
  }).join('') : '<div class="card muted">Keine Sets entsprechen den Filtern.</div>';
}

window.openSetDetail = encodedKey => {
  const key = decodeURIComponent(encodedKey);
  const groups = Collection.summarizeSets(loadCollection().filter(card => Collection.matchesFilters(card, collectionFilters)));
  const group = groups.find(item => item.key === key);
  if (!group) return;
  const missing = Collection.missingSetNumbers(group);
  const percent = Math.round(group.completion * 1000) / 10;
  const rows = group.cards.slice(0, 350).map(card => `<button class="set-card-row" type="button" onclick="openCollectionDetail('${encodeURIComponent(String(card.id))}')"><b>${esc(card.number || '–')}</b><span>${esc(card.name)}<small>${esc(Collection.variantLabel(card.printingVariant))}</small></span><strong>×${card.quantity}</strong></button>`).join('');
  const missingRows = missing.slice(0, 350).map(number => `<div class="set-card-row missing"><b>${esc(number)}</b><span>Fehlt<small>noch nicht in der Sammlung</small></span><strong>0×</strong></div>`).join('');
  $('#collectionDetailBody').innerHTML = `<div class="set-detail-head"><span class="section-kicker">Set-Tracker</span><h2 id="collectionDetailTitle">${esc(group.set)}</h2><p>${group.ownedNumbers} / ${group.printedTotal || '–'} besessen · ${String(percent).replace('.', ',')} %</p><div class="set-progress large"><i style="width:${Math.min(100, percent)}%"></i></div><p>${group.total} Karten insgesamt · ${formatMoney(group.estimatedValue)} geschätzter Wert</p></div>
    <div class="set-variant-stats"><span>Normal ${group.variants.normal}</span><span>Reverse ${group.variants.reverse}</span><span>Holo ${group.variants.holo}</span><span>Special ${group.variants.special}</span></div>
    <details class="set-owned" open><summary>Besessene Karten (${group.distinct})</summary>${rows || '<p class="muted">Noch keine Karten.</p>'}</details>
    ${group.printedTotal ? `<details class="set-missing"><summary>Fehlende Karten (${missing.length})</summary>${missingRows || '<p class="muted">Set vollständig.</p>'}${missing.length > 350 ? '<p class="muted">Weitere fehlende Nummern werden aus Performancegründen nicht gleichzeitig dargestellt.</p>' : ''}</details>` : ''}`;
  $('#collectionDetail').hidden = false;
};

window.openCollectionDetail = encodedId => {
  const id = decodeURIComponent(encodedId);
  const card = loadCollection().find(item => String(item.id) === id);
  if (!card) return;
  const image = card.imageLarge || card.image || card.imageSmall || card.front && card.front.preview || '';
  const unitValue = Number(card.estimatedUnitValue) || Collection.estimatedUnitValue(card);
  const specimens = card.specimens || [];
  const learning = Learning.cardLearningStatus(learningState, card);
  const rawPriceSource = card.price && card.price.source || '';
  const rawMarket = unitValue
    ? `<div><small>Raw-Marktwert</small><b>${formatMoney(unitValue)}</b><span>Quelle: ${esc(rawPriceSource || 'gespeicherter Preisindikator')}</span></div>`
    : '<div><small>Raw-Marktwert</small><b>Keine aktuellen Marktdaten verfügbar</b></div>';
  const gradingMarket = '<div><small>PSA / CGC / BGS</small><b>Keine aktuellen Marktdaten verfügbar</b><span>PriceCharting wird nur mit belastbaren Kartendaten angezeigt.</span></div>';
  const pregradeNotice = card.grade || card.score
    ? `<p><b>PokéFolio Vorgrading:</b> ${esc(card.grade || card.score)}<br><small>Schätzung – kein offizielles PSA-/CGC-/BGS-Grading und kein automatisch abgeleiteter Grading-Marktwert.</small></p>`
    : '';
  const scanDetails = specimens.map((copy, index) => `<div class="specimen-row"><b>Einzelexemplar ${index + 1}</b><span>${esc(copy.grade || copy.pregrade || 'Raw / ohne Pregrade')}</span>${copy.notes ? `<small>${esc(copy.notes)}</small>` : ''}</div>`).join('');
  $('#collectionDetailBody').innerHTML = `<article class="card-detail-card">
    <div class="card-detail-image">${image ? `<img loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(card.name)}">` : '<span class="collection-image-placeholder">Kein Kartenbild</span>'}</div>
    <div class="card-detail-info"><span class="section-kicker">${esc(label(card.tcg))}</span><h2 id="collectionDetailTitle">${esc(card.name)}</h2><p>${esc(card.set || 'Set unbekannt')} · ${esc(card.number || 'Nummer unbekannt')}</p><div class="item-meta"><span>${languageLabel(card.lang || card.language)}</span><span>${esc(Collection.variantLabel(card.printingVariant))}</span></div>
      <div class="detail-values"><div><small>Einzelwert</small><b>${unitValue ? formatMoney(unitValue) : '–'}</b></div><div><small>Bestand</small><b>${card.quantity}</b></div><div><small>Gesamt</small><b>${unitValue ? formatMoney(unitValue * card.quantity) : '–'}</b></div></div>
      <div class="collection-quantity detail-quantity"><button type="button" onclick="adjustDetailQuantity('${encodeURIComponent(String(card.id))}',-1)">−</button><output>${card.quantity}</output><button type="button" onclick="adjustDetailQuantity('${encodeURIComponent(String(card.id))}',1)">+</button></div>
      <button type="button" class="secondary compact" onclick="toggleCollectionFavorite('${encodeURIComponent(String(card.id))}')">${card.favorite ? '★ Favorit entfernen' : '☆ Als Favorit markieren'}</button>
    </div>
    <section class="detail-market"><h3>Marktwerte</h3><div class="detail-market-grid">${rawMarket}${gradingMarket}</div>${pregradeNotice}</section>
    <section class="detail-learning"><h3>Erkennung</h3><div><span>Lokale Referenzen</span><b>${learning.references}</b></div><div><span>Letzte Confidence</span><b>${learning.lastConfidence ? Math.round(learning.lastConfidence * 100) + ' %' : '–'}</b></div><div><span>Durchschnitt</span><b>${learning.averageConfidence ? Math.round(learning.averageConfidence * 100) + ' %' : '–'}</b></div>${learning.optimized ? '<p>✓ Erkennung für diese Karte lokal optimiert</p>' : '<p class="muted">Noch nicht ausreichend bestätigt.</p>'}</section>
    <details class="detail-scan-data" ${specimens.length ? 'open' : ''}><summary>Scan-Daten, Pregrade und Authentizität</summary>${scanDetails || '<p class="muted">Bulk-Eintrag ohne individuellen Front-/Backscan oder Pregrade.</p>'}</details>
    <label class="detail-notes">Notizen<textarea id="collectionDetailNotes" rows="4" placeholder="Persönliche Notizen …">${esc(card.collectionNotes || '')}</textarea></label>
    <button type="button" class="secondary" onclick="saveCollectionNotes('${encodeURIComponent(String(card.id))}')">Notizen speichern</button>
    <button type="button" class="danger" onclick="delCard('${esc(card.id)}')">Eintrag entfernen</button>
  </article>`;
  $('#collectionDetail').hidden = false;
};

window.closeCollectionDetail = () => {
  $('#collectionDetail').hidden = true;
  $('#collectionDetailBody').innerHTML = '';
};

$('#collectionDetail').onclick = event => {
  if (event.target === $('#collectionDetail')) closeCollectionDetail();
};

window.adjustDetailQuantity = (encodedId, delta) => {
  const id = decodeURIComponent(encodedId);
  window.adjustCardQuantity(id, delta);
  const exists = loadCollection().some(card => String(card.id) === id);
  if (exists) openCollectionDetail(encodedId);
  else closeCollectionDetail();
};

window.toggleCollectionFavorite = encodedId => {
  const id = decodeURIComponent(encodedId);
  const collection = loadCollection().map(card => String(card.id) === id ? {...card, favorite: !card.favorite} : card);
  persistCollection(collection);
  renderCollection();
  openCollectionDetail(encodedId);
};

window.saveCollectionNotes = encodedId => {
  const id = decodeURIComponent(encodedId);
  const value = $('#collectionDetailNotes').value.trim();
  const collection = loadCollection().map(card => String(card.id) === id ? {...card, collectionNotes: value} : card);
  persistCollection(collection);
  renderCollection();
  openCollectionDetail(encodedId);
};

window.adjustCardQuantity = (id, delta) => {
  const current = loadCollection();
  const card = current.find(item => String(item.id) === String(id));
  if (!card) return;
  if (delta < 0 && card.quantity === 1 && !confirm(`${card.name} aus der Sammlung entfernen?`)) return;
  const adjusted = Collection.adjustQuantity(current, id, delta);
  persistCollection(adjusted.collection);
  console.debug('[PokeFolio Collection] Menge geändert collectionKey=' + card.collectionKey
    + ' Delta=' + delta + ' Neu=' + (adjusted.entry ? adjusted.entry.quantity : 0));
  renderCollection();
};

window.delCard = id => {
  const current = loadCollection();
  const card = current.find(item => String(item.id) === String(id));
  if (!card || !confirm(`${card.name} vollständig aus der Sammlung entfernen?`)) return;
  const collection = current.filter(item => String(item.id) !== String(id));
  persistCollection(collection);
  closeCollectionDetail();
  renderCollection();
};

loadCollection();
renderLearningSettings();
