const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../app/src/main/assets/api-core.js');

test('erzeugt nur robuste Pokémon-TCG-Abfragen ohne problematische Phrasen oder führende Wildcards', () => {
  const urls = api.buildPokemonTcgUrls({
    collectorNumbers: [{number: '025', total: '185'}],
    nameHints: [{value: 'Pikachu V'}, {value: 'Donnerschock'}]
  }, '');

  assert.ok(urls.some(url => url.includes('number%3A025')));
  assert.ok(urls.some(url => url.includes('number%3A25')));
  assert.ok(urls.some(url => url.includes('name%3Apikachu*')));
  assert.ok(urls.every(url => !url.includes('%22')));
  assert.ok(urls.every(url => !decodeURIComponent(url).includes('name:*')));
  assert.ok(urls.every(url => url.startsWith('https://api.pokemontcg.io/v2/cards?')));
  assert.ok(urls.every(url => url.includes('pageSize=100')));
  assert.ok(urls.every(url => url.includes('select=id,name,number,images,set,rarity,hp')));
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

test('erzeugt einen deutschsprachigen TCGdex-Ausweichweg für Name und Collector Number', () => {
  const urls = api.buildTcgdexUrls({
    collectorNumbers: [{number: '25', total: '185'}],
    nameHints: [{value: 'Glurak ex'}]
  }, '', 'de');
  assert.ok(urls.some(url => url.startsWith('https://api.tcgdex.net/v2/de/cards?')));
  assert.ok(urls.some(url => url.includes('name=Glurak+ex')));
  assert.ok(urls.some(url => url.includes('localId=25')));
  assert.ok(urls.every(url => url.includes('pagination%3AitemsPerPage=100')));
});
