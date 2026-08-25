const test = require('node:test');
const assert = require('node:assert/strict');
const recognition = require('../app/src/main/assets/recognition-core.js');
const pokemonNames = require('../app/src/main/assets/pokemon-names.js');

test('enthält die vollständige kompakte Deutsch-/Englisch-Artenzuordnung', () => {
  assert.equal(pokemonNames.entries.length, 1025);
  assert.deepEqual(
    pokemonNames.entries.find(entry => entry.id === 197),
    {id: 197, en: 'Umbreon', de: 'Nachtara'}
  );
});

test('führt OCR-Durchläufe aus Rotation und Kontrast zu gemeinsamen Merkmalen zusammen', () => {
  const hints = recognition.extractHints({
    passes: [
      {
        variant: 'vollbild-90',
        text: 'Pikachu V\nKP 190\n25 / 185',
        lines: [
          {text: 'Pikachu V', y: 0.08},
          {text: 'KP 190', y: 0.10},
          {text: '25 / 185', y: 0.91}
        ]
      },
      {
        variant: 'karte-kontrast-90',
        text: 'Pikachu V\nHP 190\n025/185\nIllus. Atsuko Nishida',
        lines: [
          {text: 'Pikachu V', y: 0.07},
          {text: 'HP 190', y: 0.11},
          {text: '025/185', y: 0.92}
        ]
      }
    ]
  });

  assert.equal(hints.nameHint, 'Pikachu V');
  assert.equal(hints.hp, '190');
  assert.equal(recognition.numberKey(hints.collectorNumbers[0].number), '25');
  assert.equal(hints.collectorNumbers[0].total, '185');
  assert.match(hints.artistHint, /Atsuko Nishida/);
});

test('kombiniert Name, Collector Number, Setgröße und KP für den besten Pokémon-Treffer', () => {
  const hints = recognition.extractHints({
    passes: [{
      text: 'Pikachu V\nKP 190\n025/185',
      lines: [
        {text: 'Pikachu V', y: 0.08},
        {text: 'KP 190', y: 0.1},
        {text: '025/185', y: 0.91}
      ]
    }]
  });
  const ranked = recognition.rankPokemonCandidates([
    {id: 'correct', name: 'Pikachu V', number: '25', printedTotal: 185, hp: '190', rarity: 'Rare', subtypes: ['Basic']},
    {id: 'wrong-set', name: 'Pikachu', number: '25', printedTotal: 198, hp: '70', rarity: 'Common', subtypes: ['Basic']},
    {id: 'wrong-card', name: 'Raichu', number: '25', printedTotal: 185, hp: '120', rarity: 'Rare', subtypes: ['Stage 1']}
  ], hints, '');

  assert.equal(ranked[0].id, 'correct');
  assert.ok(ranked[0].confidence > ranked[1].confidence + 0.1);
  assert.ok(ranked[0].evidence.includes('Kartennummer'));
  assert.ok(ranked[0].evidence.includes('Setnummer'));
  assert.ok(ranked[0].evidence.includes('Name'));
  assert.equal(recognition.isConfident(ranked), true);
});

test('erzwingt bei gleichwertigen Nummerntreffern eine Kandidatenauswahl', () => {
  const hints = recognition.extractHints('101/165');
  const ranked = recognition.rankPokemonCandidates([
    {id: 'a', name: 'Elektro-Karte', number: '101', printedTotal: 165},
    {id: 'b', name: 'Feuer-Karte', number: '101', printedTotal: 165}
  ], hints, '');

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].confidence, ranked[1].confidence);
  assert.equal(recognition.isConfident(ranked), false);
});

test('erkennt TCG-spezifische Codes auch aus unscharfen OCR-Zeilen', () => {
  assert.equal(recognition.classifyTcg(recognition.extractHints('OP05-060\nCHARACTER\nCounter +1000'), 'auto'), 'onepiece');
  assert.equal(recognition.classifyTcg(recognition.extractHints('LOB-DE001\nATK 3000 DEF 2500'), 'auto'), 'yugioh');
  assert.equal(recognition.classifyTcg(recognition.extractHints('Glurak\nKP 330\n199/165'), 'auto'), 'pokemon');
});

test('verwechselt deutsche Pokédex-Nummern nicht mit der Collector Number', () => {
  const hints = recognition.extractHints({
    passes: [{
      variant: 'karte-kontrast-0',
      text: 'Krarmor\nPokédex-Nr. 0227\n125/197',
      lines: [
        {text: 'Krarmor', y: 0.08},
        {text: 'Pokédex-Nr. 0227', y: 0.72},
        {text: '125/197', y: 0.93}
      ]
    }]
  });

  assert.equal(hints.nameHint, 'Krarmor');
  assert.deepEqual(hints.collectorNumbers.map(item => `${item.number}/${item.total}`), ['125/197']);
  assert.equal(recognition.parsePokemonCollector('0227', '1025', {
    text: 'Pokédex-Nr. 0227 / 1025', y: 0.9
  }), null);
});

test('akzeptiert typische Pokémon-Collector-Number-Muster und verwirft fremde Präfixe', () => {
  assert.deepEqual(
    recognition.parsePokemonCollector('TG01', 'TG30', {text: 'TG01/TG30', y: 0.92}),
    {number: 'TG01', total: '30', prefix: 'TG'}
  );
  assert.deepEqual(
    recognition.parsePokemonCollector('SV001', 'SV122', {text: 'SV001/SV122', y: 0.92}),
    {number: 'SV001', total: '122', prefix: 'SV'}
  );
  assert.equal(
    recognition.parsePokemonCollector('ABC123', 'XYZ198', {text: 'ABC123/XYZ198', y: 0.92}),
    null
  );
});

test('bevorzugt bei deutscher Kamera-OCR den mehrfach gelesenen Namen in der Kartenkopfzeile', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0',
      text: 'BASIS Glurak ex KP 330\nPokédex-Nr. 0006\nExplosiver Wirbel\n199/165',
      lines: [
        {text: 'BASIS Glurak ex KP 330', y: 0.08},
        {text: 'Pokédex-Nr. 0006', y: 0.31},
        {text: 'Explosiver Wirbel', y: 0.58},
        {text: '199/165', y: 0.93}
      ]
    },
    {
      variant: 'kopfzeile-0',
      text: 'Glurak ex\nKP 330',
      lines: [{text: 'Glurak ex', y: 0.18}, {text: 'KP 330', y: 0.22}]
    },
    {
      variant: 'karte-kontrast-0',
      text: 'Glurak ex\nExplosiver Wirbel\n199/165',
      lines: [{text: 'Glurak ex', y: 0.08}, {text: 'Explosiver Wirbel', y: 0.58}, {text: '199/165', y: 0.92}]
    }
  ]});

  assert.equal(hints.nameHint, 'Glurak ex');
  assert.equal(hints.hp, '330');
  assert.equal(hints.collectorNumbers[0].number, '199');
});

test('erkennt die Kopfzeile einer englischen Pokémon-Karte', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0',
      text: 'BASIC Mew ex HP 180\nGenome Hacking\n151/165',
      lines: [
        {text: 'BASIC Mew ex HP 180', y: 0.08},
        {text: 'Genome Hacking', y: 0.56},
        {text: '151/165', y: 0.93}
      ]
    },
    {
      variant: 'kopfzeile-0',
      text: 'Mew ex\nHP 180',
      lines: [{text: 'Mew ex', y: 0.18}, {text: 'HP 180', y: 0.25}]
    }
  ]});

  assert.equal(hints.nameHint, 'Mew ex');
  assert.equal(hints.hp, '180');
  assert.equal(hints.collectorNumbers[0].number, '151');
});

test('verwendet bei Galerie-OCR die Position über mehrere Perspektiv- und Kontrastdurchläufe', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'karte-kontrast-90',
      text: 'Pikachu\nElektroball\n025/185',
      lines: [{text: 'Pikachu', y: 0.09}, {text: 'Elektroball', y: 0.53}, {text: '025/185', y: 0.94}]
    },
    {
      variant: 'kopfzeile-90',
      text: 'BASIS Pikachu\nKP 70',
      lines: [{text: 'BASIS Pikachu', y: 0.21}, {text: 'KP 70', y: 0.28}]
    }
  ]});

  assert.equal(hints.nameHint, 'Pikachu');
  assert.equal(hints.collectorNumbers[0].number, '25');
});

test('kombiniert Artwork-Ähnlichkeit nachvollziehbar mit dem OCR-Score', () => {
  const base = {
    id: 'charizard',
    name: 'Glurak ex',
    confidence: 0.74,
    textConfidence: 0.74,
    evidence: ['Name', 'Kartennummer']
  };
  const enriched = recognition.combineVisualSimilarity(base, 0.9);

  assert.ok(enriched.confidence > base.confidence);
  assert.ok(enriched.confidence < 0.9);
  assert.equal(enriched.visualSimilarity, 0.9);
  assert.ok(enriched.evidence.includes('Artwork ähnlich'));
});

test('bewertet exakte Nummer plus passendes Artwork höher als Artwork allein', () => {
  const exactNumber = recognition.combineVisualSimilarity({
    id: 'exact', confidence: 0.89, textConfidence: 0.89, evidence: ['Kartennummer', 'Setnummer'],
    matchDetails: {name: 1, collector: 'match', set: 'match', hp: 'match'}
  }, {similarity: 0.92, artwork: 0.94, whole: 0.9, header: 0.9, footer: 0.91, reliable: true});
  const similarArtworkOnly = recognition.combineVisualSimilarity({
    id: 'art', confidence: 0.46, textConfidence: 0.46, evidence: ['Name'],
    matchDetails: {name: 1, collector: 'unknown', set: 'unknown', hp: 'unknown'}
  }, {similarity: 0.94, artwork: 0.96, whole: 0.92, header: 0.9, footer: 0.9, reliable: true});

  assert.ok(exactNumber.confidence > similarArtworkOnly.confidence);
  assert.ok(similarArtworkOnly.confidence <= 0.89);
});

test('behält den Textscore bei fehlendem Kartenbild unverändert', () => {
  const candidate = {id: 'without-image', confidence: 0.67, evidence: ['Name']};
  const result = recognition.combineVisualSimilarity(candidate, undefined);

  assert.equal(result.confidence, 0.67);
  assert.equal(result.visualSimilarity, undefined);
});

test('begrenzt Xerneas nur mit Name beziehungsweise Name plus KP deutlich unter 80 Prozent', () => {
  const nameOnly = recognition.scorePokemonCandidate(
    {id: 'name', name: 'Xerneas', number: '12', hp: '130'},
    recognition.extractHints('Xerneas'),
    ''
  );
  const nameAndHp = recognition.scorePokemonCandidate(
    {id: 'hp', name: 'Xerneas', number: '12', hp: '130'},
    recognition.extractHints('Xerneas\nKP 130'),
    ''
  );

  assert.ok(nameOnly.confidence <= 0.54);
  assert.ok(nameAndHp.confidence <= 0.63);
  assert.ok(nameAndHp.confidence < 0.8);
});

test('wertet beim Xerneas-Full-Art-Test falsche Artworks stark ab', () => {
  const hints = recognition.extractHints('Xerneas\nKP 130');
  const base = recognition.rankPokemonCandidates([
    {id: 'matching-full-art', name: 'Xerneas', number: 'XY07', hp: '130'},
    {id: 'wrong-standard-a', name: 'Xerneas', number: '12', hp: '130'},
    {id: 'wrong-standard-b', name: 'Xerneas', number: '81', hp: '130'}
  ], hints, '', 20);
  const visual = new Map([
    ['matching-full-art', {similarity: 0.91, whole: 0.90, header: 0.86, artwork: 0.94, footer: 0.88, reliable: true}],
    ['wrong-standard-a', {similarity: 0.55, whole: 0.58, header: 0.82, artwork: 0.41, footer: 0.53, reliable: true}],
    ['wrong-standard-b', {similarity: 0.59, whole: 0.61, header: 0.80, artwork: 0.47, footer: 0.57, reliable: true}]
  ]);
  const ranked = base
    .map(candidate => recognition.combineVisualSimilarity(candidate, visual.get(candidate.id)))
    .sort((a, b) => b.confidence - a.confidence);

  assert.equal(ranked[0].id, 'matching-full-art');
  assert.ok(ranked[0].confidence >= 0.62);
  assert.ok(ranked[0].confidence < 0.80);
  assert.ok(ranked[0].confidence - ranked[1].confidence >= 0.25);
  assert.ok(ranked[1].confidence < 0.60);
  assert.ok(ranked[2].confidence < 0.60);
  assert.ok(ranked.slice(1).every(candidate => candidate.evidence.includes('Artwork abweichend')));
});

test('meldet bei ausschließlich abweichenden Xerneas-Artworks keinen plausiblen Treffer', () => {
  const hints = recognition.extractHints('Xerneas\nKP 130');
  const wrong = recognition.rankPokemonCandidates([
    {id: 'a', name: 'Xerneas', number: '12', hp: '130'},
    {id: 'b', name: 'Xerneas', number: '81', hp: '130'}
  ], hints, '', 20).map(candidate => recognition.combineVisualSimilarity(candidate, {
    similarity: 0.54,
    whole: 0.56,
    header: 0.8,
    artwork: 0.4,
    footer: 0.5,
    reliable: true
  })).sort((a, b) => b.confidence - a.confidence);

  assert.equal(recognition.hasPlausibleCandidate(wrong), false);
  assert.equal(recognition.isConfident(wrong), false);
});

test('bestraft erkannte Widersprüche auch bei hoher Bildähnlichkeit aktiv', () => {
  const conflicting = recognition.combineVisualSimilarity({
    id: 'conflict',
    confidence: 0.82,
    textConfidence: 0.82,
    evidence: ['Name'],
    matchDetails: {
      name: 1,
      collector: 'match',
      set: 'mismatch',
      hp: 'mismatch',
      rarity: 'mismatch'
    }
  }, {
    similarity: 0.94,
    whole: 0.94,
    header: 0.93,
    artwork: 0.95,
    footer: 0.92,
    reliable: true
  });
  const wrongCollector = recognition.combineVisualSimilarity({
    id: 'wrong-number',
    confidence: 0.46,
    textConfidence: 0.46,
    evidence: ['Name'],
    matchDetails: {name: 1, collector: 'mismatch', set: 'unknown', hp: 'match'}
  }, {
    similarity: 0.94,
    whole: 0.94,
    header: 0.93,
    artwork: 0.95,
    footer: 0.92,
    reliable: true
  });

  assert.ok(conflicting.confidence <= 0.84);
  assert.ok(wrongCollector.confidence <= 0.59);
});

test('kennzeichnet einen Fallback-Kartenausschnitt und begrenzt dessen Einfluss', () => {
  const result = recognition.combineVisualSimilarity({
    id: 'fallback',
    confidence: 0.55,
    textConfidence: 0.55,
    evidence: ['Name', 'KP/HP'],
    matchDetails: {name: 1, collector: 'unknown', set: 'unknown', hp: 'match'}
  }, {
    similarity: 0.94,
    whole: 0.93,
    header: 0.92,
    artwork: 0.95,
    footer: 0.91,
    reliable: false,
    method: 'center-fallback'
  });

  assert.equal(result.matchDetails.visualReliable, false);
  assert.equal(result.visualResult.method, 'center-fallback');
  assert.ok(result.confidence <= 0.74);
});

test('lässt nahezu identische Holo- und Reverse-Holo-Varianten bewusst mehrdeutig', () => {
  const hints = recognition.extractHints('Xerneas\nKP 130');
  const variants = recognition.rankPokemonCandidates([
    {id: 'holo', name: 'Xerneas', number: '12', hp: '130', rarity: 'Holo Rare'},
    {id: 'reverse', name: 'Xerneas', number: '12', hp: '130', rarity: 'Reverse Holo'}
  ], hints, '', 20).map((candidate, index) => recognition.combineVisualSimilarity(candidate, {
    similarity: index ? 0.90 : 0.91,
    whole: 0.9,
    header: 0.9,
    artwork: index ? 0.91 : 0.92,
    footer: 0.88,
    reliable: true
  })).sort((a, b) => b.confidence - a.confidence);

  assert.equal(recognition.isConfident(variants), false);
});

test('liest präfixierte Promo-Nummern nur aus dem unteren Kartenbereich', () => {
  const hints = recognition.extractHints({passes: [{
    variant: 'unterkante-scharf-0',
    text: 'SWSH123\nIllus. Test',
    lines: [{text: 'SWSH123', y: 0.72}]
  }]});

  assert.equal(hints.collectorNumbers[0].number, 'SWSH123');
  assert.equal(recognition.extractHints('Pokédex-Nr. 0716').collectorNumbers.length, 0);
});

test('kann für die breite Variantenprüfung mehr als sieben Kandidaten behalten', () => {
  const hints = recognition.extractHints('Xerneas');
  const candidates = Array.from({length: 15}, (_, index) => ({
    id: String(index), name: 'Xerneas', number: String(index + 1)
  }));

  assert.equal(recognition.rankPokemonCandidates(candidates, hints, '', 60).length, 15);
});

test('validiert deutsche Pokémon-Namen und verwirft Angriffswörter', () => {
  assert.equal(recognition.bestKnownPokemonName('Nachtara', true).id, 197);
  assert.equal(recognition.bestKnownPokemonName('Nachtaro', true).id, 197);
  assert.equal(recognition.bestKnownPokemonName('Umbreon', true).id, 197);
  assert.equal(recognition.bestKnownPokemonName('Mondscheinklinge', true), null);
  assert.equal(recognition.bestKnownPokemonName('Horrorblick', true), null);
});

test('stuft einen einzelnen unsicheren Fuzzy-Kopfzeilentreffer nicht als verlässliche Identität ein', () => {
  const hints = recognition.extractHints({passes: [{
    variant: 'kopfzeile-original-0',
    text: 'Nachtaro V\nKP 200',
    lines: [{text: 'Nachtaro V', y: 0.18}, {text: 'KP 200', y: 0.42}]
  }]});

  assert.equal(hints.pokemonIdentity.baseName, 'Nachtara');
  assert.equal(hints.pokemonIdentity.variant, 'V');
  assert.equal(hints.pokemonIdentity.reliable, false);
  assert.ok(hints.pokemonIdentity.nameConfidence < 0.88);
});

test('filtert Nachtara V mit 200 KP vor dem Bildvergleich hart nach Identität', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0',
      text: 'BASIS Nachtara V KP 200\nHorrorblick\nMondscheinklinge',
      lines: [
        {text: 'BASIS Nachtara V KP 200', y: 0.07},
        {text: 'Horrorblick', y: 0.48},
        {text: 'Mondscheinklinge', y: 0.61}
      ]
    },
    {
      variant: 'kopfzeile-original-0',
      text: 'Nachtara V\nKP 200',
      lines: [{text: 'Nachtara V', y: 0.18}, {text: 'KP 200', y: 0.42}]
    },
    {
      variant: 'kopfzeile-scharf-0',
      text: 'Nachtaro V\nKP 200',
      lines: [{text: 'Nachtaro V', y: 0.18}, {text: 'KP 200', y: 0.42}]
    }
  ]});
  const rawCandidates = [
    {id: 'umbreon-v-a', name: 'Umbreon V', number: '94', hp: '200'},
    {id: 'nachtara-v-b', name: 'Nachtara V', number: '189', hp: '200'},
    {id: 'umbreon-vmax', name: 'Umbreon VMAX', number: '95', hp: '310'},
    {id: 'nachtara-normal', name: 'Nachtara', number: '93', hp: '110'},
    {id: 'basculin', name: 'Basculin', number: '41', hp: '80'},
    {id: 'bastiodon', name: 'Bastiodon', number: '110', hp: '160'}
  ];
  const filtered = recognition.prefilterPokemonCandidates(rawCandidates, hints, '');
  const ranked = recognition.rankPokemonCandidates(filtered, hints, '', 20);

  assert.equal(hints.pokemonIdentity.baseName, 'Nachtara');
  assert.equal(hints.pokemonIdentity.englishName, 'Umbreon');
  assert.equal(hints.pokemonIdentity.variant, 'V');
  assert.equal(hints.pokemonIdentity.hp, '200');
  assert.ok(hints.pokemonIdentity.nameConfidence >= 0.88);
  assert.equal(hints.pokemonIdentity.reliable, true);
  assert.deepEqual(filtered.map(candidate => candidate.id), ['umbreon-v-a', 'nachtara-v-b']);
  assert.ok(ranked.every(candidate => candidate.matchDetails.name === 1));
  assert.ok(ranked.every(candidate => candidate.matchDetails.variant === 'match'));
  assert.ok(ranked.every(candidate => candidate.matchDetails.hp === 'match'));
  assert.ok(!ranked.some(candidate => ['basculin', 'bastiodon', 'umbreon-vmax'].includes(candidate.id)));
});

test('schließt „Entwickelt sich aus Kleptifux“ ausdrücklich aus dem Gaunux-Kartennamen aus', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0',
      text: 'PHASE 1 Gaunux KP 100\nEntwickelt sich aus Kleptifux\nNr. 828 Fuchs-Pokémon\nEinsatztruppenruf\nBedrängen 80\n048/072',
      lines: [
        {text: 'PHASE 1 Gaunux KP 100', y: 0.07},
        {text: 'Entwickelt sich aus Kleptifux', y: 0.16},
        {text: 'Nr. 828 Fuchs-Pokémon', y: 0.45},
        {text: 'Einsatztruppenruf', y: 0.57},
        {text: 'Bedrängen 80', y: 0.70},
        {text: '048/072', y: 0.93}
      ]
    },
    {
      variant: 'kopfzeile-original-0',
      text: 'Gaunux\nKP 100\nEntwickelt sich aus\nKleptifux',
      lines: [
        {text: 'Gaunux', y: 0.13},
        {text: 'KP 100', y: 0.24},
        {text: 'Entwickelt sich aus', y: 0.60},
        {text: 'Kleptifux', y: 0.64}
      ]
    },
    {
      variant: 'kopfzeile-kontrast-0',
      text: 'Gaunux KP 100\nEntwickelt sich aus Kleptifux',
      lines: [
        {text: 'Gaunux KP 100', y: 0.14},
        {text: 'Entwickelt sich aus Kleptifux', y: 0.62}
      ]
    }
  ]});

  assert.equal(hints.pokemonIdentity.speciesId, 828);
  assert.equal(hints.pokemonIdentity.baseName, 'Gaunux');
  assert.equal(hints.pokemonIdentity.englishName, 'Thievul');
  assert.equal(hints.pokemonIdentity.hp, '100');
  assert.equal(hints.language, 'de');
  assert.ok(!hints.validatedNameHints.some(item => item.baseName === 'Kleptifux'));
  assert.ok(!hints.nameHints.some(item => /Kleptifux/i.test(item.value)));
  assert.ok(hints.attackHints.some(item => item.value === 'Bedrängen'));
  assert.equal(hints.damageValues[0].value, '80');
  assert.ok(hints.collectorNumbers.some(item => recognition.numberKey(item.number) === '48'
    && recognition.numberKey(item.total) === '72'));
  assert.ok(!hints.collectorNumbers.some(item => recognition.numberKey(item.number) === '828'));

  const filtered = recognition.prefilterPokemonCandidates([
    {id: 'gaunux', name: 'Thievul', number: '48', printedTotal: 72, hp: '100'},
    {id: 'kleptifux', name: 'Nickit', number: '125', hp: '70'}
  ], hints, '');
  assert.deepEqual(filtered.map(candidate => candidate.id), ['gaunux']);
});

test('klassifiziert Pokémon vor der Namensbestimmung und behält die Entwicklungsquelle getrennt', () => {
  const normal = recognition.extractHints({passes: [{
    variant: 'kopfzeile-scharf-0',
    text: 'BASIS Pikachu\nKP 70',
    lines: [{text: 'BASIS Pikachu', x: 0.06, y: 0.18, w: 0.36}, {text: 'KP 70', x: 0.78, y: 0.2, w: 0.14}]
  }]});
  const evolved = recognition.extractHints({passes: [{
    variant: 'vollbild-0',
    text: 'PHASE 1 Gaunux KP 100\nEntwickelt sich aus Kleptifux\n048/072',
    lines: [
      {text: 'PHASE 1 Gaunux KP 100', x: 0.05, y: 0.07, w: 0.7},
      {text: 'Entwickelt sich aus Kleptifux', x: 0.08, y: 0.16, w: 0.5},
      {text: '048/072', x: 0.08, y: 0.93, w: 0.16}
    ]
  }]});

  assert.equal(normal.cardType, 'pokemon');
  assert.equal(normal.mainTitle, 'Pikachu');
  assert.equal(evolved.cardType, 'pokemon');
  assert.equal(evolved.mainTitle, 'Gaunux');
  assert.ok(!evolved.nameHints.some(item => /Kleptifux/i.test(item.value)));
});

test('erkennt „Befehl vom Boss – Zyrus“ als deutsche Trainerkarte mit Titel und Footer-Nummer', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0',
      text: 'TRAINER\nUnterstützer\nBefehl vom Boss\nZyrus\nTausche 1 Pokémon auf der Bank deines Gegners gegen sein Aktives Pokémon aus.\nDu kannst während deines Zuges nur 1 Unterstützerkarte spielen.\n132/172',
      lines: [
        {text: 'TRAINER', x: 0.04, y: 0.025, w: 0.38},
        {text: 'Unterstützer', x: 0.73, y: 0.03, w: 0.2},
        {text: 'Befehl vom Boss', x: 0.06, y: 0.075, w: 0.48},
        {text: 'Zyrus', x: 0.84, y: 0.09, w: 0.1},
        {text: 'TITTITT', x: 0.7, y: 0.1, w: 0.12},
        {text: 'Tausche 1 Pokémon auf der Bank deines Gegners', x: 0.1, y: 0.67, w: 0.8},
        {text: 'gegen sein Aktives Pokémon aus.', x: 0.1, y: 0.71, w: 0.6},
        {text: '132/172', x: 0.15, y: 0.945, w: 0.13}
      ]
    },
    {
      variant: 'kopfzeile-scharf-0',
      text: 'TRAINER\nBefehl vom Boss\nZyrus',
      lines: [
        {text: 'TRAINER', x: 0.04, y: 0.04, w: 0.38},
        {text: 'Befehl vom Boss', x: 0.06, y: 0.31, w: 0.5},
        {text: 'Zyrus', x: 0.84, y: 0.38, w: 0.1}
      ]
    },
    {
      variant: 'unterkante-kontrast-0',
      text: '132/172',
      lines: [{text: '132/172', x: 0.1, y: 0.65, w: 0.18}]
    },
    {
      variant: 'kopfzeile-kontrast-180',
      text: 'Illus. GIDORA\nUnterstützerkarte spielen.',
      lines: [
        {text: 'Illus. GIDORA', x: 0.66, y: 0.3, w: 0.22},
        {text: 'Unterstützerkarte spielen.', x: 0.58, y: 0.42, w: 0.36}
      ]
    }
  ]});

  assert.equal(hints.cardType, 'trainer');
  assert.equal(hints.mainTitle, 'Befehl vom Boss');
  assert.ok(hints.titleConfidence >= 0.9);
  assert.deepEqual(hints.ignoredAdditionalNames, ['Zyrus']);
  assert.equal(hints.nameHint, 'Befehl vom Boss');
  assert.ok(!hints.nameHints.some(item => item.value === 'Zyrus'));
  assert.equal(hints.collectorNumbers[0].number, '132');
  assert.equal(hints.collectorNumbers[0].total, '172');
  assert.equal(hints.language, 'de');
  assert.ok(hints.ruleTextHints.length >= 2);
});

test('filtert und bewertet Trainerkarten zuerst nach Typ, Nummer, Setgröße und Haupttitel', () => {
  const hints = recognition.extractHints({passes: [{
    variant: 'vollbild-0',
    text: 'TRAINER\nBefehl vom Boss\nZyrus\nDu kannst während deines Zuges nur 1 Unterstützerkarte spielen.\n132/172',
    lines: [
      {text: 'TRAINER', x: 0.04, y: 0.02, w: 0.3},
      {text: 'Befehl vom Boss', x: 0.06, y: 0.075, w: 0.48},
      {text: 'Zyrus', x: 0.84, y: 0.09, w: 0.1},
      {text: 'Du kannst während deines Zuges nur 1 Unterstützerkarte spielen.', x: 0.2, y: 0.83, w: 0.7},
      {text: '132/172', x: 0.15, y: 0.945, w: 0.13}
    ]
  }]});
  const candidates = [
    {id: 'correct', cardType: 'trainer', name: 'Befehl vom Boss', number: '132', printedTotal: 172, set: 'Strahlende Sterne', language: 'de', languages: ['de'], effect: 'Du kannst während deines Zuges nur 1 Unterstützerkarte spielen.'},
    {id: 'subtitle', cardType: 'trainer', name: 'Zyrus', number: '132', printedTotal: 172, set: 'Falsches Set', language: 'de', languages: ['de']},
    {id: 'wrong-set', cardType: 'trainer', name: 'Befehl vom Boss', number: '132', printedTotal: 198, set: 'Falsches Set', language: 'de', languages: ['de']},
    {id: 'pokemon', cardType: 'pokemon', name: 'Bisaflor', number: '132', printedTotal: 172, language: 'de', languages: ['de']}
  ];

  const filtered = recognition.prefilterPokemonCandidates(candidates, hints, '');
  const ranked = recognition.rankPokemonCandidates(filtered, hints, '', 10);
  const subtitle = recognition.scoreNonPokemonCardCandidate(candidates[1], hints, '');

  assert.deepEqual(filtered.map(candidate => candidate.id), ['correct']);
  assert.equal(ranked[0].id, 'correct');
  assert.ok(ranked[0].confidence >= 0.9);
  assert.equal(ranked[0].matchDetails.collector, 'match');
  assert.equal(ranked[0].matchDetails.setNumber, 'match');
  assert.equal(ranked[0].matchDetails.cardType, 'match');
  assert.ok(subtitle.confidence < 0.5);
});

test('erkennt Energiekarten als eigenen Kartentyp und verwendet ihren Titel', () => {
  const hints = recognition.extractHints({passes: [{
    variant: 'vollbild-0',
    text: 'ENERGIE\nBasis-Finsternis-Energie\nLege diese Karte an 1 deiner Pokémon an.\n007/012',
    lines: [
      {text: 'ENERGIE', x: 0.04, y: 0.025, w: 0.3},
      {text: 'Basis-Finsternis-Energie', x: 0.06, y: 0.08, w: 0.58},
      {text: 'Lege diese Karte an 1 deiner Pokémon an.', x: 0.1, y: 0.64, w: 0.74},
      {text: '007/012', x: 0.08, y: 0.94, w: 0.15}
    ]
  }]});

  assert.equal(hints.cardType, 'energy');
  assert.equal(hints.mainTitle, 'Basis-Finsternis-Energie');
  assert.equal(hints.collectorNumbers[0].number, '7');
  assert.equal(hints.collectorNumbers[0].total, '12');
  assert.ok(hints.ruleTextHints.some(item => /Lege diese Karte/i.test(item.value)));
});

test('erkennt japanische, koreanische sowie vereinfachte und traditionelle chinesische Schrift', () => {
  const japanese = recognition.extractHints({language: 'ja', passes: [{text: 'ポケモン ゲンガー 094/165'}]});
  const korean = recognition.extractHints({language: 'ko', passes: [{text: '포켓몬 카드 피카츄 025/165'}]});
  const simplified = recognition.extractHints({language: 'zh-CN', passes: [{text: '宝可梦 训练师 能量 025/165'}]});
  const traditional = recognition.extractHints({language: 'zh-TW', passes: [{text: '寶可夢 訓練師 能量 025/165'}]});
  assert.equal(japanese.language, 'ja');
  assert.equal(korean.language, 'ko');
  assert.equal(simplified.language, 'zh-CN');
  assert.equal(traditional.language, 'zh-TW');
  assert.ok(japanese.languageConfidence >= 0.78);
  assert.ok(korean.languageConfidence >= 0.78);
});

test('wertet eine asiatische Karte nicht als westlichen Auto-Accept aus', () => {
  const decision = recognition.confidenceDecision([{
    confidence: 0.94,
    identificationScore: 0.96,
    matchDetails: {collector: 'match', name: 0.98, set: 'match', language: 'mismatch'}
  }, {
    confidence: 0.60,
    identificationScore: 0.65,
    matchDetails: {collector: 'unknown', name: 0.6, language: 'unknown'}
  }]);
  assert.equal(decision.autoAccept, false);
});

test('gewichtet Nummer, Setgröße, Attacke, Schaden und Sprache vor Bildähnlichkeit', () => {
  const hints = recognition.extractHints({passes: [{
    variant: 'vollbild-0',
    text: 'Gaunux KP 100\nGaunertrick 30\n126/202\nSchaden Rückzug',
    lines: [
      {text: 'Gaunux KP 100', y: 0.07},
      {text: 'Gaunertrick 30', y: 0.48},
      {text: '126/202', y: 0.93},
      {text: 'Schaden Rückzug', y: 0.72}
    ]
  }]});
  const ranked = recognition.rankPokemonCandidates([
    {
      id: 'exact', name: 'Thievul', number: '126', printedTotal: 202, hp: '100',
      attacks: [{name: 'Gaunertrick', damage: '30'}], language: 'de', languages: ['de']
    },
    {
      id: 'wrong-print', name: 'Thievul', number: '126', printedTotal: 189, hp: '100',
      attacks: [{name: 'Finsterer Biss', damage: '90'}], language: 'en', languages: ['en']
    }
  ], hints, '', 10);

  assert.equal(ranked[0].id, 'exact');
  assert.equal(ranked[0].matchDetails.setNumber, 'match');
  assert.equal(ranked[0].matchDetails.attack, 'match');
  assert.equal(ranked[0].matchDetails.damage, 'match');
  assert.equal(ranked[0].matchDetails.language, 'match');
  assert.equal(ranked[1].matchDetails.setNumber, 'mismatch');
  assert.ok(ranked[0].confidence - ranked[1].confidence >= 0.3);

  const visuallyMisleading = recognition.combineVisualSimilarity(ranked[1], {
    similarity: 0.95, artwork: 0.96, whole: 0.94, header: 0.94, footer: 0.93, reliable: true
  });
  assert.ok(visuallyMisleading.confidence <= 0.55);
  assert.equal(recognition.isConfident([visuallyMisleading]), false);
});

test('identifiziert Damythir V mit exakten Kartendaten trotz schwächerem Foto sehr sicher', () => {
  const hints = recognition.extractHints({passes: [
    {
      variant: 'vollbild-0',
      text: 'Damythir V KP 220\nVorreiter\nBarrierenstoß 40\n134/189',
      lines: [
        {text: 'Damythir V KP 220', y: 0.07},
        {text: 'Vorreiter', y: 0.47},
        {text: 'Barrierenstoß 40', y: 0.58},
        {text: '134/189', y: 0.94}
      ]
    },
    {
      variant: 'kopfzeile-scharf-0',
      text: 'Damythir V\nKP 220',
      lines: [{text: 'Damythir V', y: 0.18}, {text: 'KP 220', y: 0.36}]
    },
    {
      variant: 'unterkante-kontrast-0',
      text: '134/189',
      lines: [{text: '134/189', y: 0.62}]
    }
  ]});
  const base = recognition.scorePokemonCandidate({
    id: 'swsh10-134', tcg: 'pokemon', name: 'Damythir V', number: '134',
    printedTotal: 189, set: 'Astralglanz', setId: 'swsh10', hp: '220',
    language: 'de', languages: ['de'],
    attacks: [{name: 'Vorreiter'}, {name: 'Barrierenstoß', damage: '40'}]
  }, hints, '');
  const imperfectPhoto = recognition.combineVisualSimilarity(base, {
    similarity: 0.60, whole: 0.58, header: 0.68, artwork: 0.60, text: 0.66,
    footer: 0.64, reliable: true
  });
  const clearPhoto = recognition.combineVisualSimilarity(base, {
    similarity: 0.90, whole: 0.89, header: 0.91, artwork: 0.92, text: 0.90,
    footer: 0.91, reliable: true
  });

  assert.ok(base.identificationScore >= 0.96);
  assert.ok(base.dataConfidence >= 0.9);
  assert.ok(imperfectPhoto.confidence >= 0.90);
  assert.equal(recognition.confidenceDecision([imperfectPhoto]).status, 'variant-uncertain');
  assert.ok(clearPhoto.confidence >= 0.95);
  assert.equal(recognition.confidenceDecision([clearPhoto]).status, 'auto');
});

test('behandelt eine unbekannte Nummer neutral, eine widersprüchliche Nummer aber als harten Konflikt', () => {
  const hints = recognition.extractHints('Damythir V\nKP 220\n134/189\nVorreiter');
  const common = {name: 'Damythir V', printedTotal: 189, hp: '220', attacks: [{name: 'Vorreiter'}]};
  const missing = recognition.scorePokemonCandidate({...common, id: 'missing', number: ''}, hints, '');
  const conflicting = recognition.scorePokemonCandidate({...common, id: 'wrong', number: '132'}, hints, '');

  assert.equal(missing.matchDetails.collector, 'unknown');
  assert.equal(conflicting.matchDetails.collector, 'mismatch');
  assert.ok(missing.identificationScore > conflicting.identificationScore + 0.2);
  assert.ok(conflicting.confidence <= 0.40);
});

test('berücksichtigt den Abstand zu Platz zwei bei der automatischen Entscheidung', () => {
  const clear = recognition.confidenceDecision([
    {confidence: 0.82, identificationScore: 0.88, matchDetails: {name: 1, collector: 'match', set: 'match'}},
    {confidence: 0.43, identificationScore: 0.42, matchDetails: {name: 0.7}}
  ]);
  const close = recognition.confidenceDecision([
    {confidence: 0.82, identificationScore: 0.88, matchDetails: {name: 1, collector: 'match', set: 'match'}},
    {confidence: 0.80, identificationScore: 0.87, matchDetails: {name: 1, collector: 'match', set: 'match'}}
  ]);

  assert.equal(clear.status, 'auto');
  assert.ok(clear.margin >= 0.3);
  assert.equal(close.autoAccept, false);
  assert.equal(close.status, 'candidates');
});

test('korrigiert S/5, B/8, O/0 und I/1 nur im Collector-Number-Format', () => {
  const hints = recognition.extractHints('Damythir V\nKP 220\n13S/IB9');
  assert.equal(hints.collectorNumbers[0].number, '135');
  assert.equal(hints.collectorNumbers[0].total, '189');
  assert.equal(recognition.extractHints('Pokédex-Nr. 0B99').collectorNumbers.length, 0);
});

test('hält die Identitäts-Confidence bei Winkel, Licht, leichter Spiegelung und unsicherer Kontur stabil', () => {
  const base = {
    id: 'damythir', tcg: 'pokemon', name: 'Damythir V', setId: 'swsh10', set: 'Astralglanz', number: '134',
    confidence: 0.97, finalConfidence: 0.97, identificationScore: 0.98, dataConfidence: 0.92,
    matchDetails: {name: 1, collector: 'match', set: 'match', setNumber: 'match', hp: 'match'}
  };
  const conditions = [
    {similarity: 0.90, artwork: 0.92, whole: 0.88, header: 0.90, text: 0.89, footer: 0.90, reliable: true},
    {similarity: 0.78, artwork: 0.80, whole: 0.74, header: 0.82, text: 0.76, footer: 0.75, reliable: true},
    {similarity: 0.72, artwork: 0.74, whole: 0.68, header: 0.77, text: 0.70, footer: 0.69, reliable: false}
  ];
  const scores = conditions.map(condition => recognition.combineVisualSimilarity(base, condition).confidence);
  assert.ok(scores.every(score => score >= 0.90));
  assert.ok(Math.max(...scores) - Math.min(...scores) <= 0.08);
});
