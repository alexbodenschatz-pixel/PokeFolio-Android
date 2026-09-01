(() => {
  'use strict';

  const nativeHost = window.chrome && window.chrome.webview
    && window.chrome.webview.hostObjects
    && window.chrome.webview.hostObjects.sync
    && window.chrome.webview.hostObjects.sync.PokeNative;
  if (!nativeHost) return;

  Object.defineProperty(window, 'PokeNative', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: nativeHost
  });
  window.PokePlatform = Object.freeze({kind: 'windows', host: 'webview2', desktop: true});

  window.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'https://desktop.pokefolio.local/desktop.css';
    document.head.appendChild(style);

    const main = document.querySelector('main');
    const headerActions = document.querySelector('.header-actions');
    if (!main || !headerActions) return;

    const launch = document.createElement('button');
    launch.type = 'button';
    launch.className = 'pf-desktop-launch';
    launch.textContent = 'EOS Studio';
    headerActions.prepend(launch);

    const studio = document.createElement('section');
    studio.id = 'eosStudio';
    studio.className = 'page pf-eos-studio';
    studio.innerHTML = `
      <div class="pf-eos-heading">
        <div><span class="section-kicker">Desktop Capture</span><h1>EOS Studio</h1></div>
        <button type="button" class="secondary compact" data-eos-close>Zurück</button>
      </div>
      <p class="muted">Vorbereitete Aufnahmezentrale für Dateiimport und die spätere Canon-EOS-2000D-Anbindung.</p>
      <div class="pf-eos-status card">
        <div><span class="section-kicker">Kamerastatus</span><b data-eos-status>Kamera getrennt</b><small data-eos-status-detail>Canon EDSDK ist nicht installiert.</small></div>
        <span class="status neutral" data-eos-badge>Getrennt</span>
      </div>
      <div class="pf-eos-grid">
        <section class="pf-live-view card">
          <div class="pf-live-toolbar"><b>Live View</b><span data-eos-mode>Vorderseite</span></div>
          <div class="pf-live-canvas">
            <img data-eos-preview alt="Importiertes Kartenbild" hidden>
            <div data-eos-placeholder><span>EOS</span><b>Kein Live-Bild</b><small>Dateiimport ist bereits nutzbar. Live View folgt mit Canon EDSDK.</small></div>
          </div>
          <div class="pf-capture-sides" role="group" aria-label="Kartenseite">
            <button type="button" class="active" data-eos-side="front">Vorderseite</button>
            <button type="button" data-eos-side="back">Rückseite</button>
          </div>
          <div class="pf-eos-actions">
            <button type="button" class="primary" data-eos-capture>Bild importieren</button>
            <button type="button" class="secondary" data-eos-bulk>Bulk Scan</button>
            <button type="button" class="secondary" data-eos-precision>Precision Scan</button>
          </div>
        </section>
        <aside class="pf-eos-sidebar">
          <section class="card"><span class="section-kicker">Auto-Capture</span><h2>Bereit für Erweiterung</h2><p>Stabilität, Kartenkontur und automatisches Auslösen werden über <code>ICardCaptureDevice</code> angebunden.</p><button type="button" class="secondary" disabled>Auto-Capture aktivieren</button></section>
          <section class="card"><span class="section-kicker">Kartenstatus</span><div data-eos-card-status class="status neutral">Noch keine Aufnahme</div><p data-eos-card-detail>Front oder Back aus einer Bilddatei laden.</p></section>
          <section class="card"><span class="section-kicker">Scan-Verlauf</span><ol class="pf-scan-history" data-eos-history><li>Noch keine Desktop-Aufnahme</li></ol></section>
        </aside>
      </div>`;
    main.appendChild(studio);

    let side = 'front';
    let mode = 'single';
    const showStudio = () => {
      document.querySelectorAll('main > .page').forEach(page => page.classList.remove('active'));
      document.querySelectorAll('nav [data-page]').forEach(button => button.classList.remove('active'));
      studio.classList.add('active');
      window.scrollTo({top: 0, behavior: 'smooth'});
    };
    launch.addEventListener('click', showStudio);
    studio.querySelector('[data-eos-close]').addEventListener('click', () => {
      const home = document.querySelector('nav [data-page="home"]');
      if (home) home.click();
      else {
        studio.classList.remove('active');
        document.getElementById('home')?.classList.add('active');
      }
    });

    studio.querySelectorAll('[data-eos-side]').forEach(button => button.addEventListener('click', () => {
      studio.querySelectorAll('[data-eos-side]').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      side = button.dataset.eosSide || 'front';
      studio.querySelector('[data-eos-mode]').textContent = side === 'back' ? 'Rückseite' : 'Vorderseite';
    }));

    const requestImport = requestedMode => {
      mode = requestedMode;
      const requestId = `desktop-${requestedMode}-${Date.now()}`;
      window.PokeNative.selectImage(requestId, requestedMode === 'bulk' ? 'bulk' : side);
      studio.querySelector('[data-eos-card-status]').textContent = 'Bildauswahl geöffnet';
      studio.querySelector('[data-eos-card-detail]').textContent = requestedMode === 'precision'
        ? 'Precision Scan: hochwertige Front-/Back-Datei auswählen.'
        : requestedMode === 'bulk'
          ? 'Bulk Scan: Vorderseite auswählen.'
          : 'Kartenbild auswählen.';
    };
    studio.querySelector('[data-eos-capture]').addEventListener('click', () => requestImport('single'));
    studio.querySelector('[data-eos-bulk]').addEventListener('click', () => requestImport('bulk'));
    studio.querySelector('[data-eos-precision]').addEventListener('click', () => requestImport('precision'));

    try {
      const devices = JSON.parse(window.PokeNative.getCaptureDevices() || '[]');
      const eos = devices.find(device => device.id === 'canon-eos');
      if (eos) studio.querySelector('[data-eos-status-detail]').textContent = eos.message;
    } catch (error) {
      console.warn('[PokeFolio Desktop] Capture-Gerätestatus nicht verfügbar:', error);
    }

    window.onDesktopImageSelected = json => {
      const response = JSON.parse(json);
      if (!response.ok) {
        if (!response.cancelled) studio.querySelector('[data-eos-card-detail]').textContent = response.error || 'Bildimport fehlgeschlagen.';
        return;
      }
      const preview = studio.querySelector('[data-eos-preview]');
      preview.src = response.dataUrl;
      preview.hidden = false;
      studio.querySelector('[data-eos-placeholder]').hidden = true;
      studio.querySelector('[data-eos-card-status]').className = 'status good';
      studio.querySelector('[data-eos-card-status]').textContent = 'Kartenbild übernommen';
      studio.querySelector('[data-eos-card-detail]').textContent = `${response.fileName || 'Bild'} · ${mode === 'bulk' ? 'Bulk Scan' : mode === 'precision' ? 'Precision Scan' : side === 'back' ? 'Rückseite' : 'Vorderseite'}`;
      const history = studio.querySelector('[data-eos-history]');
      if (history.children.length === 1 && /Noch keine/.test(history.firstElementChild.textContent)) history.textContent = '';
      const item = document.createElement('li');
      item.textContent = `${new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} · ${response.fileName || 'Bildimport'}`;
      history.prepend(item);
      window.dispatchEvent(new CustomEvent('pokefolio:desktop-image-imported', {detail: response}));
    };
  });
})();
