/* ============================================================
   AURA — db.js
   PouchDB local (offline-first) + CouchDB bidirectional sync
   Docs:
   { _id, type: 'task'|'note'|'subject', ... , attachments for images }
   ============================================================ */

const DB = (() => {
  let localDB = null;
  let remoteURL = '';
  let syncHandler = null;
  let lastSeq = null;

  const listeners = { status: [] };

  function emitStatus(status, detail) {
    listeners.status.forEach(fn => { try { fn(status, detail); } catch (e) { console.error(e); } });
  }

  function init() {
    localDB = new PouchDB('aura_life', { auto_compaction: true });
    return localDB.createIndex({
      index: { fields: ['type', 'materia', 'vence', 'hecho', 'createdAt'] }
    }).catch(() => {/* index may already exist */});
  }

  function get() {
    if (!localDB) throw new Error('DB not initialized');
    return localDB;
  }

  /* ---------------- Sync ---------------- */

  function normalizeRemote(url) {
    let u = (url || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }

  function startSync(url) {
    stopSync();
    remoteURL = normalizeRemote(url);
    if (!remoteURL || !localDB) return false;

    emitStatus('syncing');
    // Continuous bidirectional sync — retries automatically when back online
    syncHandler = localDB.sync(remoteURL, {
      live: true,
      retry: true,
      batch_size: 60
    }).on('change', info => {
      emitStatus('syncing', { dir: info.direction });
      Store && Store.onRemoteChange && Store.onRemoteChange();
    })
      .on('paused', info => {
        // paused = up to date (or waiting for network)
        const online = navigator.onLine;
        emitStatus(online ? 'ok' : 'offline');
        Store && Store.onRemoteChange && Store.onRemoteChange();
      })
      .on('active', () => emitStatus('syncing'))
      .on('denied', err => emitStatus('denied', err))
      .on('error', err => emitStatus('error', err));

    return true;
  }

  function stopSync() {
    if (syncHandler) {
      try { syncHandler.cancel(); } catch (e) { /* noop */ }
      syncHandler = null;
    }
  }

  async function testConnection(url) {
    const target = normalizeRemote(url);
    const res = await fetch(target, { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    return info;
  }

  function onStatus(fn) { listeners.status.push(fn); }

  window.addEventListener('online', () => {
    if (remoteURL) startSync(Settings.get().couchURL);
    else emitStatus('offline');
  });
  window.addEventListener('offline', () => emitStatus('offline'));

  return {
    init, get, startSync, stopSync, testConnection, onStatus,
    get remoteURL() { return remoteURL; },
    get isSyncing() { return !!syncHandler; }
  };
})();
