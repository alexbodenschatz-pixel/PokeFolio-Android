'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bootstrapPath = path.join(
  __dirname,
  '..',
  'windows',
  'PokeFolio.Desktop',
  'WebHost',
  'desktop-bootstrap.js'
);
const cloudBootstrapPath = path.join(
  __dirname, '..', 'app', 'src', 'main', 'assets', 'cloud-bootstrap.js');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const cloudBootstrap = fs.readFileSync(cloudBootstrapPath, 'utf8');

function createRuntime(nativeOverrides = {}) {
  const events = [];
  const nativeHost = {
    getAccountStatus: () => JSON.stringify({configured: false, authenticated: false}),
    registerAccount: () => {},
    loginAccount: () => {},
    requestPasswordReset: () => {},
    confirmPasswordReset: () => {},
    restoreAccountSession: () => {},
    logoutAccount: () => {},
    resolveCatalogCard: () => {},
    getCatalogCard: () => {},
    pushSyncOperations: () => {},
    pullSyncChanges: () => {},
    ...nativeOverrides
  };
  const window = {
    chrome: {webview: {hostObjects: {sync: {PokeNative: nativeHost}}}},
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    dispatchEvent: event => events.push(event)
  };
  window.window = window;
  const context = {
    window,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    Date,
    JSON,
    Map,
    Number,
    Object,
    Promise,
    TypeError,
    RangeError,
    String
  };
  vm.runInNewContext(bootstrap, context, {filename: bootstrapPath});
  vm.runInNewContext(cloudBootstrap, context, {filename: cloudBootstrapPath});
  return {window, nativeHost, events};
}

test('Windows Konto-Fassade korreliert Reset-Aufrufe ohne Browser-Persistenz', async () => {
  const calls = [];
  const runtime = createRuntime({
    requestPasswordReset(email, requestId) {
      calls.push({email, requestId});
    },
    confirmPasswordReset(email, token, password, requestId) {
      calls.push({email, token, password, requestId});
    }
  });
  const status = {configured: true, authenticated: false, session: null};

  const request = runtime.window.PokeAccount.requestPasswordReset('owner@example.test');
  runtime.window.onDesktopAccountResult(JSON.stringify({
    requestId: calls[0].requestId,
    operation: 'password-reset-request',
    ok: true,
    status
  }));
  assert.equal((await request).ok, true);

  const confirm = runtime.window.PokeAccount.confirmPasswordReset(
    'owner@example.test', 'one-shot-reset-token', 'replacement-password');
  runtime.window.onDesktopAccountResult(JSON.stringify({
    requestId: calls[1].requestId,
    operation: 'password-reset-confirm',
    ok: true,
    status
  }));
  assert.equal((await confirm).ok, true);
  assert.equal(calls[1].token, 'one-shot-reset-token');
  assert.equal(calls[1].password, 'replacement-password');
  assert.doesNotMatch(bootstrap, /localStorage|sessionStorage|Authorization|refreshToken/);
});

test('Windows Katalog-Fassade normalisiert Kartenreferenz und ordnet Callback zu', async () => {
  let nativeCall;
  const runtime = createRuntime({
    resolveCatalogCard(json, requestId) {
      nativeCall = {json, requestId};
    }
  });

  const pending = runtime.window.PokeCatalog.resolve({
    provider: ' TCGDEX ',
    providerCardId: ' SV8-141 ',
    tcg: ' POKEMON ',
    name: ' Pikachu ex ',
    setCode: ' SV8 ',
    number: ' 219/191 '
  });
  assert.deepEqual(JSON.parse(nativeCall.json), {
    provider: 'tcgdex',
    providerCardId: 'sv8-141',
    tcg: 'pokemon',
    name: 'Pikachu ex',
    setCode: 'SV8',
    number: '219/191'
  });
  assert.match(nativeCall.requestId, /^catalog-/);

  runtime.window.onPokeCatalogResult(JSON.stringify({
    requestId: nativeCall.requestId,
    operation: 'resolve',
    ok: true,
    status: 201,
    data: {
      card: {id: 'cccccccc-cccc-cccc-cccc-cccccccccccc'},
      created: true,
      metadataMatched: true
    },
    problem: null
  }));

  const response = await pending;
  assert.equal(response.data.card.id, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  assert.equal(runtime.events.at(-1).type, 'pokefolio:catalog-result');
  assert.equal(Object.isFrozen(runtime.window.PokeCatalog), true);
});

test('Windows Katalog-Fassade validiert UUID und Provider vor dem nativen Aufruf', async () => {
  let nativeCalls = 0;
  const runtime = createRuntime({
    resolveCatalogCard() {
      nativeCalls += 1;
    },
    getCatalogCard() {
      nativeCalls += 1;
    }
  });

  await assert.rejects(runtime.window.PokeCatalog.resolve(null), /Objekt/);
  await assert.rejects(runtime.window.PokeCatalog.resolve({
    provider: 'tcgdex',
    providerCardId: '../bad?query',
    tcg: 'pokemon',
    name: 'Pikachu',
    setCode: 'SV8',
    number: '141/191'
  }), /ungültige Zeichen/);
  await assert.rejects(runtime.window.PokeCatalog.resolve({
    provider: 'ygoprodeck',
    providerCardId: '1234',
    tcg: 'pokemon',
    name: 'Card',
    setCode: 'LOB',
    number: '001'
  }), /passen nicht zusammen/);
  await assert.rejects(runtime.window.PokeCatalog.get(
    '00000000-0000-0000-0000-000000000000'), /UUID/);
  await assert.rejects(runtime.window.PokeCatalog.get('not-a-uuid'), /UUID/);
  await assert.rejects(runtime.window.PokeCatalog.get({id: 'not-a-string'}), /UUID/);
  assert.equal(nativeCalls, 0);
});

test('Windows Katalog-Fassade lädt eine validierte globale Karten-ID', async () => {
  let nativeCall;
  const runtime = createRuntime({
    getCatalogCard(cardId, requestId) {
      nativeCall = {cardId, requestId};
    }
  });

  const pending = runtime.window.PokeCatalog.get(
    'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC');
  assert.equal(nativeCall.cardId, 'cccccccc-cccc-cccc-cccc-cccccccccccc');

  runtime.window.onPokeCatalogResult(JSON.stringify({
    requestId: nativeCall.requestId,
    operation: 'get',
    ok: true,
    status: 200,
    data: {id: nativeCall.cardId},
    problem: null
  }));
  const response = await pending;
  assert.equal(response.data.id, nativeCall.cardId);
});

test('Windows Sync-Transport serialisiert Batch und ordnet strukturierten Callback zu', async () => {
  let nativeCall;
  const runtime = createRuntime({
    pushSyncOperations(json, requestId) {
      nativeCall = {json, requestId};
    }
  });

  const pending = runtime.window.PokeSyncTransport.push({operations: []});
  assert.deepEqual(JSON.parse(nativeCall.json), {operations: []});
  assert.match(nativeCall.requestId, /^sync-/);

  runtime.window.onPokeSyncResult(JSON.stringify({
    requestId: nativeCall.requestId,
    operation: 'push',
    ok: true,
    status: 200,
    data: {results: []},
    problem: null
  }));

  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.data.results.length, 0);
  assert.equal(runtime.events.at(-1).type, 'pokefolio:sync-result');
  assert.equal(Object.isFrozen(runtime.window.PokeSyncTransport), true);
});

test('Windows Sync-Transport reicht opaken Cursor und Seitengröße unverändert durch', async () => {
  let nativeCall;
  const runtime = createRuntime({
    pullSyncChanges(cursor, limit, requestId) {
      nativeCall = {cursor, limit, requestId};
    }
  });

  const pending = runtime.window.PokeSyncTransport.pull('opaque+/cursor=', 250);
  assert.equal(nativeCall.cursor, 'opaque+/cursor=');
  assert.equal(nativeCall.limit, 250);

  runtime.window.onPokeSyncResult(JSON.stringify({
    requestId: nativeCall.requestId,
    operation: 'pull',
    ok: true,
    status: 200,
    data: {changes: [], nextCursor: 'next', hasMore: false},
    problem: null
  }));

  const response = await pending;
  assert.equal(response.data.nextCursor, 'next');
});

test('Windows Sync-Transport lehnt ungültige Eingaben vor dem nativen Aufruf ab', async () => {
  let nativeCalls = 0;
  const runtime = createRuntime({
    pushSyncOperations() {
      nativeCalls += 1;
    },
    pullSyncChanges() {
      nativeCalls += 1;
    }
  });

  await assert.rejects(runtime.window.PokeSyncTransport.push(null), /Sync-Batch/);
  await assert.rejects(runtime.window.PokeSyncTransport.push([]), /Sync-Batch/);
  await assert.rejects(runtime.window.PokeSyncTransport.pull(null, 0), /zwischen 1 und 500/);
  await assert.rejects(runtime.window.PokeSyncTransport.pull({cursor: 'wrong'}, 100), /Cursor/);
  assert.equal(nativeCalls, 0);
});
