const test = require('node:test');
const assert = require('node:assert/strict');
const recognition = require('../app/src/main/assets/recognition-core.js');

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
  assert.ok(ranked[0].confidence >= 0.80);
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
