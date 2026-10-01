/* ============================================================
   AURA — store.js
   Cliente de almacenamiento HÍBRIDO (Offline-First + Supabase).
   Orden de carga: db-adapter.js → supabase.js → store.js → app.js
   ------------------------------------------------------------
   FLUJO DE GUARDADO INTELIGENTE (todas las escrituras):
     1) Guardar SIEMPRE primero en local (DBAdapter, localStorage).
     2) Si hay red + nube configurada → subir a Supabase en fondo
        (async, sin bloquear la UI). Éxito → marca sincronizado.
     3) Fallo de red, error RLS o nube no configurada → encola en
        sync_queue para reintentar automáticamente.
   NUNCA lanza: un error de Supabase jamás rompe la interfaz.
   La API pública es la misma que consumen app/editor/capture/
   vault/calendar/timetable/timeline/exporter/notifications.
   ============================================================ */

const Store = (() => {
  const TYPE = { TASK: 'task', NOTE: 'note', SUBJECT: 'subject', CLASS: 'class' };
  /* alias 'horario' → 'clases' (tabla del horario académico) */
  const TABLE = { note: 'notas', task: 'tareas', subject: 'materias', class: 'clases', horario: 'clases' };

  /* ================= Logs de bandera (requisito 4) ================= */

  function logLocal(what)  { console.log('[AURA Sync] 💾 Guardado local exitoso.', what); }
  function logCloud(what)  { console.log('[AURA Sync] ☁️ Sincronizado con Supabase.', what); }
  function logOffline(what){ console.log('[AURA Sync] 📶 Modo Offline activado. Registro encolado para sincronización.', what); }

  /* Toast sutil sobre el destino del dato (si la capa UI está cargada).
     El de modo local va limitado a 1 cada 4 s para no saturar en ráfaga. */
  let lastLocalToast = 0;
  function toastCloud() { if (typeof UI !== 'undefined') UI.toast('☁️ Sincronizado en la nube', 'ok', 1600); }
  function toastLocal() {
    if (typeof UI === 'undefined') return;
    const now = Date.now();
    if (now - lastLocalToast < 4000) return;
    lastLocalToast = now;
    UI.toast('💾 Guardado localmente — se subirá al reconectar', 'info', 2400);
  }

  /* ================= Helpers ================= */

  function uid() {
    return (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }
  function nowISO() { return new Date().toISOString(); }
  const ms = v => (v ? new Date(v).getTime() || 0 : 0);

  /* Fila Supabase → doc con forma compatible (_id/_rev/createdAt/updatedAt) */
  function rowToDoc(row) {
    if (!row) return null;
    const doc = { ...row, _id: row.id, _rev: row.updated_at, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) };
    delete doc.id; delete doc.user_id;
    delete doc.updated_at; delete doc.created_at;
    return doc;
  }

  /* Doc local → payload con id/timestamps (para fila Supabase y para local) */
  function docToRow(doc, { withId = true } = {}) {
    const row = {
      ...(withId ? { id: doc._id } : {}),
      titulo: doc.titulo ?? '',
      materia: doc.materia ?? '',
      contenido: doc.contenido ?? '',
      imagenes: doc.imagenes ?? [],
      updated_at: doc.updated_at
    };
    if (doc.created_at) row.created_at = doc.created_at;
    return row;
  }

  function taskToRow(t, { withId = true } = {}) {
    const row = {
      ...(withId ? { id: t._id } : {}),
      titulo: t.titulo ?? '',
      materia: t.materia ?? '',
      vence: t.vence ?? null,
      contenido: t.contenido ?? '',
      hecho: !!t.hecho,
      updated_at: t.updated_at
    };
    if (t.created_at) row.created_at = t.created_at;
    return row;
  }

  function subjectToRow(s, { withId = true } = {}) {
    const row = {
      ...(withId ? { id: s._id } : {}),
      nombre: s.nombre ?? '',
      color: s.color || '#8b5cf6',
      codigo: s.codigo ?? '',
      profesor: s.profesor ?? '',
      profesorNombre: s.profesorNombre ?? '',
      profesorDescripcion: s.profesorDescripcion ?? '',
      updated_at: s.updated_at
    };
    if (s.created_at) row.created_at = s.created_at;
    return row;
  }

  function classToRow(c, { withId = true } = {}) {
    const row = {
      ...(withId ? { id: c._id } : {}),
      materiaId: c.materiaId || null,
      materia: c.materia ?? '',
      aula: c.aula ?? '',
      inicio: c.inicio || '08:00',
      fin: c.fin || '09:00',
      dias: c.dias || [],
      updated_at: c.updated_at
    };
    if (c.created_at) row.created_at = c.created_at;
    return row;
  }

  const ROW_MAKERS = {
    notas: doc => docToRow(doc),
    tareas: taskToRow,
    materias: subjectToRow,
    clases: classToRow
  };

  /* ================= Núcleo híbrido ================= */

  function cloudAvailable() { return !!(window.Cloud && Cloud.hasCred() && Cloud.getClient()); }

  function isNetworkUp() { return DBAdapter.isOnline(); }

  /* Escritura híbrida: local primero, nube en fondo.
     Devuelve SIEMPRE el doc local (nunca lanza). */
  function hybridWrite(table, maker, doc) {
    /* 1) Local inmediato — la UI nunca espera a la red */
    const payload = maker(doc, { withId: true });
    const localDoc = { ...doc, ...payload };
    DBAdapter.upsertLocal(table, localDoc);
    logLocal(table + ' → ' + doc._id);

    /* 2) Nube en background */
    cloudPush(table, doc);
    return localDoc;
  }

  /* Envío asíncrono a la nube; ante cualquier fallo → sync_queue */
  function cloudPush(table, doc) {
    if (!cloudAvailable() || !isNetworkUp()) {
      DBAdapter.enqueue({ _eid: uid(), op: 'upsert', table, doc: ROW_MAKERS[table](doc), at: Date.now() });
      logOffline(table + ' → ' + doc._id);
      toastLocal();
      DBAdapter.scheduleRetry(1);
      return;
    }
    const row = ROW_MAKERS[table](doc);
    Cloud.getClient()
      .from(table).upsert(row)
      .then(({ error }) => {
        if (error) throw error;                  // incluye RLS 42501
        logCloud(table + ' → ' + doc._id);       // éxito: ya está sincronizado
        toastCloud();
        if (typeof App !== 'undefined' && App.markSynced) App.markSynced(doc._id);
      })
      .catch(err => {
        /* Error de red o de permisos RLS → fallback local, sin romper nada */
        console.warn('[AURA Sync] Falló subida a nube (queda en cola):', err && (err.message || err.code || err));
        DBAdapter.enqueue({ _eid: uid(), op: 'upsert', table, doc: row, at: Date.now() });
        toastLocal();
        DBAdapter.scheduleRetry(1);
      });
  }

  /* Borrado híbrido: local ya lo hace DBAdapter.removeLocal */
  function hybridRemove(table, id) {
    DBAdapter.removeLocal(table, id);
    if (cloudAvailable() && isNetworkUp()) {
      Cloud.getClient().from(table).delete().eq('id', id)
        .then(({ error }) => { if (error) throw error; logCloud(table + ' delete → ' + id); })
        .catch(err => {
          console.warn('[AURA Sync] Falló borrado en nube (queda en cola):', err && (err.message || err.code || err));
          DBAdapter.enqueue({ _eid: uid(), op: 'delete', table, id, at: Date.now() });
          DBAdapter.scheduleRetry(1);
        });
    } else {
      DBAdapter.enqueue({ _eid: uid(), op: 'delete', table, id, at: Date.now() });
      logOffline(table + ' delete → ' + id);
      DBAdapter.scheduleRetry(1);
    }
    broadcastWrite();
  }

  /* Uploader/Remover que DBAdapter usa al vaciar la sync_queue */
  function initQueueWorkers() {
    DBAdapter.setUploader(async (table, row) => {
      if (!cloudAvailable()) throw new Error('Supabase no configurado');
      const { error } = await Cloud.getClient().from(table).upsert(row);
      if (error) throw error;
    });
    DBAdapter.setRemover(async (table, id) => {
      if (!cloudAvailable()) throw new Error('Supabase no configurado');
      const { error } = await Cloud.getClient().from(table).delete().eq('id', id);
      if (error) throw error;
    });
  }

  /* ================= Lecturas: espejo local (instantáneo) ================= */

  function getNotes() {
    const list = [...DBAdapter.getAll('notas')];
    list.sort((a, b) => ms(b.updated_at) - ms(a.updated_at));
    return Promise.resolve(list);
  }

  function getTasks() {
    const rows = [...DBAdapter.getAll('tareas')];
    rows.sort((a, b) => {
      if (!!a.hecho !== !!b.hecho) return a.hecho ? 1 : -1;
      return (a.vence || '9999').localeCompare(b.vence || '9999');
    });
    return Promise.resolve(rows);
  }

  function getSubjects() {
    const list = [...DBAdapter.getAll('materias')];
    list.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    return Promise.resolve(list);
  }

  function getClasses() {
    const rows = [...DBAdapter.getAll('clases')];
    rows.sort((a, b) =>
      (a.inicio || '').localeCompare(b.inicio || '') ||
      (a.materia || '').localeCompare(b.materia || ''));
    return Promise.resolve(rows);
  }

  /* ================= Materias ================= */

  function saveSubject(nombre, color, extras = {}, id = null) {
    const existing = id ? DBAdapter.getAll('materias').find(s => s._id === id) : null;
    const doc = {
      _id: existing ? existing._id : DBAdapter.uid(),
      _rev: nowISO(),
      nombre: (nombre || '').trim(),
      color: color || '#8b5cf6',
      codigo: String(extras.codigo ?? '').trim(),
      profesor: String(extras.profesor ?? '').trim(),
      profesorNombre: String(extras.profesorNombre ?? '').trim(),
      profesorDescripcion: String(extras.profesorDescripcion ?? '').trim(),
      created_at: existing ? existing.created_at : nowISO(),
      updated_at: nowISO()
    };
    const out = hybridWrite('materias', subjectToRow, doc);
    broadcastWrite();
    return Promise.resolve(out);
  }

  function deleteSubject(id) {
    hybridRemove('materias', id);
    return Promise.resolve();
  }

  /* ================= Clases (Horario fijo) ================= */

  function upsertClass({ id, materiaId, materia, aula, inicio, fin, dias }) {
    const existing = id ? DBAdapter.getAll('clases').find(c => c._id === id) : null;
    const doc = {
      _id: existing ? existing._id : DBAdapter.uid(),
      _rev: nowISO(),
      materiaId: materiaId || null,
      materia: (materia || '').trim(),
      aula: (aula || '').trim(),
      inicio: inicio || '08:00',
      fin: fin || '09:00',
      dias: (dias || []).map(Number).filter(d => d >= 0 && d <= 6).sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)),
      created_at: existing ? existing.created_at : nowISO(),
      updated_at: nowISO()
    };
    const out = hybridWrite('clases', classToRow, doc);
    broadcastWrite();
    return Promise.resolve(out);
  }

  function deleteClass(id) {
    hybridRemove('clases', id);
    return Promise.resolve();
  }

  /* ================= Tareas ================= */

  function saveTask({ id, titulo, materia, vence, contenido, hecho }) {
    const existing = id ? DBAdapter.getAll('tareas').find(t => t._id === id) : null;
    const doc = {
      _id: existing ? existing._id : DBAdapter.uid(),
      _rev: nowISO(),
      titulo: (titulo || '').trim(),
      materia: materia || '',
      vence: vence || null,
      contenido: contenido || '',
      hecho: typeof hecho === 'boolean' ? hecho : (existing ? !!existing.hecho : false),
      created_at: existing ? existing.created_at : nowISO(),
      updated_at: nowISO()
    };
    const out = hybridWrite('tareas', taskToRow, doc);
    broadcastWrite();
    return Promise.resolve(out);
  }

  function toggleTask(id) {
    const t = DBAdapter.getAll('tareas').find(x => x._id === id);
    if (!t) return Promise.resolve(null);
    t.hecho = !t.hecho;
    t._rev = nowISO();
    t.updated_at = nowISO();
    const out = hybridWrite('tareas', taskToRow, t);
    broadcastWrite();
    return Promise.resolve(out);
  }

  /* Compat: app.js la usa para borrar tareas (y antes caía a notas) */
  function deleteDoc(id) {
    if (DBAdapter.getAll('tareas').some(t => t._id === id)) return deleteTask(id);
    return deleteNote(id);
  }
  function deleteTask(id) {
    hybridRemove('tareas', id);
    return Promise.resolve();
  }

  /* ================= Notas ================= */

  function saveNote({ id, titulo, materia, contenido, imagenes }) {
    const existing = id ? DBAdapter.getAll('notas').find(n => n._id === id) : null;
    const doc = {
      _id: existing ? existing._id : DBAdapter.uid(),
      _rev: nowISO(),
      titulo: (titulo || 'Sin título').trim() || 'Sin título',
      materia: materia || '',
      contenido: contenido || '',
      imagenes: (imagenes || [])
        .filter(img => img && !img.removed && img.dataURL)
        .map(img => ({ name: img.name || ('img_' + uid()), dataURL: img.dataURL })),
      created_at: existing ? existing.created_at : nowISO(),
      updated_at: nowISO()
    };
    /* Conserva imágenes ya persistidas referenciadas con { stored: name } */
    if (existing) {
      for (const img of (imagenes || [])) {
        if (img && img.stored && !doc.imagenes.some(x => x.name === img.stored)) {
          const prev = (existing.imagenes || []).find(x => x.name === img.stored);
          if (prev) doc.imagenes.push({ name: prev.name, dataURL: prev.dataURL });
        }
      }
    }
    const out = hybridWrite('notas', doc => docToRow(doc), doc);
    broadcastWrite();
    return Promise.resolve(out);
  }

  /* dataURL desde el espejo local (sync, sin red) */
  function getAttachment(id, name) {
    const n = DBAdapter.getAll('notas').find(x => x._id === id);
    if (!n) return Promise.resolve(null);
    const img = (n.imagenes || []).find(i => i.name === name);
    return Promise.resolve(img && img.dataURL ? img.dataURL : null);
  }

  function deleteNote(id) {
    hybridRemove('notas', id);
    return Promise.resolve();
  }

  /* ================= Export / wipe ================= */

  async function rawAll() {
    const out = [];
    for (const t of ['notas', 'tareas', 'materias', 'clases']) {
      for (const d of DBAdapter.getAll(t)) {
        out.push({ table: t, ...ROW_MAKERS[t](d) });
      }
    }
    return out;
  }

  async function wipeAll() {
    /* Borrado masivo directo en la nube cuando es posible; si falla
       (RLS/red), cada registro queda encolado vía hybridRemove. */
    for (const t of ['notas', 'tareas', 'materias', 'clases']) {
      if (cloudAvailable() && isNetworkUp()) {
        try {
          const { error } = await Cloud.getClient().from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000');
          if (error) throw error;
          DBAdapter.replaceAll(t, []);
          continue;
        } catch (e) {
          console.warn('[AURA Sync] Wipe masivo de', t, 'falló → borrado uno a uno:', e && (e.message || e.code || e));
        }
      }
      const ids = DBAdapter.getAll(t).map(d => d._id);
      for (const id of ids) hybridRemove(t, id);
    }
  }

  /* ================= Remote → Local (pull + realtime) ================= */

  /* Baja la nube al espejo local (last-write-wins por updated_at).
     Devuelve { notas: bool, tareas: bool, materias: bool, clases: bool }
     para saber si la descarga inicial fue completa. */
  async function pullRemote() {
    const results = { notas: false, tareas: false, materias: false, clases: false };
    if (!cloudAvailable()) return results;
    const client = Cloud.getClient();
    for (const t of Object.keys(results)) {
      try {
        const { data, error } = await client.from(t).select('*').limit(2000);
        if (error) throw error;
        const remote = (data || []).map(rowToDoc);
        const byId = new Map(DBAdapter.getAll(t).map(d => [d._id, d]));
        for (const r of remote) {
          const l = byId.get(r._id);
          if (!l || ms(r.updated_at) > ms(l.updated_at)) byId.set(r._id, r);
        }
        DBAdapter.replaceAll(t, [...byId.values()]);
        results[t] = true;
        console.log(`[AURA Sync] ⬇️ ${t} (${remote.length}) descargada(s) desde Supabase.`);
      } catch (e) {
        console.warn(`[AURA Sync] Pull de ${t} falló (mantengo local):`, e && (e.message || e.code || e));
      }
    }
    if (results.notas && results.tareas && results.materias && results.clases) {
      /* La nube prevaleció: los upserts en cola ya superados se descartan
         para que no re-escriban datos frescos (los delete se conservan). */
      DBAdapter.pruneSupersededQueue();
      console.log('[AURA Sync] ⬇️ Datos sincronizados desde Supabase a la caché local.');
    } else {
      console.warn('[AURA Sync] ⚠️ Sincronización inicial incompleta. Tablas sin descargar:',
        Object.entries(results).filter(([, ok]) => !ok).map(([t]) => t).join(', '),
        '— ¿Ejecutaste el supabase-schema.sql actualizado? (fix RLS)');
    }
    emitChanged();
    return results;
  }

  /* Cambios realtime de otros dispositivos → refrescan espejo + UI */
  function initRealtimeBridge() {
    if (typeof Cloud === 'undefined' || !Cloud.onStatus) return;
    Cloud.onStatus((status, payload) => {
      if (status !== 'syncing' || !payload) return;
      const ev = payload && payload.data ? payload.data : null;
      const schema = payload && payload.schema;
      if (schema && schema !== 'public') return;
      const table = ev && ev.table;
      if (!Object.values(TABLE).includes(table)) return;
      /* Simple y robusto: cualquier cambio remoto re-pulea y refresca */
      pullRemote();
    });
  }

  /* ================= Broadcast entre pestañas ================= */

  let bc = null;
  function broadcastWrite() {
    try {
      if (!bc) bc = new BroadcastChannel('aura-store');
      bc.postMessage({ t: 'write', at: Date.now() });
    } catch (e) { /* noop */ }
  }
  function initBroadcast() {
    initQueueWorkers();
    initRealtimeBridge();
    try {
      bc = new BroadcastChannel('aura-store');
      bc.onmessage = () => { pullRemote().catch(() => {}); changeHook && changeHook(); };
    } catch (e) { /* noop */ }
  }

  /* ================= Hook de refresco de UI ================= */

  let changeHook = null;
  let emitTimer = null;
  function onRemoteChange() { changeHook && changeHook(); }
  function setChangeHook(fn) { changeHook = fn; }
  function emitChanged() {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => changeHook && changeHook(), 250);
  }

  /* ================= Helpers de imagen (compat) ================= */

  function dataURLtoBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = (meta.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function blobToDataURL(blob) {
    return new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  /* ================= API pública ================= */

  return {
    TYPE, initBroadcast,
    getSubjects, saveSubject, deleteSubject,
    getTasks, saveTask, toggleTask, deleteDoc, deleteTask,
    getNotes, saveNote, getAttachment, deleteNote,
    getClasses, upsertClass, deleteClass,
    dataURLtoBlob, blobToDataURL,
    rawAll, wipeAll,
    pullRemote, onRemoteChange, setChangeHook, scheduleRefresh: emitChanged
  };
})();
