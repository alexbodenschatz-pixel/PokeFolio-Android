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
  assert.deepEqual(ranked[0].evidence.slice(0, 3), ['Kartennummer', 'Setnummer', 'Name']);
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

test('lässt Bildähnlichkeit nie allein einen starken Nummerntreffer überholen', () => {
  const exactNumber = recognition.combineVisualSimilarity({
    id: 'exact', confidence: 0.94, textConfidence: 0.94, evidence: ['Kartennummer', 'Setnummer']
  }, 0.35);
  const similarArtworkOnly = recognition.combineVisualSimilarity({
    id: 'art', confidence: 0.52, textConfidence: 0.52, evidence: []
  }, 1);

  assert.ok(exactNumber.confidence > similarArtworkOnly.confidence);
  assert.ok(similarArtworkOnly.confidence <= 0.64);
});

test('behält den Textscore bei fehlendem Kartenbild unverändert', () => {
  const candidate = {id: 'without-image', confidence: 0.67, evidence: ['Name']};
  const result = recognition.combineVisualSimilarity(candidate, undefined);

  assert.equal(result.confidence, 0.67);
  assert.equal(result.visualSimilarity, undefined);
});
