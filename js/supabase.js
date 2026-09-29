/* ============================================================
   AURA — supabase.js
   Capa de nube sobre @supabase/supabase-js (CDN).
   - Cliente singleton + credenciales persistidas (localStorage).
   - Sincronización en vivo vía Realtime (postgres_changes).
   - Emite estados de conexión (igual que el viejo DB.onStatus):
     'ok' | 'syncing' | 'offline' | 'error' | 'denied'
   Orden de carga: supabase-js CDN → supabase.js → store.js → app.js
   ============================================================ */

const Cloud = (() => {
  const CRED_KEY = 'aura_supabase_v1';

  let client = null;          // instancia de window.supabase.createClient
  let channel = null;         // canal Realtime activo
  let cred = { url: '', key: '' };
  const listeners = { status: [] };

  /* ---------------- Credenciales ---------------- */

  function loadCred() {
    try {
      cred = { url: '', key: '', ...JSON.parse(localStorage.getItem(CRED_KEY) || '{}') };
    } catch (e) {
      cred = { url: '', key: '' };
    }
    return cred;
  }

  function saveCred(url, key) {
    cred = { url: (url || '').trim(), key: (key || '').trim() };
    localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  }

  function hasCred() { return !!(cred.url && cred.key); }

  /* ---------------- Estados ---------------- */

  function emitStatus(status, detail) {
    listeners.status.forEach(fn => { try { fn(status, detail); } catch (e) { console.error(e); } });
  }

  function onStatus(fn) { listeners.status.push(fn); }

  /* ---------------- Cliente ---------------- */

  function getClient() { return client; }

  function init() {
    loadCred();
    if (!hasCred() || typeof window.supabase === 'undefined') {
      emitStatus('offline');
      return null;
    }
    try {
      client = window.supabase.createClient(cred.url, cred.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      emitStatus('ok');
      return client;
    } catch (e) {
      console.error('Supabase init:', e);
      emitStatus('error', e);
      return null;
    }
  }

  /* ---------------- Realtime ---------------- */

  /* Subscribe a INSERT/UPDATE/DELETE de las 4 tablas. Los cambios
     que llegan del remoto disparan Store.onRemoteChange() → refreshAll(). */
  function startRealtime() {
    stopRealtime();
    if (!client) return false;
    try {
      channel = client.channel('aura-live')
        .on('postgres_changes',
          { event: '*', schema: 'public' },
          payload => {
            emitStatus('syncing', payload);
            Store && Store.onRemoteChange && Store.onRemoteChange();
            setTimeout(() => emitStatus('ok'), 900);
          })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') emitStatus('ok');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') emitStatus('error');
          else if (status === 'CLOSED') emitStatus('offline');
        });
      return true;
    } catch (e) {
      console.error('Realtime subscribe:', e);
      emitStatus('error', e);
      return false;
    }
  }

  function stopRealtime() {
    if (channel) {
      try { client.removeChannel(channel); } catch (e) { /* noop */ }
      channel = null;
    }
  }

  /* ---------------- Config desde Ajustes ---------------- */

  async function testConnection(url, key) {
    const c = window.supabase.createClient(url.trim(), key.trim(), {
      auth: { persistSession: false }
    });
    const { error } = await c.from('notas').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return true;
  }

  async function connect(url, key) {
    saveCred(url, key);
    client = null;
    init();
    if (!client) return false;
    startRealtime();
    return true;
  }

  function disconnect() {
    stopRealtime();
    client = null;
    cred = { url: '', key: '' };
    localStorage.removeItem(CRED_KEY);
    emitStatus('offline');
  }

  /* Reconexión automática al volver a la app o recuperar red */
  window.addEventListener('online', () => {
    if (hasCred() && client) { startRealtime(); }
    else if (hasCred()) init();
  });
  window.addEventListener('offline', () => emitStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && hasCred()) {
      if (client && !channel) startRealtime();
      else if (!client) init();
    }
  });

  return {
    init, getClient, hasCred, onStatus,
    startRealtime, stopRealtime,
    testConnection, connect, disconnect,
    get url() { return cred.url; },
    get connected() { return !!client && !!channel; }
  };
})();
