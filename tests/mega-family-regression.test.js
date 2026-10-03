const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../app/src/main/assets/catalog-core');
const R = require('../app/src/main/assets/recognition-core');
const Ref = require('../app/src/main/assets/reference-core');
const context = {PokeCatalog:C};
vm.runInNewContext(fs.readFileSync('app/src/main/assets/catalog-de.js','utf8'), context);
const data = context.PokeCatalogData;
const sets = new Map(data.sets.map(set=>[set.id,set]));
const cards = data.cards.map(([id,name,image])=>{const set=sets.get(id.slice(0,id.lastIndexOf('-')));return {id,name,image,
  number:id.slice(id.lastIndexOf('-')+1),setId:set.id,set:set.name,printedTotal:set.cardCount.official,language:'de'};});
const input = {mainTitle:'Mega-Dragoran ex',language:'de',collectorNumbers:[{number:'091'}],pokemonSetCodes:[{value:'MEP'}]};

test('Mega full name survives OCR before lookup',()=>{
  const hints=R.extractHints({passes:[{region:'TOP_HEADER',variant:'kopfzeile-fast-0',text:'Mega-Dragoran ex\n370 KP'},
    {region:'BOTTOM_METADATA',variant:'unterkante-fast-0',text:'MEP DE\n091'}]});
  assert.equal(hints.mainTitle,'Mega-Dragoran ex');
  const parsed=C.features(hints).parsedName;
  assert.equal(parsed.basePokemon,'Dragoran'); assert.equal(parsed.variantPrefix,'mega'); assert.equal(parsed.variantSuffix,'ex');
});
test('ex, EX, Mega and delta families are different identities',()=>{
  const mega=C.parseName('Mega-Dragoran ex');
  for(const name of ['Dragoran','Dragoran ex','Dragoran-ex δ','Dragoran EX']) assert.equal(C.variantMismatch(mega,C.parseName(name)),true);
  assert.equal(C.variantMismatch(mega,C.parseName('Mega-Dragoran-ex')),false);
});
test('variant parser retains V, VMAX, VSTAR, GX, TAG TEAM and regional forms',()=>{
  for(const suffix of ['V','VMAX','VSTAR','GX','TAG TEAM','EX','ex']) assert.equal(C.parseName('Mewtu '+suffix).variantSuffix,suffix);
  assert.equal(C.parseName('Alola-Kokowei').variantPrefix,'alola');
  assert.equal(C.parseName('Shiny Mewtu').variantPrefix,'shiny');
  assert.equal(C.parseName('Dragoran-ex δ').delta,true);
});
test('exact set+number stops broad fuzzy retrieval',()=>{
  const index=new C.Index(cards.concat([{id:'fixture:mep-091',name:'Mega-Dragoran-ex',number:'091',setId:'mep',language:'de'}]));
  const result=index.lookup(input);
  assert.equal(result.candidates.length,1); assert.equal(result.exactCount,1); assert.equal(result.fuzzyCount,0);
  assert.equal(result.candidates[0].id,'fixture:mep-091'); assert.equal(result.strong,true);
});
test('real MEP 091 miss never promotes old Dragoran editions',()=>{
  const result=new C.Index(cards).lookup(input);
  assert.equal(result.exactCount,0); assert.equal(result.strong,false);
  assert.ok(result.candidates.length);
  assert.ok(result.candidates.every(card=>card.similarOnly && card.confidence <= .39));
  assert.equal(R.confidenceDecision(result.candidates).autoAccept,false);
  assert.equal(result.candidates[0].name,'Mega-Dragoran-ex');
});
test('number 91 coincidence cannot restore 90 percent despite learning or visual evidence',()=>{
  const card={id:'ex15-91',name:'Dragoran-ex δ',number:'91',setId:'ex15',language:'de',confidence:.99,identificationScore:.99};
  const guarded=C.guardCandidate(card,input);
  assert.equal(guarded.similarOnly,true); assert.ok(guarded.confidence <= .39);
  assert.equal(R.confidenceDecision([guarded]).autoAccept,false);
});
test('right set and number but wrong variant requires manual review',()=>{
  const result=new C.Index([{id:'wrong',name:'Dragoran-ex δ',number:'091',setId:'mep',language:'de'}]).lookup(input);
  assert.equal(result.strong,false); assert.ok(result.candidates[0].similarOnly);
});
test('Moruda PBL 039/084 remains an exact high confidence match with artwork',()=>{
  const result=new C.Index(cards).lookup({mainTitle:'Moruda',language:'de',collectorNumbers:[{number:'039',total:'084'}],pokemonSetCodes:[{value:'PBL'}]});
  assert.equal(result.candidates[0].id,'me05-039'); assert.equal(result.strong,true);
  assert.ok(result.candidates[0].confidence>=.96); assert.equal(result.candidates[0].similarOnly,false);
  assert.match(Ref.imageUrls(result.candidates[0])[0],/me05\/039\/low.webp$/);
});
test('reference fields normalize without inventing URLs for missing artwork',()=>{
  assert.deepEqual(Ref.imageUrls({}),[]);
  assert.deepEqual(Ref.imageUrls({image:'http://example.com/card.png'}),[]);
  assert.equal(Ref.imageUrls({images:{small:'https://example.com/card.png'}})[0],'https://example.com/card.png');
  assert.equal(Ref.imageUrls({image:'https://assets.tcgdex.net/de/me/me05/039/'},true)[0], 'https://assets.tcgdex.net/de/me/me05/039/high.webp');
});
test('reference compare uses fallback URL without making artwork mandatory',async()=>{
  const visited=[];
  const result=await Ref.compareWithFallback({imageSmall:'https://example.com/missing.webp',imageLarge:'https://example.com/ok.png'},async url=>{
    visited.push(url); if(url.includes('missing')) throw Error('404'); return {score:.9};
  });
  assert.equal(visited.length,2); assert.equal(result.score,.9);
  await assert.rejects(()=>Ref.compareWithFallback({},async()=>({})),/Kein Referenzbild/);
});
test('display and native visual comparison share a bounded persistent cache',()=>{
  const native=fs.readFileSync('app/src/main/java/de/pokefolio/app/MainActivity.java','utf8');
  assert.match(native,/shouldInterceptRequest[\s\S]*downloadReferenceBitmap\(uri.toString\(\)\)/);
  assert.match(native,/reference = downloadReferenceBitmap\(imageUrl\)/);
  const cache=native.slice(native.indexOf('private Bitmap downloadReferenceBitmap('),native.indexOf('private Bitmap downloadReferenceBitmapUncached'));
  assert.ok(cache.indexOf('cached.isFile()') < cache.indexOf('downloadReferenceBitmapUncached'));
  assert.match(cache,/96L \* 1024 \* 1024/);
});
test('Pokemon followup OCR cannot re-run four-way orientation',()=>{
  const native=fs.readFileSync('app/src/main/java/de/pokefolio/app/MainActivity.java','utf8');
  const start=native.indexOf('if ("FULL".equals(mode)');
  const end=native.indexOf('List<CardImageProcessor.OcrVariant> orientationVariants',start);
  assert.match(native.slice(start,end),/createProfileOcrVariants\(bitmap, 0/);
  assert.match(native.slice(start,end),/return;/);
  assert.match(native,/rotation == 0 && CardRoiLayout.reversedStructure/);
});
