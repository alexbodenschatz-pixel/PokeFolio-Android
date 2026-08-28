const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const Recognition = require('../app/src/main/assets/recognition-core.js');
const Api = require('../app/src/main/assets/api-core.js');

function priorityPass(text, variant = 'unterkante-idzone-original-0') {
  return {passes: [{
    variant,
    region: 'BOTTOM_METADATA',
    text,
    lines: [{text, x: 0.05, y: 0.45, w: 0.72, h: 0.22}]
  }]};
}

test('korrigiert O/0, I/l/1, S/5 und B/8 ausschließlich im Collector-Kontext', () => {
  const corrected = Recognition.parsePokemonCollectorText('O24/O88', {priorityRoi: true, y: 0.9});
  assert.equal(corrected.number, '24');
  assert.equal(corrected.total, '88');
  assert.equal(corrected.normalizedValue, '024/088');
  assert.equal(Recognition.parsePokemonCollectorText('HP O8O', {priorityRoi: true, y: 0.9}), null);
});

test('akzeptiert vierstellige Drucknummern und behält deren Druckformat', () => {
  const collector = Recognition.parsePokemonCollectorText('0303/07', {priorityRoi: true, y: 0.9});
  assert.equal(collector.number, '303');
  assert.equal(collector.total, '7');
  assert.equal(collector.normalizedValue, '0303/07');
});

test('repariert einen fehlenden Slash nur in der Bottom-left Priority ROI', () => {
  assert.equal(Recognition.parsePokemonCollectorText('198 193', {y: 0.9}), null);
  const collector = Recognition.parsePokemonCollectorText('198 193 AR', {
    priorityRoi: true, sourceRegion: 'BOTTOM_LEFT_ID', y: 0.9
  });
  assert.equal(collector.normalizedValue, '198/193');
  assert.equal(Recognition.parsePokemonCollectorText('90 120', {
    priorityRoi: true, sourceRegion: 'BOTTOM_LEFT_ID', y: 0.9
  }), null);
});

test('Bottom-left Consensus dominiert zufällige Vollbild-Zahlen und Copyrighttext', () => {
  const hints = Recognition.extractHints({passes: [
    ...priorityPass('O49 / I95 G').passes,
    {variant: 'unterkante-idzone-kontrast-0', region: 'BOTTOM_METADATA',
      text: '049/195 G', lines: [{text: '049/195 G', y: 0.48}]},
    {variant: 'vollbild-0', region: 'WHOLE_CARD',
      text: '2025 Pokémon/Nintendo/Creatures/GAME FREAK\n120',
      lines: [{text: '120', y: 0.55}, {text: '2025 Pokémon/Nintendo/Creatures/GAME FREAK', y: 0.95}]}
  ]});
  assert.equal(Recognition.numberKey(hints.collectorNumbers[0].number), '49');
  assert.equal(hints.collectorNumbers[0].total, '195');
  assert.equal(hints.collectorNumbers[0].normalizedValue, '049/195');
  assert.equal(hints.mainTitle, '');
});

test('Number-first API-Queries stehen vor einem optionalen Namensfallback', () => {
  const hints = Recognition.extractHints(priorityPass('024/088'));
  hints.mainTitle = 'Amagarga';
  hints.pokemonIdentity = {speciesId: 699, englishName: 'Aurorus', germanName: 'Amagarga', reliable: true,
    nameConfidence: 0.95};
  const queries = Api.buildPokemonTcgQueries(hints, '');
  assert.equal(queries[0], 'number:024');
  assert.equal(queries[1], 'number:24');
  assert.ok(queries.some(query => query.startsWith('name:')));
});

test('Collector und Setnummer dominieren Name, Angriff und sonstigen Fließtext', () => {
  const hints = Recognition.extractHints({passes: [
    ...priorityPass('050/195').passes,
    {variant: 'kopfzeile-original-0', region: 'TOP_HEADER', text: 'Raichu\nKP 120',
      lines: [{text: 'Raichu', y: 0.1}, {text: 'KP 120', y: 0.4}]},
    {variant: 'mitteltext-normal-0', region: 'MIDDLE_TEXT', text: 'Donnerschock 30',
      lines: [{text: 'Donnerschock 30', y: 0.5}]}
  ]});
  const right = Recognition.scorePokemonCandidate({tcg: 'pokemon', id: 'right', name: 'Raichu',
    number: '50', printedTotal: 195, hp: '120', attacks: [{name: 'Donnerschock', damage: '30'}]}, hints, '');
  const wrong = Recognition.scorePokemonCandidate({tcg: 'pokemon', id: 'wrong', name: 'Raichu',
    number: '51', printedTotal: 195, hp: '120', attacks: [{name: 'Donnerschock', damage: '30'}]}, hints, '');
  assert.equal(right.matchDetails.collector, 'match');
  assert.equal(wrong.matchDetails.collector, 'mismatch');
  assert.ok(right.identificationScore > wrong.identificationScore + 0.45);
});

test('native ROI ist fokussiert und der normale Scan führt Exact Lookup vor Full OCR aus', () => {
  const processor = fs.readFileSync(path.join(root,
    'app/src/main/java/de/pokefolio/app/CardImageProcessor.java'), 'utf8');
  const main = fs.readFileSync(path.join(root,
    'app/src/main/java/de/pokefolio/app/MainActivity.java'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app/src/main/assets/app.js'), 'utf8');
  assert.match(processor, /card\.getWidth\(\) \* 0\.72f/);
  assert.match(processor, /card\.getHeight\(\) \* 0\.80f/);
  assert.match(processor, /unterkante-idzone-original/);
  assert.match(main, /recognizePrimaryIdentifier/);
  const flow = app.slice(app.indexOf('async function runRecognition'), app.indexOf("$('#recognize').onclick"));
  assert.ok(flow.indexOf('nativePrimaryIdentifierOcr') < flow.indexOf('recognizeCardFeatures'));
  assert.ok(flow.indexOf('lookupCandidates(kind, hints') < flow.indexOf('recognizeCardFeatures'));
  assert.match(flow, /if \(!exactPrimaryIdentity\)/);
  assert.match(flow, /PRIMARY_IDENTIFIER_EARLY_EXIT/);
});

test('Debugdiagnose enthält ROI und alle geforderten Stufenzeiten', () => {
  const app = fs.readFileSync(path.join(root, 'app/src/main/assets/app.js'), 'utf8');
  for (const metric of ['cropMs', 'orientationMs', 'bottomLeftOcrMs',
    'collectorNumberParseMs', 'exactLookupMs', 'fallbackNameOcrMs',
    'artworkFallbackMs', 'totalRecognitionMs']) {
    assert.match(app, new RegExp(metric));
  }
  assert.match(app, /Priority ROI/);
  assert.match(app, /Bottom OCR/);
});

test('Parser bleibt für 10.000 Priority-ROI-Auswertungen deutlich unter dem OCR-Budget', () => {
  const started = performance.now();
  for (let index = 0; index < 10000; index++) {
    Recognition.parsePokemonCollectorText(index % 2 ? 'O24/O88 G' : '198 193 AR', {
      priorityRoi: true, sourceRegion: 'BOTTOM_LEFT_ID', y: 0.9
    });
  }
  const elapsed = performance.now() - started;
  console.log(`BOTTOM_LEFT_PARSER_PERF iterations=10000 totalMs=${elapsed.toFixed(2)} avgMs=${(elapsed / 10000).toFixed(5)}`);
  assert.ok(elapsed < 1000);
});
