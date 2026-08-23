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
