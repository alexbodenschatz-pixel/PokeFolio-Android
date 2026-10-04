const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../app/src/main/assets/catalog-core');
const R = require('../app/src/main/assets/recognition-core');
const dataContext = {PokeCatalog:C};
vm.runInNewContext(fs.readFileSync('app/src/main/assets/catalog-de.js','utf8'),dataContext);
const data = dataContext.PokeCatalogData;
const sets = new Map(data.sets.map(s=>[s.id,s]));
const cards = data.cards.map(([id,name,image])=>{const set=sets.get(id.slice(0,id.lastIndexOf('-')));return {id,name,image,setId:set.id,set:set.name,number:id.split('-').at(-1),printedTotal:set.cardCount.official,language:'de'};});
const index = new C.Index(cards);
const parse = (top,bottom) => R.extractHints({passes:[{region:'TOP_HEADER',variant:'kopfzeile-fast-0',text:top},{region:'BOTTOM_METADATA',variant:'unterkante-fast-0',text:bottom}]});
const mega = () => parse('PHASE2 Mega-Dragoran eX370\nEntwickelt sich aus Dragonir','... OMEP DE 091 ...');
const moruda = () => parse('BASIS Moruda KP 140','... J PBL DE 039/084 ...');

test('dev8 exact device Mega header and footer parse before catalog retrieval',()=>{
 const h=mega(), p=h.parsedFullName;
 assert.equal(h.mainTitle,'Mega-Dragoran ex'); assert.equal(p.basePokemon,'Dragoran');
 assert.equal(p.variantPrefix,'mega'); assert.equal(p.variantSuffix,'ex'); assert.equal(h.hp,'370');
 assert.equal(h.pokemonSetCodes[0].value,'MEP'); assert.equal(h.pokemonSetCodes[0].confidence,.9);
 assert.equal(h.setCorrection,'OMEP → MEP'); assert.equal(h.language,'de');
 assert.equal(h.collectorNumbers[0].number,'091'); assert.equal(C.features(h).number,'91');
 assert.equal(index.lookup(h).exactCount,0); assert.equal(C.finalIdentity(index.lookup(h).candidates),'');
});
for(const suffix of ['ex 370','eX370','exXe370','eXe370','exX370','e×370']) test('dev8 noisy ex and HP '+suffix,()=>{
 const p=C.parseName('PHASE Mega-Dragoran '+suffix);
 assert.equal(p.displayName,'Mega-Dragoran ex'); assert.equal(p.hp,'370'); assert.equal(p.variantSuffix,'ex');
});
test('dev8 historical EX remains distinct from modern ex',()=>{
 assert.equal(C.parseName('Dragoran EX 180').variantSuffix,'EX');
 assert.equal(C.variantMismatch(C.parseName('Dragoran EX'),C.parseName('Dragoran ex')),true);
});
test('dev8 Moruda is exact PBL 039/084 without Mega contamination',()=>{
 const h=moruda(), result=index.lookup(h);
 assert.equal(h.mainTitle,'Moruda'); assert.equal(h.hp,'140'); assert.equal(h.regulationMark,'J');
 assert.equal(h.parsedFullName.variantPrefix,''); assert.equal(h.parsedFullName.variantSuffix,'');
 assert.equal(h.pokemonSetCodes[0].value,'PBL'); assert.equal(h.pokemonSetCodes[0].confidence,1);
 assert.equal(h.collectorNumbers[0].normalizedValue,'039/084'); assert.equal(C.features(h).set,'me5');
 assert.equal(result.exactCount,1); assert.equal(result.stage,'set+number'); assert.equal(result.candidates[0].name,'Moruda');
 assert.ok(result.candidates[0].confidence>=.95); assert.match(C.finalIdentity(result.candidates),/Moruda/);
});
test('dev8 sequential Mega then Moruda then Mega has fresh independent parse state',()=>{
 const first=mega(), second=moruda(), third=mega();
 first.parsedFullName.variantPrefix='mutated'; first.pokemonSetCodes[0].value='BAD';
 assert.equal(second.parsedFullName.variantPrefix,''); assert.equal(second.pokemonSetCodes[0].value,'PBL');
 assert.equal(third.parsedFullName.variantPrefix,'mega'); assert.equal(third.pokemonSetCodes[0].value,'MEP');
 for(const name of ['Moruda','Mewtu','Mew','Machomei']) assert.equal(C.parseName(name).variantPrefix,'');
});
test('dev8 flavor text never supplies EIN or arbitrary set code',()=>{
 const h=parse('BASIS Moruda KP 140','... ein Geist ... eines Schiffswracks ... EIN DE 039/084');
 assert.equal(h.pokemonSetCodes.length,0); assert.equal(C.features(h).set,'');
 assert.equal(C.validateSet('ABCDE').confidence,0);
});
test('dev8 known exact token window outranks noisy duplicates and flavor',()=>{
 const h=parse('BASIS Moruda KP 140','EIN DE\nJ PBL DE 039/084\neines Schiffswracks');
 assert.equal(h.pokemonSetCodes[0].value,'PBL');
 assert.equal(C.parseBottom('OMEP DE 091\nMEP DE 091').confidence,1);
});
test('dev8 lower-left identity takes precedence over a right-hand known-code distractor',()=>{
 const h=R.extractHints({passes:[{region:'TOP_HEADER',variant:'kopfzeile-fast-0',text:'Moruda'},
 {region:'BOTTOM_METADATA',variant:'unterkante-fast-0',lines:[{text:'MEP DE 091',x:.7,y:.5},{text:'PBL DE 039/084',x:.05,y:.6}]}]});
 assert.equal(h.pokemonSetCodes[0].value,'PBL');
});
test('dev8 confidence cannot establish identity below 60 percent',()=>{
 assert.equal(C.finalIdentity([{name:'Dragoran',confidence:.27}]),'');
 assert.equal(C.finalIdentity([{name:'Dragoran',confidence:.99,similarOnly:true}]),'');
});
test('dev8 high-confidence headers do not invoke full OCR even without collector',()=>{
 for(const h of [mega(),moruda()]) {let fullCalls=0;if(C.needsFullOcr(h,false)) fullCalls++;assert.equal(fullCalls,0);}
 assert.equal(C.needsFullOcr({mainTitle:'Moruda',titleConfidence:.99},false),false);
 assert.equal(C.needsFullOcr({mainTitle:'',titleConfidence:.99},false),true);
});
function harness(){
 const source=fs.readFileSync('app/src/main/assets/app.js','utf8');let requests=0;
 const ctx={performance,console,recognitionRun:1,PokeCatalog:C,PokeCatalogData:data,
 activeRecognitionLanguage:()=> 'de',loadCollection:()=>[],getLocalPokemonIndex:async()=>index,
 emptyLookupStatus:()=>({fallback:{}}),setRecState:()=>{},cachePokemonCards:async()=>{},nativeGetOnce:()=>{},
 Api:{settleSearchVariants:async urls=>{requests++;assert.ok(urls.every(url=>/\/cards\/mep-0?91$/.test(url)));return {values:[]};}}};
 vm.runInNewContext(source.slice(source.indexOf('async function pokemonSearch(hints'),source.indexOf('async function pokemonSearchRemote(')),ctx);
 return {ctx,requests:()=>requests};
}
test('dev8 Moruda exact hit never starts remote or sets catalog miss',async()=>{
 const {ctx,requests}=harness(),h=moruda(),r=await ctx.pokemonSearch(h,'',1);
 assert.equal(h.catalogMiss,false);assert.equal(h.remoteFallback,false);assert.equal(requests(),0);
 assert.equal(r.enrich,undefined);assert.equal(r.diagnostics.retrievalStrategy,'LOCAL_INDEX/set+number');
});
test('dev8 Mega missing identity returns immediately and defers exact remote only',async()=>{
 const {ctx,requests}=harness(),h=mega(),r=await ctx.pokemonSearch(h,'',1);
 assert.equal(h.catalogMiss,true);assert.equal(requests(),0);assert.equal(C.finalIdentity(r.candidates),'');
 await r.enrich();assert.equal(requests(),1);assert.equal(h.catalogMiss,true);
});
test('dev8 stale deferred remote cannot start after a new scan',async()=>{
 const {ctx,requests}=harness(),r=await ctx.pokemonSearch(mega(),'',1);ctx.recognitionRun=2;
 await r.enrich();assert.equal(requests(),0);
});
test('dev8 artwork load clears its own error and ignores prior scan callbacks',()=>{
 const source=fs.readFileSync('app/src/main/assets/app.js','utf8'),card={id:'moruda',language:'de',artworkError:'missing'};
 const label={textContent:''};let placeholder=true;
 const ctx={window:{},recognitionRun:2,candidates:[card],displayedRecognitionHints:null,languageLabel:()=> 'Deutsch',$:()=>label};
 vm.runInNewContext(source.slice(source.indexOf('window.candidateImageLoaded ='),source.indexOf('function renderCandidates(')),ctx);
 const image={id:'bestReferenceImg',hidden:true,src:'https://example.com/moruda.webp',dataset:{scanId:'1',cardId:'moruda'},parentElement:{querySelector:()=>({classList:{remove:()=>placeholder=false}})}};
 ctx.window.candidateImageLoaded(image);assert.equal(card.artworkLoaded,undefined);
 image.dataset.scanId='2';ctx.window.candidateImageLoaded(image);
 assert.equal(card.artworkLoaded,true);assert.equal(card.artworkError,'');assert.equal(image.hidden,false);assert.equal(placeholder,false);
 assert.equal(label.textContent,'Referenzbild: Deutsch');
});
test('dev8 catalog lookup resets transient artwork flags from persisted old candidates',()=>{
 const idx=new C.Index([{id:'moruda',name:'Moruda',number:'039',setId:'me5',language:'de',artworkLoaded:true,artworkError:'old'}]);
 const card=idx.lookup(moruda()).candidates[0];assert.equal(card.artworkLoaded,false);assert.equal(card.artworkError,'');
});
test('dev8 printed set era disambiguates EX logo case without collapsing generations',()=>{
 assert.equal(C.parseName('Mega-Dragoran EX', 'MEP').variantSuffix,'ex');
 assert.equal(C.parseName('Mewtu eX', 'xy1').variantSuffix,'EX');
 assert.equal(C.parseName('Dragoran ex', 'ex15').variantSuffix,'ex');
});
test('dev8 parsed collector exposes numeric and display values separately',()=>{
 assert.equal(moruda().collectorNumeric,39);assert.equal(moruda().setTotal,84);
 assert.equal(mega().collectorNumeric,91);assert.equal(mega().setTotal,null);
});
