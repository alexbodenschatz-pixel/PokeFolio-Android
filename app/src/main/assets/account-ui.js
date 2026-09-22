(() => {
  'use strict';

  const root = document.getElementById('accountSettings');
  if (!root) return;

  const account = window.PokeAccount || null;
  const catalog = window.PokeCatalog || null;
  const sync = window.PokeSyncClient || null;
  const migration = window.PokeAccountMigration || null;
  const storagePrefix = 'pf_legacy_collection_migration_v1:';
  const maximumResolveConcurrency = 2;
  const enqueueBatchSize = 100;
  let activeStatus = account ? safeStatus() : unavailableStatus();
  let migrationRunning = false;
  let message = {kind: '', text: ''};
  let cloudCollectionState = {phase: ''};

  const element = id => document.getElementById(id);

  function unavailableStatus() {
    return {
      configured: false,
      authenticated: false,
      backendOrigin: null,
      configurationError: 'Konten sind nur in der Android- oder Windows-App verfügbar.',
      session: null
    };
  }

  function safeStatus() {
    try {
      const value = account.status();
      return value && typeof value === 'object' ? value : unavailableStatus();
    } catch (_) {
      return unavailableStatus();
    }
  }

  function accountUserId(status = activeStatus) {
    return status && status.authenticated === true && status.session
      && typeof status.session.userId === 'string' ? status.session.userId.toLowerCase() : '';
  }

  function setMessage(kind, text) {
    message = {kind: kind || '', text: text || ''};
    const output = element('accountMessage');
    output.className = 'account-message' + (message.kind ? ' ' + message.kind : '');
    output.textContent = message.text;
  }

  function problemMessage(response, fallback) {
    if (response && response.problem) {
      const problem = response.problem;
      if (problem.errors && typeof problem.errors === 'object') {
        const details = Object.values(problem.errors).flat().filter(Boolean);
        if (details.length) return details.join(' ');
      }
      if (problem.title) return String(problem.title);
    }
    return response && response.error ? String(response.error) : fallback;
  }

  function platformDeviceName() {
    const platform = window.PokePlatform && window.PokePlatform.kind;
    return platform === 'windows' ? 'PokeFolio Windows-PC' : 'PokeFolio Android-Gerät';
  }

  function migrationKey(userId) {
    return storagePrefix + userId;
  }

  function loadPlan(userId) {
    if (!migration || !userId) return null;
    const raw = localStorage.getItem(migrationKey(userId));
    if (!raw) return null;
    return migration.parsePlan(raw, userId);
  }

  function savePlan(plan) {
    plan.updatedAt = new Date().toISOString();
    localStorage.setItem(migrationKey(plan.userId), JSON.stringify(plan));
  }

  function localCollection(userId) {
    if (userId && typeof window.loadCollectionForMigration === 'function') {
      return window.loadCollectionForMigration(userId);
    }
    return typeof window.loadCollection === 'function' ? window.loadCollection() : [];
  }

  function cloudHoldings() {
    if (!sync || sync.status().ready !== true) return [];
    return sync.entities('holding');
  }

  function renderCloudStatus() {
    const panel = element('cloudCollectionStatus');
    const userId = accountUserId();
    panel.hidden = !userId || !sync;
    if (panel.hidden) return;
    let holdings = [];
    let status;
    try {
      holdings = cloudHoldings().filter(holding => Number(holding.quantity) > 0);
      status = sync.status();
    } catch (_) {
      status = {phase: 'storage-error', pending: 0};
    }
    element('cloudHoldingCount').textContent = new Intl.NumberFormat('de-DE').format(holdings.length);
    element('cloudCardCount').textContent = new Intl.NumberFormat('de-DE').format(
      holdings.reduce((sum, holding) => sum + Math.max(0, Number(holding.quantity) || 0), 0));
    const phases = {
      idle: 'Synchronisiert', syncing: 'Synchronisierung läuft …', retry: 'Erneuter Versuch geplant',
      offline: 'Offline · Änderungen bleiben vorgemerkt', 'storage-error': 'Lokaler Sync-Speicher fehlerhaft'
    };
    const pending = Number(status.pending) || 0;
    const hydration = {
      hydrating: ' · Sammlung wird aufgebaut',
      partial: ` · ${Number(cloudCollectionState.unresolved) || 0} Kartenmetadaten ausstehend`,
      'outbox-pending': ' · Neue Scans werden vorbereitet',
      'outbox-syncing': ` · ${Number(cloudCollectionState.pendingCreates) || 0} neue Scans werden katalogisiert`,
      'outbox-partial': ` · ${Number(cloudCollectionState.failed) || 0} neue Scans warten auf Wiederholung`,
      'outbox-queued': ' · Neue Scans sicher vorgemerkt',
      'outbox-confirmed': ' · Neue Scans bestätigt',
      'outbox-review': ` · ${Number(cloudCollectionState.failed) || 0} neue Scans benötigen Prüfung`,
      error: ' · Lokaler Bestand aus Sicherheitsgründen unverändert'
    };
    element('cloudSyncStatus').textContent = (phases[status.phase] || status.phase || 'Noch nicht bereit')
      + (pending ? ` · ${pending} ausstehend` : '')
      + (hydration[cloudCollectionState.phase] || '');
  }

  function renderMigration() {
    const panel = element('legacyMigration');
    const userId = accountUserId();
    const collection = localCollection(userId);
    panel.hidden = !userId || !migration || !catalog || !sync || collection.length === 0;
    if (panel.hidden) return;

    let plan = null;
    let planError = '';
    try {
      plan = loadPlan(userId);
    } catch (error) {
      planError = 'Der vorhandene Migrationsstand ist beschädigt und wurde nicht überschrieben.';
      console.error('[PokeFolio Migration] Plan konnte nicht gelesen werden:', error.message);
    }
    const preview = plan || migration.createPlan(collection, userId);
    const summary = migration.summarize(preview);
    const completed = summary.complete;
    const progressed = completed + summary.conflict + summary.rejected;
    const progress = element('legacyMigrationProgress');
    progress.max = Math.max(1, summary.eligible);
    progress.value = Math.min(progress.max, progressed);
    progress.hidden = !plan && !migrationRunning;

    const status = element('legacyMigrationStatus');
    const button = element('legacyMigrationStart');
    const issues = element('legacyMigrationIssues');
    issues.hidden = true;
    issues.textContent = '';
    button.disabled = migrationRunning || Boolean(planError) || summary.eligible === 0
      || (plan && plan.status === 'complete');
    button.textContent = migrationRunning ? 'Datenübernahme läuft …'
      : plan && plan.status === 'complete' ? 'Sicher übernommen'
        : plan ? 'Datenübernahme fortsetzen' : 'Lokale Sammlung übernehmen';

    if (planError) {
      status.className = 'status bad';
      status.textContent = 'Blockiert';
      issues.hidden = false;
      issues.textContent = planError + ' Die lokale Sammlung ist unverändert.';
    } else if (plan && plan.status === 'complete') {
      status.className = 'status good';
      status.textContent = 'Übernommen';
    } else if (migrationRunning || summary.queued) {
      status.className = 'status neutral';
      status.textContent = migrationRunning ? 'Läuft' : 'Vorgemerkt';
    } else if (summary.conflict || summary.rejected) {
      status.className = 'status warn';
      status.textContent = 'Prüfung nötig';
    } else {
      status.className = 'status neutral';
      status.textContent = 'Bereit';
    }

    element('legacyMigrationSummary').textContent = summary.eligible
      ? `${summary.eligible} Positionen mit ${new Intl.NumberFormat('de-DE').format(summary.quantity)} Karten können idempotent übernommen werden.`
        + (completed ? ` ${completed} Positionen sind bestätigt.` : '')
      : 'Für den automatischen Import fehlt bei allen lokalen Karten eine stabile Kartenidentität.';
    const issueParts = [];
    const resolutionErrors = preview.entries.filter(entry => entry.error).length;
    if (summary.skipped) issueParts.push(`${summary.skipped} lokale Positionen bleiben wegen unvollständiger Identität ausschließlich lokal erhalten.`);
    if (resolutionErrors) issueParts.push(`${resolutionErrors} Katalogzuordnungen konnten noch nicht abgeschlossen werden.`);
    if (summary.conflict) issueParts.push(`${summary.conflict} Konflikte müssen geprüft werden.`);
    if (summary.rejected) issueParts.push(`${summary.rejected} Positionen wurden vom Server abgelehnt.`);
    if (issueParts.length && !planError) {
      issues.hidden = false;
      issues.textContent = issueParts.join(' ');
    }
  }

  function renderAccount() {
    const configured = account && activeStatus.configured === true;
    const authenticated = configured && activeStatus.authenticated === true
      && Boolean(accountUserId());
    const badge = element('accountStatusBadge');
    badge.className = 'status ' + (authenticated ? 'good' : configured ? 'neutral' : 'bad');
    badge.textContent = authenticated ? 'Angemeldet' : configured ? 'Abgemeldet' : 'Nicht konfiguriert';
    element('accountSignedOut').hidden = !configured || authenticated;
    element('accountSignedIn').hidden = !authenticated;
    element('accountConfigurationMessage').textContent = configured
      ? authenticated
        ? 'Deine private Sammlung wird über die native, tokenfreie Cloud-Grenze synchronisiert.'
        : 'Melde dich an oder erstelle ein Konto. Zugangsdaten werden niemals im WebView-Speicher abgelegt.'
      : activeStatus.configurationError || unavailableStatus().configurationError;
    if (!element('accountDeviceName').value) {
      element('accountDeviceName').value = platformDeviceName();
    }
    element('accountLogin').disabled = !configured || migrationRunning;
    element('accountRegister').disabled = !configured || migrationRunning;
    element('accountSyncNow').disabled = !authenticated || !sync || migrationRunning;
    element('accountLogout').disabled = !authenticated || migrationRunning;
    if (authenticated) {
      const session = activeStatus.session;
      const device = session.device || {};
      element('accountUserId').textContent = session.userId;
      element('accountDevice').textContent = device.name || device.platform || 'Dieses Gerät';
      element('accountBackend').textContent = activeStatus.backendOrigin || 'Konfiguriert';
    }
    const output = element('accountMessage');
    output.className = 'account-message' + (message.kind ? ' ' + message.kind : '');
    output.textContent = message.text;
    renderCloudStatus();
    renderMigration();
  }

  async function authenticate(operation) {
    if (!account || migrationRunning) return;
    const form = element('accountSignedOut');
    if (!form.reportValidity()) return;
    const email = element('accountEmail').value.trim();
    const passwordInput = element('accountPassword');
    const password = passwordInput.value;
    const deviceName = element('accountDeviceName').value.trim();
    element('accountLogin').disabled = true;
    element('accountRegister').disabled = true;
    setMessage('', operation === 'register' ? 'Konto wird erstellt …' : 'Anmeldung läuft …');
    try {
      const response = operation === 'register'
        ? await account.register(email, password, deviceName)
        : await account.login(email, password, deviceName);
      if (!response || response.ok !== true) {
        throw new Error(problemMessage(response,
          operation === 'register' ? 'Konto konnte nicht erstellt werden.' : 'Anmeldung fehlgeschlagen.'));
      }
      activeStatus = response.status || safeStatus();
      setMessage('good', operation === 'register' ? 'Konto erstellt und angemeldet.' : 'Erfolgreich angemeldet.');
    } catch (error) {
      setMessage('bad', error.message || 'Kontoaktion fehlgeschlagen.');
    } finally {
      passwordInput.value = '';
      renderAccount();
    }
  }

  async function logout() {
    if (!account || migrationRunning) return;
    element('accountLogout').disabled = true;
    setMessage('', 'Gerät wird abgemeldet …');
    try {
      const response = await account.logout();
      if (!response || response.ok !== true) {
        throw new Error(problemMessage(response, 'Abmeldung fehlgeschlagen.'));
      }
      activeStatus = response.status || safeStatus();
      setMessage(response.serverSessionRevoked === false ? 'warn' : 'good',
        response.serverSessionRevoked === false
          ? 'Lokal abgemeldet; die Serversitzung konnte nicht bestätigt werden.'
          : 'Dieses Gerät wurde abgemeldet.');
    } catch (error) {
      activeStatus = safeStatus();
      setMessage('bad', error.message || 'Abmeldung fehlgeschlagen.');
    } finally {
      renderAccount();
    }
  }

  async function syncNow() {
    if (!sync || migrationRunning) return;
    element('accountSyncNow').disabled = true;
    setMessage('', 'Sammlung wird synchronisiert …');
    try {
      const status = await drainBoundedSync();
      const failed = status.phase === 'retry' || status.phase === 'storage-error';
      setMessage(failed ? 'warn' : 'good', failed
        ? 'Synchronisierung wird später automatisch fortgesetzt.'
        : 'Cloud-Sammlung ist aktuell.');
    } catch (error) {
      setMessage('bad', error.message || 'Synchronisierung fehlgeschlagen.');
    } finally {
      renderAccount();
    }
  }

  async function drainBoundedSync() {
    let status = sync.status();
    for (let run = 0; run < 20; run++) {
      status = await sync.syncNow();
      if (!status.continuationPending || status.phase !== 'idle') return status;
    }
    throw new Error('Der Cloud-Bestand ist zu groß für eine einzelne Migrationssitzung. Bitte erneut fortsetzen.');
  }

  async function resolveMigrationEntries(plan, holdings) {
    const indexes = plan.entries.map((entry, index) => ({entry, index}))
      .filter(({entry}) => entry.state !== 'complete' && entry.state !== 'conflict'
        && entry.state !== 'rejected' && !entry.operation)
      .map(({index}) => index);
    for (let offset = 0; offset < indexes.length; offset += maximumResolveConcurrency) {
      const batch = indexes.slice(offset, offset + maximumResolveConcurrency);
      const results = await Promise.all(batch.map(async index => {
        const entry = plan.entries[index];
        try {
          const response = await catalog.resolve(entry.reference);
          if (!response || response.ok !== true || !response.data || !response.data.card) {
            throw new Error(problemMessage(response, 'Katalogkarte konnte nicht aufgelöst werden.'));
          }
          return {index, operation: migration.buildOperation(entry, response.data.card.id, holdings)};
        } catch (error) {
          return {index, error: error.message || 'Katalogauflösung fehlgeschlagen.'};
        }
      }));
      results.forEach(result => {
        const entry = plan.entries[result.index];
        if (result.operation) {
          entry.operation = result.operation;
          entry.error = null;
        } else {
          entry.error = result.error;
        }
      });
      savePlan(plan);
      renderMigration();
      if (results.length && results.every(result => result.error)) break;
    }
  }

  function enqueueMigrationEntries(plan) {
    const entries = plan.entries.filter(entry => entry.operation
      && entry.state !== 'complete' && entry.state !== 'conflict' && entry.state !== 'rejected');
    for (let offset = 0; offset < entries.length; offset += enqueueBatchSize) {
      const batch = entries.slice(offset, offset + enqueueBatchSize);
      sync.enqueueMany(batch.map(entry => entry.operation));
      batch.forEach(entry => {
        entry.state = 'queued';
        entry.error = null;
      });
      plan.status = 'queued';
      savePlan(plan);
      renderMigration();
    }
  }

  function reconcileMigration(plan) {
    const entries = plan.entries.filter(entry => entry.operation
      && entry.state !== 'complete');
    const results = sync.inspectOperations(entries.map(entry => entry.operation.operationId));
    results.forEach((result, index) => {
      entries[index].state = result.state;
      if (result.state === 'complete') entries[index].error = null;
    });
    const summary = migration.summarize(plan);
    plan.status = summary.complete === summary.eligible ? 'complete'
      : summary.conflict || summary.rejected ? 'review' : summary.queued ? 'queued' : 'pending';
    savePlan(plan);
  }

  async function startMigration() {
    const userId = accountUserId();
    if (!userId || !migration || !catalog || !sync || migrationRunning) return;
    let plan;
    try {
      plan = loadPlan(userId) || migration.createPlan(localCollection(userId), userId);
    } catch (error) {
      setMessage('bad', 'Der vorhandene Migrationsstand ist beschädigt und bleibt zur Wiederherstellung erhalten.');
      return renderAccount();
    }
    const preview = migration.summarize(plan);
    if (!preview.eligible) return;
    if (!window.confirm(`${preview.eligible} lokale Positionen mit ${preview.quantity} Karten diesem Konto zuordnen? Die lokale Kopie bleibt erhalten.`)) return;

    if (typeof window.claimLegacyCollection === 'function') {
      window.claimLegacyCollection(userId);
      window.dispatchEvent(new CustomEvent('pokefolio:collection-scope'));
    }

    migrationRunning = true;
    setMessage('', 'Lokale Sammlung wird sicher vorbereitet …');
    renderAccount();
    try {
      savePlan(plan);
      const initialSync = await drainBoundedSync();
      if (initialSync.phase === 'offline') {
        throw new Error('Für die erste Kartenkatalog-Zuordnung ist eine Internetverbindung erforderlich.');
      }
      if (initialSync.phase === 'storage-error') {
        throw new Error('Der lokale Sync-Speicher muss vor der Datenübernahme geprüft werden.');
      }
      const holdings = cloudHoldings();
      await resolveMigrationEntries(plan, holdings);
      enqueueMigrationEntries(plan);
      if (!plan.entries.some(entry => entry.operation)) {
        plan.status = 'pending';
        savePlan(plan);
        throw new Error('Keine lokale Position konnte dem globalen Kartenkatalog zugeordnet werden.');
      }
      await drainBoundedSync();
      reconcileMigration(plan);
      const summary = migration.summarize(plan);
      if (plan.status === 'complete') {
        setMessage('good', `${summary.complete} lokale Positionen wurden bestätigt. Die lokale Kopie bleibt erhalten.`);
      } else if (summary.conflict || summary.rejected) {
        setMessage('warn', 'Die Übernahme ist teilweise abgeschlossen; Konflikte bleiben sichtbar und lokale Daten wurden nicht gelöscht.');
      } else {
        setMessage('warn', 'Die Übernahme ist vorgemerkt und wird bei verfügbarer Verbindung fortgesetzt.');
      }
    } catch (error) {
      plan.status = 'pending';
      let recovery = 'Der gespeicherte Stand kann sicher fortgesetzt werden.';
      try {
        savePlan(plan);
      } catch (storageError) {
        console.error('[PokeFolio Migration] Fortschritt konnte nicht gespeichert werden:',
          storageError.message);
        recovery = 'Die lokale Sammlung blieb unverändert; vor einem neuen Versuch lokalen Speicher prüfen.';
      }
      setMessage('bad', (error.message || 'Datenübernahme unterbrochen.')
        + ' ' + recovery);
    } finally {
      migrationRunning = false;
      renderAccount();
    }
  }

  element('accountSignedOut').addEventListener('submit', event => {
    event.preventDefault();
    authenticate('login');
  });
  element('accountRegister').addEventListener('click', () => authenticate('register'));
  element('accountLogout').addEventListener('click', logout);
  element('accountSyncNow').addEventListener('click', syncNow);
  element('legacyMigrationStart').addEventListener('click', startMigration);
  window.addEventListener('pokefolio:account-state', event => {
    const detail = event && event.detail;
    activeStatus = detail && detail.status || safeStatus();
    renderAccount();
  });
  window.addEventListener('pokefolio:sync-state', renderAccount);
  window.addEventListener('pokefolio:cloud-collection-state', event => {
    cloudCollectionState = event && event.detail || {phase: ''};
    renderCloudStatus();
  });
  window.addEventListener('pokefolio:collection-changed', renderAccount);

  renderAccount();
})();
