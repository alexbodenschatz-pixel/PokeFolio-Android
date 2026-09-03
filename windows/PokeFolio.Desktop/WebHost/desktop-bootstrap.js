(() => {
  'use strict';

  const nativeHost = window.chrome && window.chrome.webview
    && window.chrome.webview.hostObjects && window.chrome.webview.hostObjects.sync
    && window.chrome.webview.hostObjects.sync.PokeNative;
  if (!nativeHost) return;

  Object.defineProperty(window, 'PokeNative', {
    configurable: false, enumerable: true, writable: false, value: nativeHost
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
      <p class="muted">Datei- und EOS-Aufnahmen laufen durch dieselbe lokale Vision-, OCR- und Kartenlogik wie der gemeinsame PokéFolio-Core. Canon EDSDK bleibt eine optionale lokale Erweiterung.</p>
      <div class="pf-eos-status card">
        <div><span class="section-kicker">Kamerastatus</span><b data-eos-status>Wird geprüft …</b><small data-eos-status-detail></small></div>
        <span class="status neutral" data-eos-badge>Getrennt</span>
      </div>
      <div class="pf-eos-connect card">
        <label>Kamera<select data-eos-camera><option value="">Keine Kamera gefunden</option></select></label>
        <button type="button" class="secondary compact" data-eos-refresh>Aktualisieren</button>
        <button type="button" class="primary compact" data-eos-connect>Verbinden</button>
        <button type="button" class="secondary compact" data-eos-disconnect>Trennen</button>
      </div>
      <div class="pf-eos-grid">
        <section class="pf-live-view card">
          <div class="pf-live-toolbar"><b>Live View</b><span data-eos-side-label>Vorderseite</span></div>
          <div class="pf-live-canvas">
            <img data-eos-preview alt="EOS Live View oder importiertes Kartenbild" hidden>
            <div class="pf-live-card-guide" data-eos-guide hidden aria-hidden="true"></div>
            <div data-eos-placeholder><span>EOS</span><b>Kein Live-Bild</b><small>Bildimport ist immer verfügbar; EDSDK wird nur lokal und optional geladen.</small></div>
          </div>
          <div class="pf-live-controls">
            <button type="button" class="secondary compact" data-eos-live>Live View starten</button>
            <button type="button" class="primary compact" data-eos-shutter>EOS auslösen</button>
            <button type="button" class="secondary compact" data-eos-import>Bild importieren</button>
          </div>
          <div class="pf-mode-select" role="group" aria-label="Scanmodus">
            <button type="button" class="active" data-eos-scan-mode="quick">Quick</button>
            <button type="button" data-eos-scan-mode="bulk">Bulk</button>
            <button type="button" data-eos-scan-mode="precision">Precision</button>
          </div>
          <div class="pf-capture-sides" role="group" aria-label="Kartenseite">
            <button type="button" class="active" data-eos-side="front">Vorderseite</button>
            <button type="button" data-eos-side="back">Rückseite</button>
          </div>
        </section>
        <aside class="pf-eos-sidebar">
          <section class="card">
            <div class="pf-toggle-row"><div><span class="section-kicker">Auto-Capture</span><b>Stabile Karte automatisch aufnehmen</b></div><input type="checkbox" data-eos-auto></div>
            <p class="muted">Kontur und Stabilität werden nur im Vorschaupfad geprüft; OCR startet erst nach der Aufnahme.</p>
          </section>
          <section class="card pf-quality-panel">
            <span class="section-kicker">Aufnahmequalität</span>
            <dl><dt>Schärfe</dt><dd data-quality-sharpness>–</dd><dt>Belichtung</dt><dd data-quality-exposure>–</dd><dt>Perspektive</dt><dd data-quality-perspective>–</dd><dt>Abdeckung</dt><dd data-quality-coverage>–</dd></dl>
          </section>
          <section class="card"><span class="section-kicker">Kartenstatus</span><div data-eos-card-status class="status neutral">Noch keine Aufnahme</div><p data-eos-card-detail>Datei wählen oder EOS verbinden.</p></section>
          <section class="card pf-recognition-panel"><span class="section-kicker">Erkennung</span><dl><dt>TCG</dt><dd data-result-tcg>–</dd><dt>Name</dt><dd data-result-name>–</dd><dt>Nummer</dt><dd data-result-number>–</dd><dt>Confidence</dt><dd data-result-confidence>–</dd></dl></section>
          <section class="card"><span class="section-kicker">Scan-Verlauf</span><ol class="pf-scan-history" data-eos-history><li>Noch keine Desktop-Aufnahme</li></ol></section>
        </aside>
      </div>`;
    main.appendChild(studio);

    let side = 'front';
    let mode = 'quick';
    let live = false;
    let requestSequence = 1;
    const syncAutoCapture = () => window.PokeNative.setEosAutoCapture(
      Boolean(studio.querySelector('[data-eos-auto]').checked), mode, side);

    const status = (title, detail, kind = 'neutral') => {
      studio.querySelector('[data-eos-status]').textContent = title;
      studio.querySelector('[data-eos-status-detail]').textContent = detail || '';
      const badge = studio.querySelector('[data-eos-badge]');
      badge.className = `status ${kind}`;
      badge.textContent = kind === 'good' ? 'Verbunden' : kind === 'bad' ? 'Fehler' : 'Getrennt';
    };
    const showStudio = () => {
      document.querySelectorAll('main > .page').forEach(page => page.classList.remove('active'));
      document.querySelectorAll('nav [data-page]').forEach(button => button.classList.remove('active'));
      studio.classList.add('active');
      window.scrollTo({top: 0, behavior: 'smooth'});
    };
    const showPreview = dataUrl => {
      const preview = studio.querySelector('[data-eos-preview]');
      preview.src = dataUrl;
      preview.hidden = false;
      studio.querySelector('[data-eos-placeholder]').hidden = true;
      studio.querySelector('[data-eos-guide]').hidden = false;
    };
    const addHistory = label => {
      const history = studio.querySelector('[data-eos-history]');
      if (history.children.length === 1 && /Noch keine/.test(history.firstElementChild.textContent)) history.textContent = '';
      const item = document.createElement('li');
      item.textContent = `${new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} · ${label}`;
      history.prepend(item);
      while (history.children.length > 20) history.lastElementChild.remove();
    };
    const dataUrlFile = async (dataUrl, fileName) => {
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], fileName || `pokefolio-${Date.now()}.jpg`, {type: blob.type || 'image/jpeg'});
    };
    const dispatchToSharedWorkflow = async response => {
      const file = await dataUrlFile(response.dataUrl, response.fileName);
      let target;
      if (mode === 'bulk') {
        document.querySelector('nav [data-page="scan"]')?.click();
        document.querySelector('[data-scan-mode="bulk"]')?.click();
        target = document.getElementById('bulkFile');
      } else if (mode === 'precision') {
        document.querySelector('nav [data-page="grading"]')?.click();
        target = document.getElementById(side === 'back' ? 'gradingBack' : 'gradingFront');
      } else {
        document.querySelector('nav [data-page="scan"]')?.click();
        document.querySelector('[data-scan-mode="single"]')?.click();
        target = document.getElementById('front');
      }
      if (!target) throw new Error('Der gemeinsame Scan-Eingang wurde nicht gefunden.');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      target.files = transfer.files;
      target.dispatchEvent(new Event('change', {bubbles: true}));
    };

    launch.addEventListener('click', showStudio);
    studio.querySelector('[data-eos-close]').addEventListener('click', () => {
      document.querySelector('nav [data-page="home"]')?.click();
    });
    studio.querySelectorAll('[data-eos-side]').forEach(button => button.addEventListener('click', () => {
      studio.querySelectorAll('[data-eos-side]').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      side = button.dataset.eosSide || 'front';
      studio.querySelector('[data-eos-side-label]').textContent = side === 'back' ? 'Rückseite' : 'Vorderseite';
      syncAutoCapture();
    }));
    studio.querySelectorAll('[data-eos-scan-mode]').forEach(button => button.addEventListener('click', () => {
      studio.querySelectorAll('[data-eos-scan-mode]').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      mode = button.dataset.eosScanMode || 'quick';
      if (mode !== 'precision' && side === 'back') studio.querySelector('[data-eos-side="front"]').click();
      syncAutoCapture();
    }));

    const refreshCameras = () => {
      const requestId = `eos-enumerate-${requestSequence++}`;
      window.PokeNative.enumerateEosCameras(requestId);
    };
    studio.querySelector('[data-eos-refresh]').addEventListener('click', refreshCameras);
    studio.querySelector('[data-eos-connect]').addEventListener('click', () => {
      const cameraId = studio.querySelector('[data-eos-camera]').value;
      if (!cameraId) return status('Keine Kamera', 'EOS 2000D anschließen oder lokalen EDSDK-Adapter konfigurieren.', 'bad');
      status('Verbindung wird hergestellt …', '', 'neutral');
      window.PokeNative.connectEos(cameraId, `eos-connect-${requestSequence++}`);
    });
    studio.querySelector('[data-eos-disconnect]').addEventListener('click', () => {
      window.PokeNative.disconnectEos(`eos-disconnect-${requestSequence++}`);
    });
    studio.querySelector('[data-eos-live]').addEventListener('click', event => {
      live = !live;
      if (live) window.PokeNative.startEosLiveView(`eos-live-${requestSequence++}`);
      else window.PokeNative.stopEosLiveView(`eos-live-stop-${requestSequence++}`);
      event.currentTarget.textContent = live ? 'Live View stoppen' : 'Live View starten';
    });
    studio.querySelector('[data-eos-shutter]').addEventListener('click', () => {
      studio.querySelector('[data-eos-card-status]').textContent = 'EOS-Aufnahme läuft …';
      window.PokeNative.captureEos(`eos-capture-${requestSequence++}`, mode === 'bulk' ? 'bulk' : side);
    });
    studio.querySelector('[data-eos-auto]').addEventListener('change', event => {
      syncAutoCapture();
    });
    studio.querySelector('[data-eos-import]').addEventListener('click', () => {
      studio.querySelector('[data-eos-card-status]').textContent = 'Bildauswahl geöffnet';
      window.PokeNative.selectImage(`desktop-import-${requestSequence++}`, mode === 'bulk' ? 'bulk' : side);
    });

    window.onDesktopEosCameras = json => {
      const response = JSON.parse(json);
      const select = studio.querySelector('[data-eos-camera]');
      select.textContent = '';
      (response.cameras || []).forEach(camera => {
        const option = document.createElement('option');
        option.value = camera.id;
        option.textContent = camera.model + (camera.serialNumber ? ` · ${camera.serialNumber}` : '');
        select.appendChild(option);
      });
      if (!select.children.length) select.appendChild(new Option('Keine Kamera gefunden', ''));
    };
    window.onDesktopEosStatus = json => {
      const response = JSON.parse(json);
      status(response.connected ? `${response.model} verbunden` : 'Kamera getrennt',
        response.message || response.error || '', response.connected ? 'good' : response.ok ? 'neutral' : 'bad');
    };
    window.onDesktopEosLiveStatus = json => {
      const response = JSON.parse(json);
      if (!response.ok || !response.active) live = false;
      studio.querySelector('[data-eos-live]').textContent = live ? 'Live View stoppen' : 'Live View starten';
      if (response.error) studio.querySelector('[data-eos-card-detail]').textContent = response.error;
    };
    window.onDesktopEosLiveFrame = json => {
      const response = JSON.parse(json);
      if (response.ok && response.dataUrl) showPreview(response.dataUrl);
    };
    window.onDesktopEosDetection = json => {
      const response = JSON.parse(json);
      studio.querySelector('[data-quality-sharpness]').textContent = `${Math.round((response.sharpness || 0) * 100)} %`;
      studio.querySelector('[data-quality-exposure]').textContent = `${Math.round((response.exposure || 0) * 100)} %`;
      studio.querySelector('[data-quality-perspective]').textContent = `${Math.round((response.confidence || 0) * 100)} %`;
      studio.querySelector('[data-quality-coverage]').textContent = `${Math.round((response.coverage || 0) * 100)} %`;
      studio.querySelector('[data-eos-card-status]').textContent = response.state === 'CAPTURE_READY'
        ? 'Automatische Aufnahme' : response.state === 'STABILIZING' ? 'Karte wird stabilisiert …' : response.state;
    };
    window.onDesktopImageSelected = async json => {
      const response = JSON.parse(json);
      if (!response.ok) {
        if (!response.cancelled) studio.querySelector('[data-eos-card-detail]').textContent = response.error || 'Aufnahme fehlgeschlagen.';
        return;
      }
      showPreview(response.dataUrl);
      studio.querySelector('[data-eos-card-status]').className = 'status good';
      studio.querySelector('[data-eos-card-status]').textContent = 'Bild übernommen';
      studio.querySelector('[data-eos-card-detail]').textContent = `${response.fileName || 'EOS-Aufnahme'} · ${mode}`;
      addHistory(response.fileName || `${mode}-Aufnahme`);
      window.dispatchEvent(new CustomEvent('pokefolio:desktop-image-imported', {detail: response}));
      try {
        await dispatchToSharedWorkflow(response);
      } catch (error) {
        studio.querySelector('[data-eos-card-detail]').textContent = error.message;
      }
    };

    try {
      const eos = JSON.parse(window.PokeNative.getEosStatus() || '{}');
      status(eos.connected ? `${eos.model} verbunden` : 'Kamera getrennt', eos.message || '', eos.connected ? 'good' : 'neutral');
    } catch (error) {
      status('Kamerastatus nicht verfügbar', error.message, 'bad');
    }
    refreshCameras();
  });
})();
