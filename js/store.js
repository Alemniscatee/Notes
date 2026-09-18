/* ============================================================
   AURA — store.js
   CRUD + queries over PouchDB for tasks, notes, subjects.
   Images stored as PouchDB attachments (blobs/dataURLs).
   ============================================================ */

const Store = (() => {
  const TYPE = { TASK: 'task', NOTE: 'note', SUBJECT: 'subject', CLASS: 'class' };

  const uid = () =>
    'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);

  /* ---------------- Subjects ---------------- */

  async function getSubjects() {
    const res = await DB.get().find({
      selector: { type: TYPE.SUBJECT },
      limit: 200
    });
    return res.docs.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  async function saveSubject(nombre, color, extras = {}, id = null) {
    let doc;
    if (id) {
      doc = await DB.get().get(id);
    } else {
      doc = { _id: uid(), type: TYPE.SUBJECT, createdAt: Date.now() };
    }
    doc.nombre = (nombre || doc.nombre || '').trim();
    doc.color = color || doc.color || '#8b5cf6';
    if (extras) {
      if (extras.codigo !== undefined) doc.codigo = String(extras.codigo).trim();
      if (extras.profesor !== undefined) doc.profesor = String(extras.profesor).trim();
    }
    doc.updatedAt = Date.now();
    const r = await DB.get().put(doc);
    return { ...doc, _rev: r.rev };
  }

  async function deleteSubject(id, rev) {
    return DB.get().remove(id, rev);
  }

  /* ---------------- Classes (Horario Académico fijo) ----------------
     { _id, type:'class', materiaId, materia, aula, inicio, fin, dias:[1..6] }
     `materiaId` referencia al subject; `materia` es snapshot del nombre
     para sobrevivir renombres/borrados de la materia.                  */

  async function getClasses() {
    const res = await DB.get().find({
      selector: { type: TYPE.CLASS },
      limit: 500
    });
    return res.docs.sort((a, b) =>
      (a.inicio || '').localeCompare(b.inicio || '') ||
      (a.materia || '').localeCompare(b.materia || ''));
  }

  async function upsertClass({ id, materiaId, materia, aula, inicio, fin, dias }) {
    let doc;
    if (id) {
      doc = await DB.get().get(id);
    } else {
      doc = { _id: uid(), type: TYPE.CLASS, createdAt: Date.now() };
    }
    doc.materiaId = materiaId || null;
    doc.materia = (materia || '').trim();
    doc.aula = (aula || '').trim();
    doc.inicio = inicio || '08:00';
    doc.fin = fin || '09:00';
    doc.dias = (dias || []).map(Number).filter(d => d >= 1 && d <= 6).sort((a, b) => a - b);
    doc.updatedAt = Date.now();
    const r = await DB.get().put(doc);
    return { ...doc, _rev: r.rev };
  }

  async function deleteClass(id) {
    const doc = await DB.get().get(id);
    return DB.get().remove(doc);
  }

  /* ---------------- Tasks ---------------- */

  async function getTasks() {
    const res = await DB.get().find({
      selector: { type: TYPE.TASK },
      limit: 1000
    });
    return res.docs.sort((a, b) => {
      if (!!a.hecho !== !!b.hecho) return a.hecho ? 1 : -1;
      const da = a.vence || '9999';
      const db2 = b.vence || '9999';
      return da.localeCompare(db2);
    });
  }

  async function saveTask({ id, titulo, materia, vence, contenido, hecho }) {
    let doc;
    if (id) {
      doc = await DB.get().get(id);
    } else {
      doc = { _id: uid(), type: TYPE.TASK, createdAt: Date.now() };
    }
    doc.titulo = (titulo || '').trim();
    doc.materia = materia || '';
    doc.vence = vence || null;          // ISO date or datetime string
    doc.contenido = contenido || '';
    if (typeof hecho === 'boolean') doc.hecho = hecho;
    else if (doc.hecho === undefined) doc.hecho = false;
    doc.updatedAt = Date.now();
    const r = await DB.get().put(doc);
    return { ...doc, _rev: r.rev };
  }

  async function toggleTask(id) {
    const doc = await DB.get().get(id);
    doc.hecho = !doc.hecho;
    doc.updatedAt = Date.now();
    const r = await DB.get().put(doc);
    return { ...doc, _rev: r.rev };
  }

  async function deleteDoc(id) {
    const doc = await DB.get().get(id);
    return DB.get().remove(doc);
  }

  /* ---------------- Notes ---------------- */

  async function getNotes() {
    const res = await DB.get().find({
      selector: { type: TYPE.NOTE },
      limit: 1000
    });
    return res.docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function saveNote({ id, titulo, materia, contenido, imagenes }) {
    let doc;
    if (id) {
      doc = await DB.get().get(id);
    } else {
      doc = { _id: uid(), type: TYPE.NOTE, createdAt: Date.now() };
    }
    doc.titulo = (titulo || 'Sin título').trim();
    doc.materia = materia || '';
    doc.contenido = contenido || '';
    doc.updatedAt = Date.now();

    const attachments = {};
    (imagenes || []).forEach(img => {
      if (img.removed) return;
      if (img.dataURL) {
        const blob = dataURLtoBlob(img.dataURL);
        attachments[img.name || 'img_' + uid()] = {
          blob,
          content_type: blob.type || 'image/jpeg'
        };
      } else if (img.stored && !attachments[img.stored]) {
        // keep existing attachment untouched
        attachments[img.stored] = { skip: true };
      }
    });

    const putData = { ...doc };
    const keys = Object.keys(attachments);
    if (keys.length) {
      // remove attachments that are gone
      const existing = doc._attachments || {};
      Object.keys(existing).forEach(k => {
        if (!keys.includes(k)) putData._attachments = putData._attachments || {};
      });
      const atts = {};
      for (const [k, v] of Object.entries(attachments)) {
        if (v.skip) { atts[k] = existing[k]; }
        else atts[k] = { data: v.blob, content_type: v.content_type };
      }
      putData._attachments = atts;
    } else if (doc._attachments && Object.keys(doc._attachments).length) {
      putData._attachments = {};
    }

    const r = await DB.get().put(putData);
    return { ...putData, _rev: r.rev };
  }

  async function getAttachment(id, name) {
    try {
      const blob = await DB.get().getAttachment(id, name);
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  /* ---------------- Helpers ---------------- */

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

  /* Sync change hook (registered later by app.js) */
  let changeHook = null;
  function onRemoteChange() { changeHook && changeHook(); }
  function setChangeHook(fn) { changeHook = fn; }

  /* Live update: refresh current view when remote changes land */
  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => changeHook && changeHook(), 600);
  }

  return {
    TYPE, getSubjects, saveSubject, deleteSubject,
    getTasks, saveTask, toggleTask, deleteDoc,
    getNotes, saveNote, getAttachment,
    getClasses, upsertClass, deleteClass,
    dataURLtoBlob, blobToDataURL,
    onRemoteChange, setChangeHook, scheduleRefresh
  };
})();
