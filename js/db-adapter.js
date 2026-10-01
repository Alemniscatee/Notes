/* ============================================================
   AURA — db-adapter.js
   Capa LOCAL offline-first + cola de sincronización (sync_queue).
   Orden de carga: db-adapter.js → supabase.js → store.js → app.js
   ------------------------------------------------------------
   - localStorage como almacén espejo completo de las 4 tablas
     (notas, tareas, materias, clases) + índice de eliminados.
   - sync_queue: cada escritura con la nube pendiente se encola
     y se procesa en background al recuperar conexión.
   - Cero dependencias. No toca la red (eso lo hace Store).
   ============================================================ */

const DBAdapter = (() => {
  const KEY = 'aura_db_v1';          // espejo local de las 4 tablas
  const QUEUE_KEY = 'sync_queue';    // cola de eventos pendientes de subir
  const OUTBOX_KEY = 'aura_del_v1';  // eliminados pendientes de propagar

  const MAX_QUEUE = 500;             // tope de seguridad de la cola

  /* ---------------- Estado base ---------------- */

  function emptyDB() { return { notas: [], tareas: [], materias: [], clases: [] }; }
  function emptyOutbox() { return { notas: [], tareas: [], materias: [], clases: [] }; }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback();
      const val = JSON.parse(raw);
      return val && typeof val === 'object' ? val : fallback();
    } catch (e) {
      console.warn('[AURA Sync] Almacén local corrupto, se reinicia:', key);
      return fallback();
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      /* QuotaExceededError: las notas pueden llevar imágenes base64 */
      console.error('[AURA Sync] Almacenamiento local lleno:', e);
      if (typeof UI !== 'undefined') UI.toast('Almacenamiento local lleno', 'err');
      return false;
    }
  }

  function db() { return readJSON(KEY, emptyDB); }
  function outbox() { return readJSON(OUTBOX_KEY, emptyOutbox); }
  function writeDB(dbx) { return writeJSON(KEY, dbx); }
  function writeOutbox(ob) { return writeJSON(OUTBOX_KEY, ob); }

  function queue() {
    const raw = readJSON(QUEUE_KEY, () => []);
    return Array.isArray(raw) ? raw : [];
  }
  function writeQueue(q) { return writeJSON(QUEUE_KEY, q); }

  function uid() {
    return (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }

  /* ---------------- API de listas ---------------- */

  function getAll(table) {
    return db()[table] || [];
  }

  function upsertLocal(table, doc) {
    const dbx = db();
    const list = dbx[table] || [];
    const i = list.findIndex(d => d._id === doc._id);
    if (i >= 0) list[i] = doc; else list.push(doc);
    return writeDB(dbx);
  }

  function removeLocal(table, id) {
    const dbx = db();
    dbx[table] = (dbx[table] || []).filter(d => d._id !== id);
    writeDB(dbx);
    /* recordar el borrado para propagarlo cuando vuelva la nube */
    const ob = outbox();
    if (!ob[table].includes(id)) ob[table].push(id);
    writeOutbox(ob);
  }

  function replaceAll(table, rows) {
    const dbx = db();
    dbx[table] = rows;
    writeDB(dbx);
  }

  /* ---------------- sync_queue ---------------- */

  function enqueue(event) {
    const q = queue();
    /* Coalescing: si ya hay un upsert pendiente del mismo registro,
       se reemplaza por la versión más reciente (menos payload). */
    if (event.op !== 'delete') {
      const i = q.findIndex(e => e.op !== 'delete' && e.table === event.table && e.doc._id === event.doc._id);
      if (i >= 0) { q[i] = event; return writeQueue(q); }
    }
    q.push(event);
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
    writeQueue(q);
    return true;
  }

  function peek() { return queue(); }

  function removeMany(events) {
    const done = new Set(events.map(e => e._eid));
    writeQueue(queue().filter(e => !done.has(e._eid)));
  }

  /* ---------------- Detección de red ---------------- */

  const isOnline = () => navigator.onLine !== false;

  /* ---------------- Vaciado de la cola (flush) ----------------
   * uploader(table, doc)   → Promise para subir/actualizar.
   * remover(table, id)     → Promise para borrar en el remoto.
   * Ambas las inyecta Store para desacoplar el cliente Supabase. */

  let uploader = null, remover = null;
  let flushing = false, pendingFlush = null;

  function setUploader(fn) { uploader = fn; }
  function setRemover(fn) { remover = fn; }

  async function flush() {
    if (flushing) { pendingFlush = true; return { ok: 0, fail: 0, skipped: true }; }
    if (!uploader || !remover) return { ok: 0, fail: 0, skipped: true };
    if (!isOnline()) return { ok: 0, fail: 0, skipped: true };

    flushing = true;
    const events = peek();
    let ok = 0, fail = 0;

    for (const ev of events) {
      try {
        if (ev.op === 'delete') await remover(ev.table, ev.id);
        else await uploader(ev.table, ev.doc);
        removeMany([ev]);
        ok++;
        console.log('[AURA Sync] ☁️ Sincronizado con Supabase.', ev.op, ev.table, ev.doc ? ev.doc._id : ev.id);
      } catch (err) {
        fail++;
        /* RLS denegado (42501), 4xx/5xx, red inestable… el evento
           permanece en la cola para reintentar más tarde. */
        console.warn('[AURA Sync] Evento pendiente (reintento luego):',
          err && (err.message || err.code || err), '— cola:', queue().length);
        /* Si la red se cayó a mitad del flush, abortar: los siguientes
           fallarán igual y solo ensucian la consola. */
        if (!isOnline()) break;
      }
    }

    flushing = false;
    if (pendingFlush) { pendingFlush = false; return flush(); }

    if (ok > 0) {
      console.log(`[AURA Sync] Cola vaciada: ${ok} subido(s), ${fail} pendiente(s).`);
      emitChange();
    }
    return { ok, fail, skipped: false };
  }

  function queueLength() { return queue().length; }

  /* ---------------- Reintentos automáticos ---------------- */

  let retryTimer = null;
  function scheduleRetry(attempt = 1) {
    clearTimeout(retryTimer);
    const delay = Math.min(30000, 2000 * attempt);
    retryTimer = setTimeout(() => {
      flush().then(r => {
        if (!r.skipped && r.fail > 0 && isOnline()) scheduleRetry(attempt + 1);
      });
    }, delay);
  }

  /* ---------------- Listeners de red ---------------- */

  const listeners = { change: [] };
  function emitChange() { listeners.change.forEach(fn => { try { fn(); } catch (e) {} }); }
  function onChange(fn) { listeners.change.push(fn); }

  window.addEventListener('online', () => {
    console.log('[AURA Sync] 📶 Conexión recuperada. Procesando sync_queue…');
    flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) flush();
  });

  /* ---------------- API pública ---------------- */

  return {
    uid, getAll, upsertLocal, removeLocal, replaceAll,
    enqueue, peek, removeMany, flush,
    setUploader, setRemover, queueLength, scheduleRetry,
    isOnline, onChange
  };
})();
