'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Recognition = require('../app/src/main/assets/recognition-core.js');
const Api = require('../app/src/main/assets/api-core.js');
const Asia = require('../app/src/main/assets/pokemon-asia-core.js');

function asiaHints(language, top, hp, bottomPasses) {
  return Recognition.extractHints({language, passes: [
    {variant: 'vollbild-0', region: 'WHOLE_CARD', text: '1200NE DeAGS\n©2025 Pokémon/Nintendo/Creatures/GAME FREAK',
      lines: [{text: '1200NE DeAGS', y: 0.44},
        {text: '©2025 Pokémon/Nintendo/Creatures/GAME FREAK', y: 0.94}]},
    {variant: 'kopfzeile-normal-0', region: 'TOP_HEADER', text: `${top}\nHP ${hp}`,
      lines: [{text: top, y: 0.10}, {text: `HP ${hp}`, y: 0.22}]},
    ...bottomPasses.map((text, index) => ({
      variant: `unterkante-metadata-${index}-0`, region: 'BOTTOM_METADATA', text,
      lines: [{text, y: 0.55}]
    }))
  ]});
}

test('Numel M2a 198/193 AR wird number-first kanonisch aufgelöst', () => {
  const hints = asiaHints('ja', 'ドンメル', '80', [
    'M2a I98/I93 AR', 'M2a 198/193 AR', '198/193 AR'
  ]);
  assert.equal(hints.script, 'Japanese');
  assert.equal(hints.language, 'ja');
  assert.equal(hints.localizedName, 'ドンメル');
  assert.equal(hints.mainTitle, 'ドンメル');
  assert.equal(hints.collectorNumbers[0].number, '198');
  assert.equal(hints.collectorNumbers[0].total, '193');
  assert.equal(hints.rarity, 'AR');
  assert.equal(hints.pokemonSetCodes[0].value, 'M2a');
  assert.notEqual(hints.mainTitle, '1200NE DeAGS');

  const regional = Asia.exactRegionalPrints(hints);
  assert.equal(regional.length, 1);
  assert.equal(regional[0].canonicalIdentity, 'Numel');
  assert.equal(regional[0].speciesId, 322);
  const ranked = Recognition.rankPokemonCandidates(regional.concat([
    {id: 'wrong', tcg: 'pokemon', name: 'Numel', canonicalIdentity: 'Numel', speciesId: 322,
      number: '10', printedTotal: 193, setId: 'M2a', rarity: 'AR', hp: '80', language: 'ja'}
  ]), hints, '', 10);
  assert.equal(ranked[0].id, 'regional:ja:M2a-198');
  assert.ok(ranked[0].identificationScore >= 0.94);
  assert.equal(ranked[0].matchDetails.asianNumberFirst, true);
});

test('Eternatus 151/208 R wird ohne verwertbaren Namens-OCR number-first aufgelöst', () => {
  const hints = asiaHints('zh-CN', 'MP', '150', [
    'CSV9C 151/2O8 R', 'CSV9C 151/208 R', '151/208 R'
  ]);
  assert.equal(hints.script, 'Chinese');
  assert.equal(hints.language, 'zh-CN');
  assert.equal(hints.collectorNumbers[0].number, '151');
  assert.equal(hints.collectorNumbers[0].total, '208');
  assert.equal(hints.rarity, 'R');
  assert.equal(hints.mainTitle, '');
  assert.notEqual(hints.mainTitle, 'MP');

  const regional = Asia.exactRegionalPrints(hints);
  assert.equal(regional.length, 1);
  assert.equal(regional[0].canonicalIdentity, 'Eternatus');
  assert.equal(regional[0].speciesId, 890);
  const scored = Recognition.scorePokemonCandidate(regional[0], hints, '');
  assert.ok(scored.identificationScore >= 0.94);
  assert.equal(scored.matchDetails.collector, 'match');
  assert.equal(scored.matchDetails.rarity, 'match');
  const traditional = Asia.exactRegionalPrints({...hints, language: 'zh-TW'});
  assert.equal(traditional[0].localizedName, '無極汰那');
  assert.equal(traditional[0].canonicalIdentity, 'Eternatus');
});

test('TCGdex fragt Set plus Nummer vor Namen ab und hält Collector-Fallback aktiv', () => {
  const hints = asiaHints('ja', 'ドンメル', '80', ['M2a 198/193 AR']);
  const urls = Api.buildTcgdexUrls(hints, '', 'ja');
  assert.equal(urls[0], 'https://api.tcgdex.net/v2/ja/cards/M2a-198');
  assert.match(urls[1], /\/ja\/cards\?localId=198/);
  assert.equal(Asia.retrievalStrategy(hints), 'NUMBER_FIRST');
});

test('deutsches Pikachu 049/195 behält seine sehr hohe Identität', () => {
  const hints = Recognition.extractHints({language: 'de', passes: [
    {variant: 'kopfzeile-normal-0', region: 'TOP_HEADER', text: 'Pikachu\nKP 70',
      lines: [{text: 'Pikachu', y: 0.1}, {text: 'KP 70', y: 0.22}]},
    {variant: 'unterkante-metadata-0', region: 'BOTTOM_METADATA', text: '049/195',
      lines: [{text: '049/195', y: 0.55}]}
  ]});
  const scored = Recognition.scorePokemonCandidate({tcg: 'pokemon', name: 'Pikachu',
    number: '49', printedTotal: 195, hp: '70', language: 'de'}, hints, '');
  assert.ok(scored.identificationScore >= 0.96);
});

test('native Asia-OCR ist footer-first und lässt Body-Multipass aus', () => {
  const root = path.join(__dirname, '..');
  const processor = fs.readFileSync(path.join(root,
    'app/src/main/java/de/pokefolio/app/CardImageProcessor.java'), 'utf8');
  const main = fs.readFileSync(path.join(root,
    'app/src/main/java/de/pokefolio/app/MainActivity.java'), 'utf8');
  assert.match(processor, /boolean asianPokemon/);
  assert.match(processor, /if \(asianPokemon\) \{[\s\S]*addCollectorOcrVariants[\s\S]*addHeaderOcrVariants/);
  assert.match(processor, /createProfileOcrVariants\([\s\S]*String language/);
  assert.match(main, /output\.optString\("language", "de"\)/);
});
