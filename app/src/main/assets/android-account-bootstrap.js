(() => {
  'use strict';

  if (window.PokePlatform && window.PokePlatform.kind === 'windows') return;
  if (window.PokeAccount) return;
  const nativeHost = window.PokeNative;
  if (!nativeHost || typeof nativeHost.getAccountStatus !== 'function') return;

  window.PokePlatform = Object.freeze({kind: 'android', host: 'webview', mobile: true});
  let requestSequence = 1;
  const pending = new Map();
  const parsePayload = json => JSON.parse(String(json || '{}'));

  const request = invoke => new Promise((resolve, reject) => {
    if (pending.size >= 8) {
      reject(new Error('Zu viele Kontoaktionen laufen gleichzeitig.'));
      return;
    }
    const requestId = `account-${Date.now()}-${requestSequence++}`;
    const timeout = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Das PokeFolio-Backend antwortet nicht.'));
    }, 30000);
    pending.set(requestId, response => {
      window.clearTimeout(timeout);
      resolve(response);
    });
    try {
      invoke(requestId);
    } catch (error) {
      window.clearTimeout(timeout);
      pending.delete(requestId);
      reject(error);
    }
  });

  window.onAndroidAccountResult = json => {
    const response = parsePayload(json);
    const complete = pending.get(response.requestId);
    if (complete) {
      pending.delete(response.requestId);
      complete(response);
    }
    window.dispatchEvent(new CustomEvent('pokefolio:account-state', {detail: response}));
  };

  const account = Object.freeze({
    status: () => parsePayload(nativeHost.getAccountStatus()),
    register: (email, password, deviceName) => request(requestId =>
      nativeHost.registerAccount(email, password, deviceName, requestId)),
    login: (email, password, deviceName) => request(requestId =>
      nativeHost.loginAccount(email, password, deviceName, requestId)),
    requestPasswordReset: email => request(requestId =>
      nativeHost.requestPasswordReset(email, requestId)),
    confirmPasswordReset: (email, token, newPassword) => request(requestId =>
      nativeHost.confirmPasswordReset(email, token, newPassword, requestId)),
    restore: () => request(requestId => nativeHost.restoreAccountSession(requestId)),
    logout: () => request(requestId => nativeHost.logoutAccount(requestId))
  });
  Object.defineProperty(window, 'PokeAccount', {
    configurable: false, enumerable: true, writable: false, value: account
  });

  const initialStatus = account.status();
  window.dispatchEvent(new CustomEvent('pokefolio:account-state', {
    detail: {requestId: '', operation: 'status', ok: true, status: initialStatus}
  }));
  if (initialStatus.configured && !initialStatus.authenticated) {
    account.restore().catch(error => {
      window.dispatchEvent(new CustomEvent('pokefolio:account-state', {
        detail: {requestId: '', operation: 'restore', ok: false, error: error.message}
      }));
    });
  }
})();
