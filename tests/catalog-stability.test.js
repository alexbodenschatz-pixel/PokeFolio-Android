const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Catalog = require('../app/src/main/assets/catalog-core.js');
const Collection = require('../app/src/main/assets/collection-core.js');
const Recognition = require('../app/src/main/assets/recognition-core.js');
const sandbox = {PokeCatalog: Catalog};
vm.runInNewContext(fs.readFileSync('app/src/main/assets/catalog-de.js', 'utf8'), sandbox);
const data = sandbox.PokeCatalogData;
const sets = new Map(data.sets.map(set => [set.id, set]));
const cards = data.cards.map(([id, name]) => {
  const setId = id.slice(0, id.lastIndexOf('-')); const set = sets.get(setId);
  return {id, name, setId, set: set.name, number: id.slice(id.lastIndexOf('-')+1),
    tcg: 'pokemon', language: 'de', printedTotal: set.cardCount.official};
});
const index = new Catalog.Index(cards);
const hints = (name, number, code) => ({mainTitle: name, language: 'de',
  collectorNumbers: [{number: number.split('/')[0], total: number.split('/')[1], votes: 2}],
  pokemonSetCodes: code ? [{value: code, votes: 2}] : []});

test('all requested printed set/language spellings normalize identically', () => {
  for (const code of ['PAL DE', 'PALde', 'PAL DE.', 'PAL-DE', 'PALDE']) {
    assert.deepEqual(Catalog.normalizeSet(code), {code: 'PAL', language: 'de'});
    assert.equal(Catalog.setId(code), Catalog.setId('sv02'));
  }
  for (const code of ['MEP DE', 'MEPde', 'MEP-DE']) assert.deepEqual(Catalog.normalizeSet(code), {code: 'MEP', language: 'de'});
});
test('collector normalization preserves fractions, promo prefixes and leading-zero equivalence', () => {
  for (const value of ['073/193','73/193','073 / 193','073|193','O73/193']) assert.equal(Catalog.normalizeNumber(value), '73/193');
  assert.equal(Catalog.normalizeNumber('206/193'), '206/193');
  assert.equal(Catalog.normalizeNumber('094'), '94');
  assert.equal(Catalog.normalizeNumber('TG01/TG30'), 'TG1/TG30');
});
for (const [name, number, id] of [['Kwaks','206/193','sv02-206'],['Britzigel','073/193','sv02-073']]) {
  test(`${name} resolves against the real bundled PAL catalog without network`, () => {
    const result = index.lookup(hints(name, number, 'PAL DE'));
    assert.equal(result.candidates[0].id, id); assert.equal(result.stage, 'set+number'); assert.equal(result.strong, true);
  });
}
test('set and number retrieve the correct edition despite a typo in the title', () => {
  assert.equal(index.lookup(hints('Britzgel','73/193','PAL')).candidates[0].id,'sv02-073');
  const wrong = index.lookup(hints('Famieps','73/193','PAL'));
  assert.equal(wrong.candidates[0].id,'sv02-073'); assert.equal(wrong.strong,false);
});
test('missing and incorrect set mappings cannot suppress name+number retrieval', () => {
  for (const code of ['', 'BAD']) assert.equal(index.lookup(hints('Kwaks','206/193',code)).candidates[0].id,'sv02-206');
});
test('name alone and regional prefix/hyphen variants produce candidates', () => {
  assert.equal(Catalog.normalizeName('Alola –  Kokowei'),Catalog.normalizeName('ALOLA-KOKOWEI'));
  const result = index.lookup(hints('Kokowei','',''));
  assert.ok(result.candidates.some(card => card.name === 'Alola-Kokowei'));
});
test('MEP 094 is explicitly missing in this provider snapshot; no fabricated record', () => {
  assert.equal(cards.some(card => card.id === 'mep-094'),false);
  const result = index.lookup(hints('Alola-Kokowei','094','MEP'));
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates.some(card => card.localMatchStage === 'set+number'),false);
  assert.equal(result.strong,false);
});
test('a later remote MEP 094 record is cached and resolves locally', () => {
  const local = new Catalog.Index();
  local.add([{id:'fixture:mep-094',name:'Alola-Kokowei',number:'094',setId:'mep',language:'de'}]);
  const result = local.lookup(hints('Alola Kokowei','94','MEP'));
  assert.equal(result.strong,true); assert.equal(result.candidates[0].id,'fixture:mep-094');
});
test('same physical card from two providers is returned only once', () => {
  const local = new Catalog.Index([{id:'a',name:'Kwaks',setId:'PAL',number:'206',language:'de'},
    {id:'b',name:'Kwaks',setId:'sv02',number:'206',language:'de'}]);
  assert.equal(local.lookup(hints('Kwaks','206','PAL')).candidates.length,1);
});
test('Dunkelnacht aliases form one tile without losing individual inventory data', () => {
  const raw = [{id:1,tcg:'pokemon',setId:'me05',set:'Dunkelnacht',number:'001',lang:'de',
    quantity:2,favorite:true,price:{value:4},condition:'NM',scanHistory:[{id:'scan1'}],printingVariant:'normal',printedTotal:84},
  {id:2,tcg:'pokemon',setId:'PBL',set:'Dunkelnacht',number:'1',lang:'de',
    quantity:3,price:{value:2},condition:'LP',scanHistory:[{id:'scan2'}],printingVariant:'normal',printedTotal:84}];
  const migrated = Collection.migrateCollection(raw);
  assert.equal(migrated.collection.length,2); // individual records remain lossless
  for(let i=0;i<raw.length;i++) for (const key of Object.keys(raw[i])) assert.deepEqual(migrated.collection[i][key],raw[i][key]);
  const groups = Collection.summarizeSets(migrated.collection);
  assert.equal(groups.length,1); assert.equal(groups[0].total,5); assert.equal(groups[0].ownedNumbers,1);
  assert.equal(groups[0].printedTotal,84);
  assert.equal(Collection.migrateCollection(migrated.collection).changed,false);
  assert.ok(migrated.collection.every(card => Collection.matchesFilters(card,{set:'me05'})));
});
test('different languages and genuinely different sets remain separate', () => {
  const base = {tcg:'pokemon',setId:'me05',set:'Dunkelnacht',number:'1',quantity:1};
  assert.equal(Collection.summarizeSets([{...base,id:1,lang:'de'},{...base,id:2,lang:'en'}]).length,2);
});
test('footer OCR reads PALDE and the card number without promoting HP or damage', () => {
  const result = Recognition.extractHints({passes:[
    {variant:'kopfzeile-fast-0',region:'TOP_HEADER',text:'Britzigel\n170 KP'},
    {variant:'unterkante-fast-0',region:'BOTTOM_METADATA',text:'PALDE\nO73|193'},
    {variant:'mitteltext-0',region:'MIDDLE_TEXT',text:'220 Schaden'}]});
  assert.equal(result.collectorNumbers[0].number,'73');
  assert.equal(result.pokemonSetCodes[0].value,'PAL');
  assert.equal(result.language,'de');
});
test('worker uses the same offline index and ranking implementation', () => {
  const replies=[];
  const context={performance,postMessage: value => replies.push(value)};
  vm.runInNewContext(Catalog.workerSource,context);
  context.onmessage({data:{id:1,type:'init',sets:data.sets,cards}});
  context.onmessage({data:{id:2,type:'lookup',hints:hints('Kwaks','206/193','PAL')}});
  assert.equal(replies[1].result.candidates[0].id,'sv02-206'); assert.equal(replies[1].result.strong,true);
});

function searchHarness(local, replies = []) {
  const app = fs.readFileSync('app/src/main/assets/app.js','utf8');
  const source = app.slice(app.indexOf('async function pokemonSearch(hints'), app.indexOf('async function pokemonSearchRemote('));
  let calls = 0;
  const context = {performance, PokeCatalog:Catalog, PokeCatalogData:data, console,
    activeRecognitionLanguage:()=> 'de', loadCollection:()=>[], getLocalPokemonIndex:async()=>local,
    cachePokemonCards:async cards=>local.add(cards), emptyLookupStatus:()=>({fallback:{}}), setRecState:()=>{},
    nativeGetOnce:()=>{}, Api:{settleSearchVariants:async urls=>{calls++; assert.ok(urls.length); return {values:replies.map(value=>({value})),errors:[]};}},
    pokemonCardFromTcgdex:(card,language)=>({id:card.id,name:card.name,number:card.localId,setId:card.set.id,language})};
  vm.runInNewContext(source,context);
  return {search:context.pokemonSearch,calls:()=>calls};
}
test('real local PAL hit never invokes the remote provider', async () => {
  const harness=searchHarness(index);
  const result=await harness.search(hints('Kwaks','206/193','PAL'));
  assert.equal(result.candidates[0].id,'sv02-206'); assert.equal(harness.calls(),0);
});
test('MEP catalog miss invokes fallback once and preserves explicit miss diagnostics', async () => {
  const harness=searchHarness(index); const input=hints('Alola-Kokowei','094','MEP');
  const result=await harness.search(input);
  assert.equal(harness.calls(),1); assert.equal(input.catalogMiss,true); assert.equal(input.remoteFallback,true);
  assert.equal(result.earlyExit,'');
});
test('a remote result is reused locally on the next scan', async () => {
  const local=new Catalog.Index();
  const harness=searchHarness(local,[{id:'mep-094',name:'Alola-Kokowei',localId:'094',set:{id:'mep'}}]);
  await harness.search(hints('Alola-Kokowei','094','MEP'));
  const second=await harness.search(hints('Alola-Kokowei','094','MEP'));
  assert.equal(harness.calls(),1); assert.equal(second.earlyExit,'LOCAL_SET_NUMBER');
});
