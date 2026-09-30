const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../app/src/main/assets/recognition-core');
const Api = require('../app/src/main/assets/api-core');
const pass = (region, text) => ({region, variant: `${region === 'TOP_HEADER' ? 'kopfzeile' : 'unterkante'}-original-0`, text});

test('Solgaleo: bare footer 094 is read, HP and attack damage stay out', () => {
  const h = R.extractHints({passes: [pass('TOP_HEADER', 'Solgaleo\n170 KP'),
    pass('BOTTOM_METADATA', '094'), {region:'MIDDLE_TEXT', variant:'mitteltext-0',text:'Sonnenstoß 220'}]});
  assert.equal(h.mainTitle, 'Solgaleo'); assert.equal(h.pokemonNumber, '094');
  assert.deepEqual(h.collectorNumbers.map(item => item.number), ['094']);
  assert.ok(Api.buildTcgdexUrls(h, '', 'de').some(url => new URL(url).searchParams.get('localId') === '094'));
});
test('header identity survives repeated contradictory full-image names', () => {
  const h = R.extractHints({passes: [pass('TOP_HEADER', 'Famieps\nEntwickelt sich aus Zwieps'),
    ...Array.from({length: 6}, (_, i) => ({region:'WHOLE_CARD', variant:`vollbild-${i}-0`, text:'Zwieps', lines:[{text:'Zwieps', y:.05}]}))]});
  assert.equal(h.mainTitle, 'Famieps');
});
test('full Alola name is retained and partial name still retrieves regional cards', () => {
  for (const title of ['Alola-Kokowei', 'Kokowei']) {
    const h = R.extractHints({passes:[pass('TOP_HEADER',title), pass('BOTTOM_METADATA','MEP DE 094')]});
    assert.equal(h.mainTitle,title);
    assert.equal(R.prefilterPokemonCandidates([{id:'mep-094', name:'Alola-Kokowei',number:'094',setId:'mep'}],h).length,1);
  }
});
test('single footer number alone cannot automatically identify a card', () => {
  const h = R.extractHints({passes:[pass('BOTTOM_METADATA','094')]});
  const ranked = R.rankPokemonCandidates([{id:'mep-094',name:'Solgaleo',number:'094',setId:'mep'}], h);
  assert.equal(R.confidenceDecision(ranked).autoAccept,false);
});
test('partial Solga prefix still supplies a name-and-number query', () => {
  const h = R.extractHints({passes:[pass('TOP_HEADER','Solga...'),pass('BOTTOM_METADATA','094')]});
  assert.ok(Api.buildTcgdexUrls(h,'','de').some(url => {
    const q = new URL(url).searchParams; return q.get('name') === 'Solga' && q.get('localId') === '094';
  }));
});
test('manual orientation never trusts missing or uncertain native confidence', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/assets/app.js'),'utf8');
  const context = vm.createContext({console});
  vm.runInContext(source.slice(source.indexOf('function chooseRecognitionRotation('),source.indexOf('function marketPrice(')),context);
  for (const result of [{orientation:180}, {orientation:180,orientationConfident:false}, null])
    assert.equal(context.chooseRecognitionRotation(result),0);
  assert.equal(context.chooseRecognitionRotation({orientation:0,orientationConfident:true}),0);
  assert.equal(context.chooseRecognitionRotation({orientation:180,orientationConfident:true}),180);
});
