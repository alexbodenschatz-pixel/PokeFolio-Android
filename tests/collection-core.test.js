'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Collection = require('../app/src/main/assets/collection-core.js');

function card(overrides = {}) {
  return {
    id: overrides.id || Math.random(),
    tcg: 'pokemon',
    name: 'Gaunux',
    set: 'Karmesin & Purpur',
    setId: 'sv01',
    number: '096/198',
    lang: 'de',
    printingVariant: 'normal',
    ...overrides
  };
}

test('fasst fünf physisch nacheinander gescannte gleiche Karten zu quantity 5 zusammen', () => {
  let collection = [];
  let lock = Collection.createScanLock(1000);
  for (let copy = 0; copy < 5; copy++) {
    lock = Collection.markCardRemoved(lock);
    const incoming = card({id: copy + 1});
    const gate = Collection.registerScan(lock, Collection.collectionKey(incoming), copy * 2000 + 1000);
    assert.equal(gate.accepted, true);
    lock = gate.lock;
    collection = Collection.upsertCollection(collection, incoming).collection;
  }
  assert.equal(collection.length, 1);
  assert.equal(collection[0].quantity, 5);
});

test('zählt dieselbe im Rahmen verbleibende Karte unabhängig vom Timer nur einmal', () => {
  const item = card();
  const key = Collection.collectionKey(item);
  const first = Collection.registerScan(Collection.createScanLock(), key, 1000);
  const second = Collection.registerScan(first.lock, key, 4000);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'SAME_CARD_STILL_PRESENT');
});

test('akzeptiert die Folge Karte A, Karte B, Karte A als A=2 und B=1', () => {
  const a = card({id: 1});
  const b = card({id: 2, name: 'Pikachu', setId: 'sv03', set: '151', number: '025/165'});
  let collection = [];
  let lock = Collection.createScanLock();
  [a, b, {...a, id: 3}].forEach((item, index) => {
    const gate = Collection.registerScan(lock, Collection.collectionKey(item), 1000 + index * 1200);
    assert.equal(gate.accepted, true);
    lock = gate.lock;
    collection = Collection.upsertCollection(collection, item).collection;
  });
  assert.equal(collection.find(item => item.name === 'Gaunux').quantity, 2);
  assert.equal(collection.find(item => item.name === 'Pikachu').quantity, 1);
});

test('trennt gleichen Pokémon-Namen aus verschiedenen Sets', () => {
  const first = card({id: 1, name: 'Pikachu', setId: 'sv03', number: '025/165'});
  const second = card({id: 2, name: 'Pikachu', setId: 'sv08', number: '057/191'});
  let collection = Collection.upsertCollection([], first).collection;
  collection = Collection.upsertCollection(collection, second).collection;
  assert.equal(collection.length, 2);
  assert.notEqual(collection[0].collectionKey, collection[1].collectionKey);
});

test('trennt Normal und Reverse Holo derselben Drucknummer', () => {
  const normal = card({id: 1, printingVariant: 'normal'});
  const reverse = card({id: 2, printingVariant: 'reverse-holo'});
  let collection = Collection.upsertCollection([], normal).collection;
  collection = Collection.upsertCollection(collection, reverse).collection;
  assert.equal(collection.length, 2);
  assert.deepEqual(new Set(collection.map(item => item.printingVariant)), new Set(['normal', 'reverse-holo']));
});

test('normalisiert asiatische Sprachen und alle unterstützten Druckvarianten stabil', () => {
  assert.equal(Collection.normalizedLanguage({lang: 'ko'}), 'ko');
  assert.equal(Collection.normalizedLanguage({lang: 'zh-CN'}), 'zh-CN');
  assert.equal(Collection.normalizedLanguage({lang: 'zh-TW'}), 'zh-TW');
  assert.equal(Collection.normalizedVariant({variant: 'Special Illustration Rare'}), 'special-illustration-rare');
  assert.equal(Collection.normalizedVariant({variant: 'Alternate Art'}), 'alternate-art');
  assert.equal(Collection.normalizedVariant({rarity: 'Full Art Trainer'}), 'full-art');
  assert.equal(Collection.variantLabel('secret-rare'), 'Secret Rare');
});

test('verwendet für den Schlüssel dieselbe lokale Nummer bei 096 und 096/198', () => {
  const local = card({number: '096'});
  const printed = card({number: '096/198'});
  assert.equal(Collection.collectionKey(local), Collection.collectionKey(printed));
});

test('migriert alte Einträge ohne unbekannte Druckvarianten versehentlich zusammenzuführen', () => {
  const legacy = [
    card({id: 1, quantity: undefined, collectionKey: undefined, printingVariant: undefined}),
    card({id: 2, quantity: undefined, collectionKey: undefined, printingVariant: undefined}),
    {id: 3, tcg: 'pokemon', name: 'Unvollständiger Altbestand'}
  ];
  const migrated = Collection.migrateCollection(legacy);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.mergedCount, 0);
  assert.equal(migrated.collection.length, 3);
  assert.deepEqual(migrated.collection.filter(item => item.name === 'Gaunux').map(item => item.quantity), [1, 1]);
  assert.equal(migrated.collection.find(item => item.name === 'Unvollständiger Altbestand').quantity, 1);
});

test('führt nur Altbestände mit explizit gleicher Sprache und Druckvariante zusammen', () => {
  const migrated = Collection.migrateCollection([
    card({id: 1, quantity: undefined, collectionKey: undefined}),
    card({id: 2, quantity: undefined, collectionKey: undefined})
  ]);
  assert.equal(migrated.mergedCount, 1);
  assert.equal(migrated.collection.length, 1);
  assert.equal(migrated.collection[0].quantity, 2);
  assert.equal(migrated.collection[0].identityVerified, true);
});

test('liefert Mengenfilter und Setstatistik einschließlich Duplikaten', () => {
  const collection = [
    card({id: 1, quantity: 4}),
    card({id: 2, name: 'Koraidon', number: '125/198', quantity: 1}),
    card({id: 3, name: 'Pikachu', set: '151', setId: 'sv03', number: '025/165', quantity: 2})
  ];
  assert.equal(collection.filter(item => Collection.matchesFilters(item, {quantity: 'duplicates'})).length, 2);
  assert.equal(collection.filter(item => Collection.matchesFilters(item, {quantity: 'single'})).length, 1);
  assert.equal(collection.filter(item => Collection.matchesFilters(item, {quantity: 'threeplus'})).length, 1);
  const sets = Collection.summarizeSets(collection);
  const base = sets.find(group => group.setId === 'sv01');
  assert.equal(base.distinct, 2);
  assert.equal(base.total, 5);
  assert.deepEqual(base.cards.map(item => item.number), ['096/198', '125/198']);
});

test('migriert normale Scans als Einzelexemplare ohne Bulk-Stückzahlen oder Scan-Daten zu verlieren', () => {
  const legacy = card({
    id: 77,
    quantity: 3,
    front: {preview: 'front-small'},
    back: {preview: 'back-small'},
    score: 870,
    grade: 'NM',
    notes: 'Messekauf'
  });
  const migrated = Collection.migrateCollection([legacy]);
  const entry = migrated.collection[0];

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(entry.quantity, 3);
  assert.equal(entry.specimens.length, 1);
  assert.equal(entry.specimens[0].grade, 'NM');
  assert.equal(entry.specimens[0].notes, 'Messekauf');
  assert.deepEqual(entry.specimens[0].back, {preview: 'back-small'});
});

test('berechnet Portfolio-Wert, Gesamtmenge, verschiedene Karten und Duplikate getrennt', () => {
  const collection = [
    card({id: 1, quantity: 4, price: {value: 12.5, currency: 'EUR'}}),
    card({id: 2, name: 'Koraidon', number: '125/198', quantity: 1, price: {value: 3, currency: 'EUR'}})
  ];
  const summary = Collection.portfolioSummary(collection);
  assert.deepEqual(summary, {
    totalCards: 5,
    distinctCards: 2,
    duplicates: 3,
    estimatedValue: 53,
    favorites: 0,
    graded: 0
  });
});

test('berechnet Set-Fortschritt, Varianten und fehlende Nummern nach echter Setnummer', () => {
  const collection = [
    card({id: 1, number: '001/004', printedTotal: 4, quantity: 2, printingVariant: 'normal'}),
    card({id: 2, name: 'Karte 3', number: '003/004', printedTotal: 4, quantity: 1, printingVariant: 'reverse-holo'})
  ];
  const group = Collection.summarizeSets(collection)[0];
  assert.equal(group.ownedNumbers, 2);
  assert.equal(group.printedTotal, 4);
  assert.equal(group.completion, 0.5);
  assert.equal(group.total, 3);
  assert.equal(group.variants.normal, 1);
  assert.equal(group.variants.reverse, 1);
  assert.deepEqual(Collection.missingSetNumbers(group), ['002', '004']);
});

test('filtert Sammlung sofort nach Suche, Kartentyp, Variante, Wert, Favorit und Grading', () => {
  const collection = [
    card({id: 1, name: 'Damythir V', set: 'Astralglanz', number: '134/189', cardType: 'pokemon', printingVariant: 'holo',
      favorite: true, grade: 'NM', price: {value: 12.5}}),
    card({id: 2, name: 'Befehl vom Boss', number: '132/172', cardType: 'trainer', printingVariant: 'normal',
      price: {value: 2}})
  ].map((entry, index) => Collection.normalizeEntry(entry, index));
  const result = collection.filter(entry => Collection.matchesFilters(entry, {
    query: 'Damythir', cardType: 'pokemon', variant: 'holo', favorite: 'favorite',
    graded: 'graded', minValue: 10, maxValue: 20
  }));
  assert.deepEqual(result.map(entry => entry.name), ['Damythir V']);
  assert.deepEqual(collection.filter(entry => Collection.matchesFilters(entry, {
    query: 'Damythir 134 Astralglanz'
  })).map(entry => entry.name), ['Damythir V']);
});

test('liest deutsche und internationale Preisformate ohne Faktor-100-Fehler', () => {
  assert.equal(Collection.estimatedUnitValue({priceLabel: '12,50 €'}), 12.5);
  assert.equal(Collection.estimatedUnitValue({priceLabel: '$12.50'}), 12.5);
  assert.equal(Collection.estimatedUnitValue({priceLabel: '1.234,56 EUR'}), 1234.56);
  assert.equal(Collection.estimatedUnitValue({priceLabel: 'USD 1,234.56'}), 1234.56);
});

test('liefert für 1.000 und 5.000 Karten nur paginierte DOM-Chunks und sortiert stabil', () => {
  [100, 1000, 5000].forEach(size => {
    const collection = Array.from({length: size}, (_, index) => card({
      id: index + 1,
      name: `Karte ${String(index).padStart(4, '0')}`,
      setId: `set-${Math.floor(index / 200)}`,
      set: `Set ${Math.floor(index / 200)}`,
      number: `${String(index % 200 + 1).padStart(3, '0')}/200`,
      quantity: index % 5 + 1,
      date: new Date(2025, 0, 1, 0, 0, index % 60).toISOString()
    }));
    const view = Collection.collectionView(collection, {
      filters: {quantity: 'duplicates'}, sort: 'quantity-high', limit: 90
    });
    assert.ok(view.total > 0);
    assert.equal(view.cards.length, Math.min(90, view.total));
    assert.ok(view.cards.every(entry => entry.quantity >= 2));
    assert.ok(view.cards.every((entry, index, all) => !index || all[index - 1].quantity >= entry.quantity));
  });
});
