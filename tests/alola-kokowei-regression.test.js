const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../app/src/main/assets/recognition-core');
const Api = require('../app/src/main/assets/api-core');

function hints(name = 'Kokowei', footer = 'MEP DE\n094') {
  return R.extractHints({language: 'de', passes: [
    {region: 'TOP_HEADER', variant: 'kopfzeile-original-0', text: `${name} 150 KP`},
    {region: 'BOTTOM_METADATA', variant: 'unterkante-idzone-original-0', text: footer},
    {region: 'MIDDLE_TEXT', variant: 'mitteltext-original-0', text: 'Fähigkeit Hoch hinaus\nMegasauger 70'}
  ]});
}
// Contract fixture supplied by the user, NOT an assertion that this print is in a live API.
const card = {id: 'mep-094', tcg: 'pokemon', name: 'Alola-Kokowei', number: '094',
  setId: 'mep', hp: 150, language: 'de', attacks: [{name: 'Megasauger', damage: '70'}],
  abilities: [{name: 'Hoch hinaus'}]};

test('MEP + 094 in separate footer lines supplies a corroborated identifier and HP suffix', () => {
  const h = hints();
  assert.equal(h.pokemonNumber, '094');
  assert.equal(h.pokemonSetCodes[0].value, 'MEP');
  assert.equal(h.hp, '150');
  assert.equal(h.abilityHints[0].value, 'Hoch hinaus');
});

test('unconfirmed numbers and unrelated numeric metadata never become collector IDs', () => {
  for (const footer of ['13', 'MEP DE\n150 KP', 'MEP DE\n2026', 'MEP DE\nPokédex Nr. 094', 'MEP DE\nSchaden 094']) {
    assert.equal(hints('Kokowei', footer).collectorNumbers.length, 0, footer);
  }
});

test('Kokowei generates independent number/set and substring name API routes', () => {
  const urls = Api.buildTcgdexUrls(hints(), '', 'de');
  assert.ok(urls.some(url => url.endsWith('/mep-094')));
  assert.ok(urls.some(url => { const q = new URL(url).searchParams; return q.get('localId') === '094' && !q.has('name'); }));
  assert.ok(urls.some(url => new URL(url).searchParams.get('name') === 'Kokowei'));
  assert.ok(urls.some(url => new URL(url).searchParams.get('abilities.name') === 'Hoch hinaus'));
});

test('partial/fuzzy Kokowei ranks Alola-Kokowei 094/MEP highly without permitting another species', () => {
  for (const name of ['Kokowei', 'Kokowel', 'Alola-Kokowei', 'Alola Kokowei', 'Alola‑Kokowei']) {
    const h = hints(name);
    const filtered = R.prefilterPokemonCandidates([card, {...card, id: 'wrong', name: 'Pikachu'}], h);
    assert.ok(filtered.some(c => c.id === 'mep-094'), name);
    const ranked = R.rankPokemonCandidates(filtered, h);
    assert.equal(ranked[0].id, 'mep-094', name);
    assert.ok(ranked[0].identificationScore >= 0.9, name);
    const wrong = R.rankPokemonCandidates([{...card, id: 'wrong', name: 'Pikachu'}], h);
    assert.equal(R.confidenceDecision(wrong).autoAccept, false, name);
  }
});

test('visible regional prefix stays in the displayed main title', () => {
  assert.equal(hints('Alola-Kokowei').mainTitle, 'Alola-Kokowei');
});

test('regional Vulpix/Raichu/Knogga remain candidates for incomplete OCR titles', () => {
  for (const name of ['Vulpix', 'Raichu', 'Knogga']) {
    const h = hints(name);
    assert.equal(R.prefilterPokemonCandidates([{...card, name: `Alola-${name}`}], h).length, 1);
  }
});

test('unconfirmed regional base name never automatically selects a print', () => {
  const h = R.extractHints({passes: [{region: 'TOP_HEADER', variant: 'kopfzeile-original-0', text: 'Kokowei'}]});
  const ranked = R.rankPokemonCandidates([card, {...card, id: 'other-001', number: '001', setId: 'other'}], h);
  assert.equal(R.confidenceDecision(ranked).autoAccept, false);
});

test('failed exact endpoint does not cancel independent number/name search', async () => {
  const result = await Api.settleSearchVariants(Api.buildTcgdexUrls(hints(), '', 'de'), async url => {
    if (url.endsWith('/mep-094')) throw new Error('404');
    return [card];
  }, {attempts: 1});
  assert.ok(result.values.length > 0);
});
