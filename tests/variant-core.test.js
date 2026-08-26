'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Variants = require('../app/src/main/assets/variant-core.js');
const Recognition = require('../app/src/main/assets/recognition-core.js');
const Collection = require('../app/src/main/assets/collection-core.js');

function starmie(overrides = {}) {
  return {
    id: 'swsh-test-055', tcg: 'pokemon', name: 'Starmie', set: 'Testset', setId: 'swsh-test',
    number: '055/100', language: 'de', rarity: 'Rare', availableVariants: ['normal', 'reverse-holo'],
    identificationScore: 0.97, confidence: 0.97, finalConfidence: 0.97,
    matchDetails: {name: 1, collector: 'match', set: 'match', artwork: 0.96, language: 'match'},
    ...overrides
  };
}

test('Starmie: sichere Kartenidentität bleibt bei offener Druckvariante bestätigt', () => {
  const candidate = starmie();
  candidate.variantResolution = Variants.resolve(candidate);
  const sameIdentityVariant = starmie({id: 'other-provider', identificationScore: 0.95,
    confidence: 0.95, variantResolution: candidate.variantResolution});
  const decision = Recognition.confidenceDecision([candidate, sameIdentityVariant]);

  assert.equal(decision.state, Variants.STATES.IDENTITY_CONFIRMED_VARIANT_UNCERTAIN);
  assert.equal(decision.identityConfirmed, true);
  assert.equal(decision.variantConfirmed, false);
  assert.equal(decision.margin, 1, 'gleiche Druckidentität ist kein Platz-2-Identitätskonkurrent');
});

test('Name plus Nummer plus Artwork bestätigt Identität unabhängig vom Variantenscore', () => {
  const candidate = starmie({identificationScore: 0.84, confidence: 0.48,
    printVariantScore: 0.20, variantResolution: {variant: 'unknown', confidence: 0.2,
      confirmed: false, options: ['normal', 'reverse-holo']}});
  const decision = Recognition.confidenceDecision([candidate, starmie({id: 'wrong', setId: 'other', number: '012/100',
    identificationScore: 0.42, confidence: 0.42, matchDetails: {name: 0.7, collector: 'mismatch', artwork: 0.4}})]);
  assert.equal(decision.state, Variants.STATES.IDENTITY_CONFIRMED_VARIANT_UNCERTAIN);
  assert.ok(decision.bestScore >= 0.84);
});

test('Normal, Holo und Reverse Holo werden nur bei bestätigter Auswahl eindeutig', () => {
  for (const value of ['normal', 'holo', 'reverse-holo']) {
    const selected = Variants.selectVariant(starmie({availableVariants: ['normal', 'holo', 'reverse-holo']}), value);
    const resolved = Variants.resolve(selected);
    assert.equal(resolved.confirmed, true);
    assert.equal(resolved.variant, value);
  }
});

test('unbekannte Variante wird niemals stillschweigend als Normal behandelt', () => {
  const resolved = Variants.resolve(starmie());
  assert.equal(resolved.variant, 'unknown');
  assert.equal(resolved.confirmed, false);
  assert.deepEqual(resolved.options, ['normal', 'reverse-holo']);
});

test('Spezialraritäten bieten keine unplausible universelle Variantenliste an', () => {
  assert.deepEqual(Variants.possibleVariants(starmie({availableVariants: [], rarity: 'Special Illustration Rare'})),
    ['special-illustration-rare']);
  assert.deepEqual(Variants.possibleVariants(starmie({availableVariants: [], rarity: 'Promo'})), ['promo']);
});

test('TCG-spezifische Resolver vermischen Pokémon, Yu-Gi-Oh! und One Piece nicht', () => {
  assert.deepEqual(Variants.possibleVariants({tcg: 'yugioh', rarity: 'Ultra Rare'}), ['ultra-rare']);
  assert.deepEqual(Variants.possibleVariants({tcg: 'onepiece', rarity: 'Manga Rare'}), ['manga-rare']);
  assert.deepEqual(Variants.possibleVariants({tcg: 'onepiece', rarity: 'Leader'}), ['normal', 'parallel']);
  assert.equal(Collection.variantLabel('Ultra Rare'), 'Ultra Rare');
});

test('Variantenauswahl wechselt auf einen vorhandenen variantenspezifischen Marktpreis', () => {
  const card = starmie({
    price: {value: 1, currency: 'EUR', source: 'Cardmarket'},
    pricesByVariant: {
      normal: {value: 1, currency: 'EUR', source: 'Cardmarket'},
      'reverse-holo': {value: 3.5, currency: 'EUR', source: 'Cardmarket'}
    }
  });
  const selected = Variants.selectVariant(card, 'reverse-holo');
  assert.equal(selected.price.value, 3.5);
  assert.equal(selected.price.variantSpecific, true);
});

test('Zurücksetzen auf unbekannte Variante zeigt keinen Preis einer zuvor gewählten Variante', () => {
  const selected = Variants.selectVariant(starmie({
    genericPrice: {value: 1, currency: 'EUR', source: 'Cardmarket'},
    pricesByVariant: {'reverse-holo': {value: 3.5, currency: 'EUR', source: 'Cardmarket'}}
  }), 'reverse-holo');
  const reset = Variants.selectVariant(selected, 'unknown');
  assert.equal(reset.printingVariant, 'unknown');
  assert.equal(reset.variantSelectionConfirmed, false);
  assert.equal(reset.price.value, 1);
});

test('Normal und Reverse derselben Karte bleiben getrennte Sammlungseinträge', () => {
  let collection = Collection.upsertCollection([], Variants.selectVariant(starmie(), 'normal')).collection;
  collection = Collection.upsertCollection(collection, Variants.selectVariant(starmie({id: 'copy-2'}), 'reverse-holo')).collection;
  assert.equal(collection.length, 2);
  assert.notEqual(collection[0].collectionKey, collection[1].collectionKey);
});

test('Variantenänderung aktualisiert collectionKey und erhält Scans, Notizen und Stückzahl', () => {
  const original = Collection.normalizeEntry({...Variants.selectVariant(starmie(), 'normal'), id: 7,
    quantity: 3, collectionNotes: 'Testnotiz', specimens: [{id: 'copy-1', grade: 'NM'}]}, 0);
  const changed = Collection.changeVariant([original], 7, 'reverse-holo', {value: 4, currency: 'EUR'});
  assert.equal(changed.action, 'VARIANT_UPDATED');
  assert.match(changed.entry.collectionKey, /reverse-holo$/);
  assert.equal(changed.entry.quantity, 3);
  assert.equal(changed.entry.collectionNotes, 'Testnotiz');
  assert.equal(changed.entry.specimens[0].grade, 'NM');
  assert.equal(changed.entry.price.value, 4);
});

test('Variantenänderung führt ein vorhandenes Zielduplikat ohne Datenverlust zusammen', () => {
  const normal = Collection.normalizeEntry({...Variants.selectVariant(starmie(), 'normal'), id: 1,
    quantity: 2, collectionNotes: 'Normalnotiz', specimens: [{id: 'n1'}]}, 0);
  const reverse = Collection.normalizeEntry({...Variants.selectVariant(starmie(), 'reverse-holo'), id: 2,
    quantity: 4, favorite: true, specimens: [{id: 'r1'}]}, 1);
  const changed = Collection.changeVariant([normal, reverse], 1, 'reverse-holo');
  assert.equal(changed.action, 'VARIANT_MERGED');
  assert.equal(changed.collection.length, 1);
  assert.equal(changed.entry.quantity, 6);
  assert.equal(changed.entry.favorite, true);
  assert.deepEqual(new Set(changed.entry.specimens.map(item => item.id)), new Set(['n1', 'r1']));
});

test('bestätigte Variante macht aus bestätigter Identität den vollständigen Auto-Accept-Zustand', () => {
  const selected = Variants.selectVariant(starmie(), 'reverse-holo');
  selected.variantResolution = Variants.resolve(selected);
  const decision = Recognition.confidenceDecision([selected]);
  assert.equal(decision.state, Variants.STATES.IDENTITY_CONFIRMED_VARIANT_CONFIRMED);
  assert.equal(decision.autoAccept, true);
});

test('unsichere Kartenidentität bleibt unsicher, selbst wenn eine Variante gewählt wurde', () => {
  const selected = Variants.selectVariant(starmie({identificationScore: 0.52, confidence: 0.52,
    matchDetails: {name: 0.7, collector: 'unknown', set: 'unknown', artwork: 0.6}}), 'normal');
  selected.variantResolution = Variants.resolve(selected);
  const decision = Recognition.confidenceDecision([selected]);
  assert.equal(decision.state, Variants.STATES.IDENTITY_UNCERTAIN);
  assert.equal(decision.autoAccept, false);
});
