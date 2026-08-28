const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../app/src/main/assets/api-core.js');

test('erzeugt nur robuste Pokémon-TCG-Abfragen ohne problematische Phrasen oder führende Wildcards', () => {
  const urls = api.buildPokemonTcgUrls({
    collectorNumbers: [{number: '025', total: '185'}],
    pokemonIdentity: {
      speciesId: 25, englishName: 'Pikachu', germanName: 'Pikachu',
      variant: 'V', nameConfidence: 0.98
    },
    nameHints: [{value: 'Pikachu V'}, {value: 'Donnerschock'}]
  }, '');

  assert.ok(urls.some(url => url.includes('number%3A025')));
  assert.ok(urls.some(url => url.includes('number%3A25')));
  assert.ok(urls.some(url => url.includes('name%3Apikachu')));
  assert.ok(urls.every(url => !url.includes('*')));
  assert.ok(urls.every(url => !url.includes('%22')));
  assert.ok(urls.every(url => !decodeURIComponent(url).includes('name:*')));
  assert.ok(urls.every(url => url.startsWith('https://api.pokemontcg.io/v2/cards?')));
  assert.ok(urls.every(url => url.includes('pageSize=100')));
  assert.ok(urls.every(url => url.includes('select=id,name,number,images,set,rarity,hp')));
  assert.ok(urls.every(url => url.includes('attacks,abilities')));
});

test('wiederholt HTTP 500 und 429 mit kurzem Backoff bis eine Variante erfolgreich ist', async () => {
  const statuses = [500, 429];
  const delays = [];
  const logs = [];
  let calls = 0;
  const result = await api.requestJsonWithRetry('https://example.test/cards', async url => {
    calls++;
    const status = statuses.shift();
    if (status) throw api.createHttpError({url, status, body: `Fehler ${status}`});
    return {data: ['ok']};
  }, {
    attempts: 3,
    backoffMs: [25, 50],
    wait: async milliseconds => delays.push(milliseconds),
    logger: message => logs.push(message)
  });

  assert.deepEqual(result, {data: ['ok']});
  assert.equal(calls, 3);
  assert.deepEqual(delays, [25, 50]);
  assert.match(logs[0], /URL=https:\/\/example\.test\/cards Status=500 .*Body=Fehler 500/);
  assert.match(logs[1], /Status=429 .*Body=Fehler 429/);
});

test('wiederholt nicht bei fachlichen HTTP-4xx-Fehlern', async () => {
  let calls = 0;
  await assert.rejects(api.requestJsonWithRetry('https://example.test/cards', async url => {
    calls++;
    throw api.createHttpError({url, status: 400, body: '{"error":"bad query"}'});
  }, {attempts: 3, wait: async () => {}, logger: () => {}}), error => {
    assert.equal(error.status, 400);
    assert.match(error.body, /bad query/);
    return true;
  });
  assert.equal(calls, 1);
});

test('wiederholt transiente Netzwerk- und Timeoutfehler, aber keine Parsingfehler', async () => {
  let networkCalls = 0;
  const result = await api.requestJsonWithRetry('https://example.test/cards', async url => {
    networkCalls++;
    if (networkCalls === 1) {
      throw api.createHttpError({url, status: 0, kind: 'network', error: 'DNS fehlgeschlagen'});
    }
    return [];
  }, {attempts: 3, backoffMs: [10, 20], wait: async () => {}, logger: () => {}});
  assert.deepEqual(result, []);
  assert.equal(networkCalls, 2);

  let parseCalls = 0;
  await assert.rejects(api.requestJsonWithRetry('https://example.test/cards', async url => {
    parseCalls++;
    throw api.createHttpError({url, status: 200, kind: 'parse', body: '<html>', error: 'Ungültiges JSON'});
  }, {attempts: 3, wait: async () => {}, logger: () => {}}), error => error.kind === 'parse');
  assert.equal(parseCalls, 1);
});

test('wertet erfolgreiche Suchvarianten trotz eines einzelnen HTTP-Fehlers weiter aus', async () => {
  const result = await api.settleSearchVariants(
    ['https://example.test/fail', 'https://example.test/good'],
    async url => {
      if (url.endsWith('/fail')) throw api.createHttpError({url, status: 500, body: 'upstream'});
      return {data: [{id: 'correct'}]};
    },
    {attempts: 1, logger: () => {}}
  );

  assert.equal(result.successCount, 1);
  assert.equal(result.unavailable, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.values[0].value.data[0].id, 'correct');
});

test('markiert den Dienst erst als nicht erreichbar, wenn alle Varianten scheitern', async () => {
  const result = await api.settleSearchVariants(
    ['https://example.test/a', 'https://example.test/b'],
    async url => { throw api.createHttpError({url, status: 503, body: 'maintenance'}); },
    {attempts: 1, logger: () => {}}
  );
  assert.equal(result.unavailable, true);
  assert.equal(result.errors.length, 2);
});

test('unterscheidet 0 Treffer von Netzwerk-, HTTP-, Parsing- und Konfigurationsfehlern', async () => {
  const empty = await api.settleSearchVariants(
    ['https://example.test/empty'], async () => [], {attempts: 1, logger: () => {}}
  );
  assert.equal(empty.unavailable, false);
  assert.equal(empty.successCount, 1);
  assert.equal(empty.resultCount, 0);
  assert.equal(api.summarizeSearchFailure([empty]).kind, 'empty');

  const failure = kind => ({
    requestedCount: 1,
    successCount: 0,
    resultCount: 0,
    errors: [{kind, status: kind === 'http' ? 503 : kind === 'parse' ? 200 : 0}]
  });
  assert.equal(api.summarizeSearchFailure([failure('network')]).kind, 'network');
  assert.equal(api.summarizeSearchFailure([failure('timeout')]).kind, 'timeout');
  assert.equal(api.summarizeSearchFailure([failure('http')]).kind, 'http');
  assert.equal(api.summarizeSearchFailure([failure('parse')]).kind, 'parse');
  assert.equal(api.summarizeSearchFailure([failure('allowlist')]).kind, 'configuration');
});

test('erzeugt einen deutschsprachigen TCGdex-Ausweichweg für Name und Collector Number', () => {
  const urls = api.buildTcgdexUrls({
    collectorNumbers: [{number: '25', total: '185'}],
    pokemonIdentity: {
      speciesId: 6, englishName: 'Charizard', germanName: 'Glurak',
      variant: 'ex', nameConfidence: 0.98
    },
    nameHints: [{value: 'Glurak ex'}]
  }, '', 'de');
  assert.ok(urls.some(url => url.startsWith('https://api.tcgdex.net/v2/de/cards?')));
  assert.ok(urls.some(url => url.includes('name=Glurak+ex')));
  assert.ok(urls.some(url => url.includes('localId=25')));
  assert.ok(urls.some(url => /cards\?localId=25/.test(url)));
  assert.ok(urls.every(url => url.includes('pagination%3AitemsPerPage=100')));
});

test('erzeugt regionale TCGdex-Abfragen für japanische und traditionelle chinesische Karten', () => {
  const hints = {
    cardType: 'pokemon',
    collectorNumbers: [{number: '025', total: '165'}],
    pokemonIdentity: {}
  };
  const japanese = api.buildTcgdexUrls(hints, 'ピカチュウ', 'ja');
  const traditional = api.buildTcgdexUrls(hints, '皮卡丘', 'zh-TW');
  assert.ok(japanese.some(url => url.startsWith('https://api.tcgdex.net/v2/ja/cards?')));
  assert.ok(japanese.some(url => url.includes('name=%E3%83%94%E3%82%AB%E3%83%81%E3%83%A5%E3%82%A6')));
  assert.ok(traditional.some(url => url.startsWith('https://api.tcgdex.net/v2/zh-tw/cards?')));
});

test('nutzt eine reine TCGdex-Collector-Suche nur ohne verlässlichen Namen', () => {
  const urls = api.buildTcgdexUrls({collectorNumbers: [{number: '48', total: '72'}]}, '', 'de');
  assert.ok(urls.some(url => url.includes('/de/cards?localId=48')));
});

test('behält Variantenmerkmale für TCGdex, sucht die Primär-API aber über die validierte Art', () => {
  const hints = {
    collectorNumbers: [],
    pokemonIdentity: {
      speciesId: 151, englishName: 'Mew', germanName: 'Mew',
      variant: 'VMAX', nameConfidence: 0.97
    },
    validatedNameHints: [{value: 'Mew VMAX', baseName: 'Mew', variant: 'VMAX'}],
    nameHints: [{value: 'Mew VMAX'}, {value: 'Genome Hacking'}]
  };
  const primary = api.buildPokemonTcgUrls(hints, '');
  const localized = api.buildTcgdexUrls(hints, '', 'de');

  assert.ok(primary.some(url => url.includes('name%3Amew')));
  assert.ok(primary.every(url => !url.includes('name%3Avmax')));
  assert.ok(localized.some(url => url.includes('name=Mew+VMAX')));
});

test('verwendet unvalidierte Angriffswörter nicht als automatische Pokémon-Suchnamen', () => {
  const urls = api.buildPokemonTcgUrls({
    collectorNumbers: [],
    nameHints: [{value: 'Mondscheinklinge'}, {value: 'Horrorblick'}],
    validatedNameHints: []
  }, '');

  assert.deepEqual(urls, []);
});

test('startet bei einem unsicheren Fuzzy-Namen keine automatische Namenssuche', () => {
  const urls = api.buildPokemonTcgUrls({
    collectorNumbers: [],
    pokemonIdentity: {
      speciesId: 197,
      englishName: 'Umbreon',
      germanName: 'Nachtara',
      variant: 'V',
      nameConfidence: 0.79,
      reliable: false
    },
    validatedNameHints: [{
      value: 'Nachtaro V',
      baseName: 'Nachtara',
      variant: 'V',
      confidence: 0.79
    }]
  }, '');

  assert.deepEqual(urls, []);
});

test('sucht deutsche Trainerkarten zuerst per exakter Footer-Nummer und bestätigt mit Haupttitel', () => {
  const hints = {
    cardType: 'trainer',
    mainTitle: 'Befehl vom Boss',
    titleConfidence: 0.97,
    language: 'de',
    collectorNumbers: [{number: '132', total: '172', votes: 3.5}],
    pokemonIdentity: {},
    validatedNameHints: []
  };
  const tcgdex = api.buildTcgdexUrls(hints, '', 'de');
  const fallback = api.buildPokemonTcgUrls(hints, '');

  assert.match(tcgdex[0], /\/v2\/de\/cards\?localId=132&/);
  assert.ok(tcgdex.some(url => url.includes('name=Befehl+vom+Boss') && url.includes('localId=132')));
  assert.ok(tcgdex.some(url => url.includes('name=Befehl+vom+Boss')));
  assert.deepEqual(fallback.map(url => new URL(url).searchParams.get('q')), ['number:132']);
  assert.ok(fallback.every(url => url.includes('supertype')));
  assert.ok(fallback.every(url => !url.toLocaleLowerCase().includes('zyrus')));
});
