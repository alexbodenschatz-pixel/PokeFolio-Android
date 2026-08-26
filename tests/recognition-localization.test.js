const test = require('node:test');
const assert = require('node:assert/strict');
const recognition = require('../app/src/main/assets/recognition-core.js');
const references = require('../app/src/main/assets/reference-core.js');

function localizedCandidate(overrides = {}) {
  return {
    tcg: 'pokemon', id: 'sv-test-132', name: 'Sophora', number: '132',
    printedTotal: '172', set: 'Testset', setId: 'sv-test', cardType: 'trainer',
    language: 'de', languages: ['de'], confidence: 0.8, finalConfidence: 0.8,
    identificationScore: 0.8, matchDetails: {name: 1, collector: 'match', set: 'match'},
    ...overrides
  };
}

test('Sophora: TOP_HEADER-Konsens schlägt deutschen Regeltext', () => {
  const hints = recognition.extractHints({language: 'de', passes: [
    {variant: 'vollbild-0', region: 'WHOLE_CARD', text: 'TRAINER\nSophora\nDu kannst während deines Zuges nur 1 Unterstützerkarte spielen.\n132/172', lines: [
      {text: 'TRAINER', x: .72, y: .04, w: .2}, {text: 'Sophora', x: .08, y: .08, w: .25},
      {text: 'Du kannst während deines Zuges nur 1 Unterstützerkarte spielen.', x: .08, y: .62, w: .82},
      {text: '132/172', x: .08, y: .93, w: .16}
    ]},
    {variant: 'kopfzeile-scharf-0', region: 'TOP_HEADER', text: 'TRAINER\nSophora', lines: [
      {text: 'TRAINER', x: .7, y: .04, w: .2}, {text: 'Sophora', x: .08, y: .35, w: .3}
    ]},
    {variant: 'mitteltext-normal-0', region: 'MIDDLE_TEXT', text: 'Du kannst während deines Zuges nur 1 Unterstützerkarte spielen.', lines: [
      {text: 'Du kannst während deines Zuges nur 1 Unterstützerkarte spielen.', x: .08, y: .5, w: .84}
    ]}
  ]});
  assert.equal(hints.cardType, 'trainer');
  assert.equal(hints.mainTitle, 'Sophora');
  assert.equal(hints.titleSource, 'OCR_CONSENSUS');
  assert.notEqual(hints.nameHint, 'Du kannst während deines Zuges nur 1 Unterstützerkarte spielen.');
});

test('Befehl vom Boss behält Zyrus ausschließlich als Zusatznamen', () => {
  const hints = recognition.extractHints({language: 'de', passes: [{
    variant: 'kopfzeile-original-0', region: 'TOP_HEADER', text: 'TRAINER\nBefehl vom Boss – Zyrus',
    lines: [{text: 'TRAINER', x: .72, y: .05}, {text: 'Befehl vom Boss – Zyrus', x: .07, y: .32, w: .8}]
  }, {variant: 'unterkante-normal-0', region: 'BOTTOM_METADATA', text: '132/172', lines: [{text: '132/172', y: .65}]}]});
  assert.equal(hints.mainTitle, 'Befehl vom Boss');
  assert.deepEqual(hints.ignoredAdditionalNames, ['Zyrus']);
});

test('Gaunux trennt die Entwicklungsquelle Kleptifux positionsbezogen', () => {
  const hints = recognition.extractHints({language: 'de', passes: [{
    variant: 'vollbild-0', region: 'WHOLE_CARD', text: 'Gaunux\nKP 100\nEntwickelt sich aus Kleptifux', lines: [
      {text: 'Gaunux', y: .07}, {text: 'KP 100', y: .08}, {text: 'Entwickelt sich aus Kleptifux', y: .14}
    ]
  }, {variant: 'kopfzeile-scharf-0', region: 'TOP_HEADER', text: 'Gaunux KP 100', lines: [{text: 'Gaunux KP 100', y: .25}]}]});
  assert.equal(hints.mainTitle, 'Gaunux');
  assert.equal(hints.evolvesFrom, 'Kleptifux');
});

test('Schrift- und Regionsbestimmung läuft vor der Kandidatensuche', () => {
  const japanese = recognition.detectCardLanguage('このポケモンのワザ');
  const korean = recognition.detectCardLanguage('이 포켓몬의 기술');
  const chinese = recognition.detectCardLanguage('訓練師 寶可夢');
  assert.deepEqual([japanese.value, japanese.script, japanese.region], ['ja', 'Japanese', 'JP']);
  assert.deepEqual([korean.value, korean.script, korean.region], ['ko', 'Hangul', 'KR']);
  assert.deepEqual([chinese.value, chinese.script], ['zh-TW', 'Chinese']);
});

test('chinesischer Pokémon-Scan verwirft westliche Trainerkarten als Hard Contradiction', () => {
  const hints = {language: 'zh-CN', languageConfidence: .95, cardType: 'pokemon', cardTypeConfidence: .94,
    collectorNumbers: [{number: '12', total: '100', votes: 2}], pokemonIdentity: {}};
  const candidates = [
    localizedCandidate({id: 'wrong', name: 'Sophora', number: '12', cardType: 'trainer', language: 'de', languages: ['de']}),
    localizedCandidate({id: 'right', name: '宝可梦', number: '12', printedTotal: '100',
      cardType: 'pokemon', language: 'zh-CN', languages: ['zh-CN']})
  ];
  const filtered = recognition.prefilterPokemonCandidates(candidates, hints, '');
  assert.deepEqual(filtered.map(item => item.id), ['right']);
});

test('deutscher Scan wählt ein vorhandenes deutsches Referenzbild', () => {
  const selected = references.selectLocalizedImage({imagesByLanguage: {
    de: {small: 'de-low', large: 'de-high'}, en: {small: 'en-low', large: 'en-high'}
  }}, 'de');
  assert.equal(selected.imageLarge, 'de-high');
  assert.equal(selected.imageLanguage, 'de');
  assert.equal(selected.referenceLanguageFallback, false);
});

test('deutscher Scan kennzeichnet ein englisches Referenzbild als Fallback', () => {
  const selected = references.selectLocalizedImage({imagesByLanguage: {en: {large: 'en-high'}}}, 'de');
  assert.equal(selected.imageLanguage, 'en');
  assert.equal(selected.referenceLanguageFallback, true);
});

test('japanischer Scan bevorzugt das japanische Referenzbild', () => {
  const selected = references.selectLocalizedImage({imagesByLanguage: {
    en: {large: 'en'}, ja: {large: 'ja'}
  }}, 'ja');
  assert.equal(selected.imageLarge, 'ja');
});

test('vereinfachtes Chinesisch nutzt kontrolliert ein traditionelles Regionalbild vor Englisch', () => {
  const selected = references.selectLocalizedImage({imagesByLanguage: {
    en: {large: 'en'}, 'zh-TW': {large: 'tw'}
  }}, 'zh-CN');
  assert.equal(selected.imageLarge, 'tw');
  assert.equal(selected.referenceLanguageFallback, true);
});

test('unplausible Kandidaten werden nicht nur zum Auffüllen einer Dreierliste gezeigt', () => {
  const candidates = [localizedCandidate({confidence: .49, finalConfidence: .49,
    matchDetails: {name: .42, collector: 'unknown', set: 'unknown', artwork: .31}})];
  assert.deepEqual(recognition.filterPlausibleCandidates(candidates), []);
});

test('autorisierte strukturierte offizielle Daten bestätigen einen Kandidaten', () => {
  const validation = recognition.validateOfficialCandidate(localizedCandidate(), {
    authorizedStructured: true, source: 'POKEMON_OFFICIAL_STRUCTURED', name: 'Sophora',
    number: '132', setId: 'sv-test', cardType: 'Trainer'
  });
  assert.equal(validation.status, 'CONFIRMED');
  assert.ok(validation.score >= .78);
});

test('ohne autorisierten strukturierten Datensatz bleibt Official Validation nicht verfügbar', () => {
  assert.equal(recognition.validateOfficialCandidate(localizedCandidate(), null).status, 'NOT_AVAILABLE');
  assert.equal(recognition.OFFICIAL_VALIDATION_POLICY.htmlScraping, false);
  assert.equal(recognition.OFFICIAL_VALIDATION_POLICY.networkAccess, 'DISABLED');
});

test('Konflikt bei offizieller Kartennummer wird erfasst statt blind überschrieben', () => {
  const validation = recognition.validateOfficialCandidate(localizedCandidate(), {
    authorizedStructured: true, name: 'Sophora', number: '999', setId: 'sv-test', cardType: 'Trainer'
  });
  assert.equal(validation.status, 'CONFLICT');
  assert.equal(validation.conflicts[0].field, 'cardNumber');
});

test('lokales Learning bleibt bei offizieller Bestätigung als unabhängiges Signal erhalten', () => {
  const learned = localizedCandidate({learnedVisualScore: .94, correctionConfidence: .08});
  const result = recognition.applyOfficialValidation(learned, {
    authorizedStructured: true, name: 'Sophora', number: '132', setId: 'sv-test', cardType: 'Trainer'
  });
  assert.equal(result.officialValidationStatus, 'CONFIRMED');
  assert.equal(result.learnedVisualScore, .94);
  assert.ok(result.finalConfidence > learned.finalConfidence);
});
