/* ============================================================
   AURA — store.js
   CRUD sobre Supabase (tablas notas/tareas/materias/clases).
   MISMA API pública que la versión PouchDB: ningún módulo
   (app, editor, capture, vault, calendar, timetable, exporter,
   timeline, materia-picker, ui, notifications) necesita cambios
   de firma. Cambios clave:
   - ids y revs ahora son UUID; docs van de fila → objeto plano.
   - Imágenes: array JSONB `imagenes` [{name, dataURL}] (antes
     adjuntos binarios PouchDB). getAttachment() genera blob URL.
   - Realtime: cada write dispara onRemoteChange en OTROS tabs
     (BroadcastChannel) y el hook global refresca la UI.
   ============================================================ */

const Store = (() => {
  const TYPE = { TASK: 'task', NOTE: 'note', SUBJECT: 'subject', CLASS: 'class' };

  /* Mapeo lógico → tabla física en Supabase
     (alias 'horario' → 'clases': la tabla del horario académico) */
  const TABLE = { note: 'notas', task: 'tareas', subject: 'materias', class: 'clases', horario: 'clases' };

  /* ---------------- Helpers internos ---------------- */

  function sb() {
    const c = Cloud.getClient();
    if (!c) throw new Error('Supabase no está configurado. Ve a Ajustes → Sincronización en la nube.');
    return c;
  }

  /* uuid v4 sin dependencias (gen_random_uuid ya lo da la BD,
     pero se usa para keys locales antes del insert) */
  function uid() {
    return (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }

  function nowISO() { return new Date().toISOString(); }

  /* Timestamps → ms (la UI comparaba updatedAt numérico de PouchDB) */
  const ms = v => (v ? new Date(v).getTime() || 0 : 0);

  /* Fila Supabase → doc con forma compatible (mantiene _id/_rev) */
  function rowToDoc(row) {
    if (!row) return null;
    const doc = { ...row, _id: row.id, _rev: row.updated_at, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) };
    delete doc.id;
    delete doc.user_id;
    delete doc.updated_at;
    delete doc.created_at;
    return doc;
  }

  /* Sincroniza otros tabs del MISMO dispositivo (Realtime solo cubre
     otros clientes; entre pestañas locales usa BroadcastChannel) */
  let bc = null;
  function broadcastWrite() {
    try {
      if (!bc) bc = new BroadcastChannel('aura-store');
      bc.postMessage({ t: 'write', at: Date.now() });
    } catch (e) { /* noop */ }
  }
  function initBroadcast() {
    try {
      bc = new BroadcastChannel('aura-store');
      bc.onmessage = () => onRemoteChange();
    } catch (e) { /* noop */ }
  }

  /* Hook global de refresco (lo registra app.js → refreshAll) */
  let changeHook = null;
  function onRemoteChange() { changeHook && changeHook(); }
  function setChangeHook(fn) { changeHook = fn; }

  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => changeHook && changeHook(), 600);
  }

  /* ---------------- Materias ---------------- */

  async function getSubjects() {
    const { data, error } = await sb().from(TABLE.subject).select('*').order('nombre', { ascending: true }).limit(500);
    if (error) throw error;
    return (data || []).map(rowToDoc);
  }

  async function saveSubject(nombre, color, extras = {}, id = null) {
    const payload = {
      nombre: (nombre || '').trim(),
      color: color || '#8b5cf6',
      ...(extras.codigo !== undefined ? { codigo: String(extras.codigo).trim() } : {}),
      ...(extras.profesor !== undefined ? { profesor: String(extras.profesor).trim() } : {}),
      ...(extras.profesorNombre !== undefined ? { profesorNombre: String(extras.profesorNombre).trim() } : {}),
      ...(extras.profesorDescripcion !== undefined ? { profesorDescripcion: String(extras.profesorDescripcion).trim() } : {}),
      updated_at: nowISO()
    };
    let doc;
    if (id) {
      const { data, error } = await sb().from(TABLE.subject).update(payload).eq('id', id).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    } else {
      const { data, error } = await sb().from(TABLE.subject).insert({ ...payload, created_at: nowISO() }).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    }
    broadcastWrite();
    return doc;
  }

  async function deleteSubject(id /*, rev */) {
    const { error } = await sb().from(TABLE.subject).delete().eq('id', id);
    if (error) throw error;
    broadcastWrite();
  }

  /* ---------------- Clases (Horario fijo) ---------------- */

  async function getClasses() {
    const { data, error } = await sb().from(TABLE.class).select('*').order('inicio', { ascending: true }).limit(500);
    if (error) throw error;
    const rows = (data || []).map(rowToDoc);
    rows.sort((a, b) =>
      (a.inicio || '').localeCompare(b.inicio || '') ||
      (a.materia || '').localeCompare(b.materia || ''));
    return rows;
  }

  async function upsertClass({ id, materiaId, materia, aula, inicio, fin, dias }) {
    const payload = {
      materiaId: materiaId || null,
      materia: (materia || '').trim(),
      aula: (aula || '').trim(),
      inicio: inicio || '08:00',
      fin: fin || '09:00',
      dias: (dias || []).map(Number).filter(d => d >= 0 && d <= 7 && d !== 7).sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)),
      updated_at: nowISO()
    };
    let doc;
    if (id) {
      const { data, error } = await sb().from(TABLE.class).update(payload).eq('id', id).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    } else {
      const { data, error } = await sb().from(TABLE.class).insert({ ...payload, created_at: nowISO() }).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    }
    broadcastWrite();
    return doc;
  }

  async function deleteClass(id) {
    const { error } = await sb().from(TABLE.class).delete().eq('id', id);
    if (error) throw error;
    broadcastWrite();
  }

  /* ---------------- Tareas ---------------- */

  async function getTasks() {
    const { data, error } = await sb().from(TABLE.task).select('*').order('vence', { ascending: true, nullsFirst: false }).limit(1000);
    if (error) throw error;
    const rows = (data || []).map(rowToDoc);
    rows.sort((a, b) => {
      if (!!a.hecho !== !!b.hecho) return a.hecho ? 1 : -1;
      return (a.vence || '9999').localeCompare(b.vence || '9999');
    });
    return rows;
  }

  async function saveTask({ id, titulo, materia, vence, contenido, hecho }) {
    const payload = {
      titulo: (titulo || '').trim(),
      materia: materia || '',
      vence: vence || null,
      contenido: contenido || '',
      ...(typeof hecho === 'boolean' ? { hecho } : {}),
      updated_at: nowISO()
    };
    let doc;
    if (id) {
      const { data, error } = await sb().from(TABLE.task).update(payload).eq('id', id).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    } else {
      const { data, error } = await sb().from(TABLE.task).insert({ ...payload, hecho: payload.hecho ?? false, created_at: nowISO() }).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    }
    broadcastWrite();
    return doc;
  }

  async function toggleTask(id) {
    const { data: row, error: e1 } = await sb().from(TABLE.task).select('hecho').eq('id', id).single();
    if (e1) throw e1;
    const { data, error } = await sb().from(TABLE.task)
      .update({ hecho: !row.hecho, updated_at: nowISO() }).eq('id', id).select().single();
    if (error) throw error;
    broadcastWrite();
    return rowToDoc(data);
  }

  async function deleteDoc(id) {
    /* deleteDoc se usa para tareas (app.js); notas tienen su propio deleteNote.
       Probamos tareas primero y caemos a notas para mantener compat. */
    let { error } = await sb().from(TABLE.task).delete().eq('id', id);
    if (error) {
      const r = await sb().from(TABLE.note).delete().eq('id', id);
      if (r.error) throw r.error;
    }
    broadcastWrite();
  }

  /* ---------------- Notas ---------------- */

  async function getNotes() {
    const { data, error } = await sb().from(TABLE.note).select('*').order('updated_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map(rowToDoc);
  }

  async function saveNote({ id, titulo, materia, contenido, imagenes }) {
    /* imagenes: [{name, dataURL}] se guardan en JSONB; `stored` solo
       existía para adjuntos PouchDB y aquí se ignora con seguridad. */
    const payload = {
      titulo: (titulo || 'Sin título').trim() || 'Sin título',
      materia: materia || '',
      contenido: contenido || '',
      imagenes: (imagenes || [])
        .filter(img => img && !img.removed && img.dataURL)
        .map(img => ({ name: img.name || ('img_' + uid()), dataURL: img.dataURL })),
      updated_at: nowISO()
    };
    let doc;
    if (id) {
      const { data, error } = await sb().from(TABLE.note).update(payload).eq('id', id).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    } else {
      const { data, error } = await sb().from(TABLE.note).insert({ ...payload, created_at: nowISO() }).select().single();
      if (error) throw error;
      doc = rowToDoc(data);
    }
    broadcastWrite();
    return doc;
  }

  /* Genera blob URL desde la imagen JSONB (compat con note-thumbs y editor) */
  async function getAttachment(id, name) {
    try {
      const { data, error } = await sb().from(TABLE.note).select('imagenes').eq('id', id).single();
      if (error || !data) return null;
      const img = (data.imagenes || []).find(i => i.name === name);
      if (!img || !img.dataURL) return null;
      return img.dataURL;          // dataURL usable directo en <img src>
    } catch (e) {
      return null;
    }
  }

  /* Para exportJSON (app.js) */
  async function rawAll() {
    const out = [];
    for (const t of Object.values(TABLE)) {
      const { data, error } = await sb().from(t).select('*').limit(5000);
      if (!error && data) out.push(...data.map(r => ({ table: t, ...r })));
    }
    return out;
  }

  async function wipeAll() {
    for (const t of Object.values(TABLE)) {
      const { error } = await sb().from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    }
  }

  /* ---------------- Helpers de imagen (compat) ---------------- */

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

  return {
    TYPE, getSubjects, saveSubject, deleteSubject,
    getTasks, saveTask, toggleTask, deleteDoc,
    getNotes, saveNote, getAttachment,
    getClasses, upsertClass, deleteClass,
    dataURLtoBlob, blobToDataURL,
    rawAll, wipeAll,
    onRemoteChange, setChangeHook, scheduleRefresh,
    initBroadcast
  };
})();
