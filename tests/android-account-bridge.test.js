'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(
  __dirname, '..', 'app', 'src', 'main', 'assets', 'android-account-bootstrap.js'), 'utf8');

const createContext = (nativeHost, status) => {
  const events = [];
  const window = {
    PokeNative: nativeHost,
    setTimeout,
    clearTimeout,
    dispatchEvent: event => events.push(event)
  };
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  nativeHost.getAccountStatus = () => JSON.stringify(status);
  const context = vm.createContext({window, CustomEvent, Map, Promise, Error, JSON, Date, Object});
  vm.runInContext(source, context);
  return {window, events};
};

test('Android account facade correlates native callbacks without browser token storage', async () => {
  let loginCall;
  const nativeHost = {
    loginAccount: (email, password, deviceName, requestId) => {
      loginCall = {email, password, deviceName, requestId};
    },
    registerAccount() {},
    requestPasswordReset() {},
    confirmPasswordReset() {},
    restoreAccountSession() {},
    logoutAccount() {}
  };
  const initial = {
    configured: false,
    authenticated: false,
    backendOrigin: null,
    configurationError: null,
    session: null
  };
  const {window, events} = createContext(nativeHost, initial);

  const pending = window.PokeAccount.login(
    'owner@example.test', 'valid-password', 'Pixel test');
  assert.equal(loginCall.email, 'owner@example.test');
  assert.match(loginCall.requestId, /^account-\d+-\d+$/);
  const response = {
    requestId: loginCall.requestId,
    operation: 'login',
    ok: true,
    status: {
      configured: true,
      authenticated: true,
      backendOrigin: 'https://api.example.test/',
      configurationError: null,
      session: {
        userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        accessTokenExpiresAt: '2030-01-01T00:00:00Z',
        device: {id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', platform: 'android'}
      }
    }
  };
  window.onAndroidAccountResult(JSON.stringify(response));

  assert.deepEqual(await pending, response);
  assert.equal(window.PokePlatform.kind, 'android');
  assert.equal(Object.isFrozen(window.PokeAccount), true);
  assert.equal(events.at(-1).type, 'pokefolio:account-state');
  assert.equal(events.at(-1).detail.status.session.userId, response.status.session.userId);
  assert.doesNotMatch(source, /localStorage|sessionStorage|Authorization|refreshToken/);
});

test('Android account facade forwards reset secrets only to the native one-shot call', async () => {
  const calls = [];
  const nativeHost = {
    registerAccount() {},
    loginAccount() {},
    requestPasswordReset: (email, requestId) => calls.push({email, requestId}),
    confirmPasswordReset: (email, token, password, requestId) =>
      calls.push({email, token, password, requestId}),
    restoreAccountSession() {},
    logoutAccount() {}
  };
  const status = {
    configured: false,
    authenticated: false,
    backendOrigin: null,
    configurationError: null,
    session: null
  };
  const {window} = createContext(nativeHost, status);

  const request = window.PokeAccount.requestPasswordReset('owner@example.test');
  window.onAndroidAccountResult(JSON.stringify({
    requestId: calls[0].requestId,
    operation: 'password-reset-request',
    ok: true,
    status
  }));
  assert.equal((await request).ok, true);

  const confirm = window.PokeAccount.confirmPasswordReset(
    'owner@example.test', 'reset-secret', 'replacement-password');
  window.onAndroidAccountResult(JSON.stringify({
    requestId: calls[1].requestId,
    operation: 'password-reset-confirm',
    ok: true,
    status
  }));
  assert.equal((await confirm).ok, true);
  assert.equal(calls[1].token, 'reset-secret');
  assert.equal(calls[1].password, 'replacement-password');
  assert.doesNotMatch(source, /localStorage|sessionStorage|Authorization|refreshToken/);
});

test('Android account facade forwards device management without browser credentials', async () => {
  const calls = [];
  const nativeHost = {
    registerAccount() {},
    loginAccount() {},
    requestPasswordReset() {},
    confirmPasswordReset() {},
    listAccountDevices: requestId => calls.push({operation: 'list', requestId}),
    revokeAccountDevice: (deviceId, requestId) =>
      calls.push({operation: 'revoke', deviceId, requestId}),
    revokeOtherAccountDevices: requestId => calls.push({operation: 'others', requestId}),
    restoreAccountSession() {},
    logoutAccount() {}
  };
  const status = {
    configured: true,
    authenticated: true,
    backendOrigin: 'https://api.example.test/',
    configurationError: null,
    session: {
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      device: {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
    }
  };
  const {window} = createContext(nativeHost, status);

  const listed = window.PokeAccount.listDevices();
  window.onAndroidAccountResult(JSON.stringify({
    requestId: calls[0].requestId,
    operation: 'devices-list',
    ok: true,
    status,
    devices: []
  }));
  assert.equal((await listed).ok, true);

  const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const revoked = window.PokeAccount.revokeDevice(target);
  window.onAndroidAccountResult(JSON.stringify({
    requestId: calls[1].requestId,
    operation: 'device-revoke',
    ok: true,
    status
  }));
  assert.equal((await revoked).ok, true);
  assert.equal(calls[1].deviceId, target);

  const others = window.PokeAccount.revokeOtherDevices();
  window.onAndroidAccountResult(JSON.stringify({
    requestId: calls[2].requestId,
    operation: 'devices-revoke-others',
    ok: true,
    status
  }));
  assert.equal((await others).ok, true);
  assert.doesNotMatch(source, /localStorage|sessionStorage|Authorization|refreshToken/);
});

test('Android bootstrap restores a configured session once and stays isolated on Windows', async () => {
  let restoreRequestId = '';
  const nativeHost = {
    registerAccount() {},
    loginAccount() {},
    requestPasswordReset() {},
    confirmPasswordReset() {},
    restoreAccountSession: requestId => { restoreRequestId = requestId; },
    logoutAccount() {}
  };
  const {window} = createContext(nativeHost, {
    configured: true,
    authenticated: false,
    backendOrigin: 'https://api.example.test/',
    configurationError: null,
    session: null
  });
  assert.match(restoreRequestId, /^account-\d+-\d+$/);
  window.onAndroidAccountResult(JSON.stringify({
    requestId: restoreRequestId,
    operation: 'restore',
    ok: false,
    status: window.PokeAccount.status(),
    problem: {status: 401, code: 'session_missing', title: 'No session'}
  }));
  await new Promise(resolve => setImmediate(resolve));

  const existingAccount = Object.freeze({status: () => 'windows'});
  const windows = {PokePlatform: {kind: 'windows'}, PokeAccount: existingAccount};
  vm.runInContext(source, vm.createContext({window: windows}));
  assert.equal(windows.PokeAccount, existingAccount);
  assert.equal(windows.PokePlatform.kind, 'windows');
});

test('Android index loads the account bootstrap before application startup', () => {
  const index = fs.readFileSync(path.join(
    __dirname, '..', 'app', 'src', 'main', 'assets', 'index.html'), 'utf8');
  assert.ok(index.indexOf('android-account-bootstrap.js') >= 0);
  assert.ok(index.indexOf('android-account-bootstrap.js') < index.indexOf('app.js'));
});
