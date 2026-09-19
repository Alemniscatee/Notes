/* ============================================================
   AURA — editor.js
   Workspace estilo Obsidian:
   - Pestañas activas (+ nueva nota, cierre ×) e indicador de ruta
     (NOTAS / NombreNota).
   - Panel lateral replegable: árbol/lista de notas con línea de
     tiempo (conectores verticales) y cambio rápido entre notas.
   - Vista previa Markdown con diagramas Mermaid (```mermaid).
   - Split view (solo PC ≥1025px): dos notas en paralelo.
   - Importación de archivos .md y .pdf (pdf.js) → nuevas notas.
   - Contador de palabras/caracteres y exportación .md.
   Depende de: Store, UI, App, Exporter, Settings.
   ============================================================ */

const Editor = (() => {
  /* ================= Estado ================= */
  let seq = 0;                    // claves para pestañas de borrador
  let tabs = [];                  // [{ key }]
  const sessions = new Map();     // key -> { id, rev, titulo, contenido, materia, images[], dirty, previewOn, loaded }
  let activeKey = null;
  let images = [];                // alias del array de la pestaña activa
  let previewOn = false;

  let splitOpen = false;          // Split view (solo PC)
  let paneB = { id: null, rev: null, materia: '' };

  const $ = id => document.getElementById(id);
  const SPLIT_QUERY = '(min-width: 1025px)';

  function newSession(over = {}) {
    return {
      id: null, rev: null,
      titulo: '', contenido: '', materia: '',
      images: [], dirty: false, previewOn: false, loaded: false,
      ...over
    };
  }

  /* ================= Init ================= */
  function init() {
    $('editorBack').addEventListener('click', close);
    $('editorSaveBtn').addEventListener('click', () => save());
    $('editorPreviewBtn').addEventListener('click', togglePreview);
    $('editorImageBtn').addEventListener('click', () => $('editorImageInput').click());
    $('editorImageInput').addEventListener('change', onPickImages);
    $('editorLinkBtn').insertAdjacentText('afterbegin', ''); // noop keeps order
    $('editorLinkBtn').addEventListener('click', insertLink);
    $('editorContent').addEventListener('input', () => {
      const s = sessions.get(activeKey);
      if (s) s.dirty = true;
      updateCounter();
      if (previewOn) renderPreview();
    });
    $('editorTitle').addEventListener('input', () => {
      const s = sessions.get(activeKey);
      if (s) s.dirty = true;
      renderTabs();
      updateCrumb();
    });

    // Sidebar del workspace
    $('editorSideBtn').addEventListener('click', () =>
      $('view-editor').classList.toggle('side-open'));

    // Pestañas: nueva + delegación de clic/cierre
    $('editorTabNew').addEventListener('click', () => open(null));
    $('editorTabs').addEventListener('click', e => {
      const x = e.target.closest('[data-close-tab]');
      if (x) { e.stopPropagation(); closeTab(x.dataset.closeTab); return; }
      const tab = e.target.closest('[data-tab-key]');
      if (tab) activateTab(tab.dataset.tabKey);
    });

    // Breadcrumb: regresa a la vista de notas
    $('editorCrumb').addEventListener('click', () => App.showView('notes', { back: true }));

    // Exportar nota activa en .md
    $('editorExportBtn').addEventListener('click', () => {
      Exporter.exportNoteMD({
        id: sessionOf(activeKey)?.id,
        titulo: $('editorTitle').value.trim(),
        contenido: $('editorContent').value,
        materia: $('editorMateria').value
      });
    });

    // Importar .md / .pdf
    $('editorImportBtn').addEventListener('click', () => $('editorImportInput').click());
    $('editorImportInput').addEventListener('change', e => {
      const files = [...e.target.files];
      e.target.value = '';
      importFiles(files);
    });

    // Split view (solo PC)
    $('editorSplitBtn').addEventListener('click', toggleSplit);
    $('paneBClose').addEventListener('click', closeSplit);
    $('paneBSaveBtn').addEventListener('click', savePaneB);
    $('paneBSelect').addEventListener('change', e => loadPaneB(e.target.value));
    $('paneBContent').addEventListener('input', updatePaneBCounter);
    $('paneBTitle').addEventListener('input', updatePaneBCounter);
  }

  const sessionOf = key => sessions.get(key);

  /* ================= Apertura (crea/activa pestaña) ================= */
  function open(id = null) {
    // ¿Ya existe una pestaña con esa nota?
    if (id) {
      for (const [key, s] of sessions) {
        if (s.id === id) {
          activateTab(key);
          App.showView('editor');
          $('editorTitle').focus();
          return;
        }
      }
    }

    const key = id || 'draft-' + (++seq);
    const s = newSession(id ? { id, loaded: false } : {});
    sessions.set(key, s);
    tabs.push({ key });
    $('view-editor').classList.toggle('mode-existing', !!id);
    activateTab(key);
    App.showView('editor');
    $('editorTitle').focus();
  }

  /* ================= Pestañas ================= */
  function renderTabs() {
    const wrap = $('editorTabs');
    wrap.innerHTML = tabs.map(({ key }) => {
      const s = sessionOf(key);
      const label = s.titulo || (s.id ? 'Sin título' : 'Nueva nota');
      return `
        <span class="edt-tab ${key === activeKey ? 'active' : ''}" data-tab-key="${key}" title="${UI.escapeAttr(label)}">
          <span class="edt-tab-dot ${s.dirty ? 'dirty' : ''}"></span>
          <span class="edt-tab-title">${UI.escapeHTML(label)}</span>
          <button class="edt-tab-x" data-close-tab="${key}" aria-label="Cerrar pestaña">
            <span class="material-symbols-outlined">close</span>
          </button>
        </span>`;
    }).join('');
  }

  function updateCrumb() {
    const s = sessionOf(activeKey);
    const label = s?.titulo || (s?.id ? 'Sin título' : 'Nueva nota');
    $('editorCrumb').innerHTML =
      `<span class="material-symbols-outlined" style="font-size:13px;">folder_open</span> NOTAS / <b>${UI.escapeHTML(label)}</b>`;
  }

  /* Guarda el DOM en la sesión de la pestaña saliente */
  function stashActive() {
    const s = sessionOf(activeKey);
    if (!s) return;
    s.titulo = $('editorTitle').value;
    s.contenido = $('editorContent').value;
    s.materia = $('editorMateria').value;
    s.previewOn = previewOn;
  }

  /* Carga una sesión en el DOM del editor */
  function loadSessionToDOM(s) {
    images = s.images;
    previewOn = s.previewOn;
    $('editorTitle').value = s.titulo;
    $('editorContent').value = s.contenido;
    $('editorMateria').value = s.materia;
    $('editorPreview').hidden = !previewOn;
    $('editorContent').hidden = previewOn;
    $('editorPreviewBtn').innerHTML = previewOn ? '✏️ Editar' : '👁️ Vista previa';
    renderAttachRow();
    updateCounter();
    updateCrumb();
    fillMaterias();

    if (!s.loaded && s.id) {
      Store.getNotes().then(notes => {
        if (sessionOf(activeKey) !== s) return;      // ya cambiaron de pestaña
        const n = notes.find(x => x._id === s.id);
        if (!n) return;
        s.titulo = n.titulo || '';
        s.contenido = n.contenido || '';
        s.materia = n.materia || '';
        s.rev = n._rev;
        s.loaded = true;
        // Refleja solo si sigue en pantalla
        $('editorTitle').value = s.titulo;
        $('editorContent').value = s.contenido;
        $('editorMateria').value = s.materia;
        loadAttachments(n);
        updateCounter();
        updateCrumb();
        renderTabs();
      });
    } else if (!s.id) {
      s.loaded = true;
    }
  }

  let materiasFilled = '';
  async function fillMaterias() {
    const subjects = await Store.getSubjects();
    const sig = subjects.map(s => s.nombre).join('|');
    if (sig === materiasFilled) return;              // evita re-render al alternar
    materiasFilled = sig;
    $('editorMateria').innerHTML = '<option value="">Sin materia</option>' +
      '<option value="VIDA_COTIDIANA">🏠 Vida Cotidiana (Sin materia)</option>' +
      subjects.map(s => `<option value="${UI.escapeAttr(s.nombre)}">${UI.escapeHTML(s.nombre)}</option>`).join('');
  }

  function activateTab(key) {
    if (!sessions.has(key)) return;
    if (activeKey && activeKey !== key) stashActive();
    activeKey = key;
    renderTabs();
    loadSessionToDOM(sessionOf(key));
    renderEditorSide();
  }

  async function closeTab(key) {
    const s = sessionOf(key);
    if (s && s.dirty) { try { await saveKey(key, { silent: true }); } catch (e) { /* no bloquea el cierre */ } }
    sessions.delete(key);
    tabs = tabs.filter(t => t.key !== key);
    if (!tabs.length) { open(null); return; }        // Obsidian: nunca queda 0 pestañas
    if (activeKey === key) {
      const idx = Math.max(0, tabs.findIndex(t => t.key === key) - 1);
      activateTab(tabs[Math.min(idx, tabs.length - 1)].key);
    } else {
      renderTabs();
    }
  }

  /* ================= Sidebar: notas + timeline ================= */
  function dayLabel(v) {
    if (!v) return 'Sin fecha';
    const d = new Date(v);
    if (isNaN(d)) return 'Sin fecha';
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const key = UI.dayKey(d);
    if (key === UI.dayKey(new Date())) return 'Hoy';
    if (key === UI.dayKey(yest)) return 'Ayer';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function renderEditorSide() {
    const list = $('editorNotesList');
    if (!list) return;
    try {
      const notes = (await Store.getNotes())
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (!notes.length) {
        list.innerHTML = '<div class="muted small" style="padding:10px 4px;">Aún no hay otras notas.</div>';
        return;
      }

      let html = '';
      let lastLabel = null;
      for (const n of notes) {
        const label = dayLabel(n.updatedAt || n.createdAt);
        if (label !== lastLabel) {
          html += `<div class="edt-tl-date">${label}</div>`;
          lastLabel = label;
        }
        const c = UI.colorFor(n.materia, App.subjectsCache);
        const isOpen = tabs.some(({ key }) => sessionOf(key)?.id === n._id);
        html += `
          <button class="edt-tl-item ${n._id === sessionOf(activeKey)?.id ? 'current' : ''}" data-note="${n._id}">
            <span class="edt-tl-dot" style="background:${c};box-shadow:0 0 8px ${c};"></span>
            <span class="edt-tl-body">
              <span class="edt-tl-title">${UI.escapeHTML(n.titulo || 'Sin título')}${isOpen ? ' ·' : ''}</span>
              <span class="edt-tl-time">${n.updatedAt ? UI.fmtTime(new Date(n.updatedAt)) : ''}</span>
            </span>
          </button>`;
      }
      list.innerHTML = html;

      list.querySelectorAll('[data-note]').forEach(btn =>
        btn.addEventListener('click', () => switchNote(btn.dataset.note)));
    } catch (e) {
      list.innerHTML = '<div class="muted small" style="padding:10px 4px;">No se pudo cargar la lista.</div>';
    }
  }

  /* Alterna a otra nota (abre pestaña o activa la existente) */
  function switchNote(id) {
    if (id === sessionOf(activeKey)?.id) return;
    open(id);
  }

  /* ================= Adjuntos ================= */
  async function loadAttachments(note) {
    const s = sessionOf(activeKey);
    if (!s) return;
    s.images = [];
    images = s.images;
    const names = Object.keys(note._attachments || {});
    for (const name of names) {
      const url = await Store.getAttachment(note._id, name);
      if (url) images.push({ name, stored: true, url });
    }
    renderAttachRow();
  }

  function renderAttachRow() {
    const row = $('editorAttachRow');
    row.innerHTML = images.map((img, i) => `
      <div class="attach-thumb">
        <img src="${img.dataURL || img.url}" alt="adjunto">
        <button data-rm="${i}" aria-label="Quitar imagen">✕</button>
      </div>`).join('');
    row.querySelectorAll('[data-rm]').forEach(b =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.rm);
        images.splice(i, 1);
        renderAttachRow();
        const s = sessionOf(activeKey);
        if (s) s.dirty = true;
      }));
  }

  async function onPickImages(e) {
    const files = [...e.target.files];
    for (const f of files) {
      const dataURL = await Store.blobToDataURL(f);
      images.push({ name: f.name, dataURL });
    }
    e.target.value = '';
    renderAttachRow();
    const s = sessionOf(activeKey);
    if (s) s.dirty = true;
  }

  /* ================= Markdown + Mermaid ================= */
  function insertLink() {
    const ta = $('editorContent');
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const selected = ta.value.slice(start, end);
    const insert = `[[${selected || 'Nota/Materia'}]]`;
    ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = start + 2;
    ta.selectionEnd = start + insert.length - 2;
    const s = sessionOf(activeKey);
    if (s) s.dirty = true;
  }

  function togglePreview() {
    previewOn = !previewOn;
    $('editorPreview').hidden = !previewOn;
    $('editorContent').hidden = previewOn;
    $('editorPreviewBtn').innerHTML = previewOn ? '✏️ Editar' : '👁️ Vista previa';
    const s = sessionOf(activeKey);
    if (s) s.previewOn = previewOn;
    if (previewOn) renderPreview();
  }

  function renderPreview() {
    const el = $('editorPreview');
    el.innerHTML = UI.mdToHTML($('editorContent').value);
    UI.renderCodeBlocks(el);   // convierte ```mermaid en diagramas
  }

  /* ================= Contador ================= */
  function updateCounter() {
    const el = $('editorCounter');
    if (!el) return;
    const text = $('editorContent').value;
    const words = (text.trim().match(/\S+/g) || []).length;
    el.textContent = `${words} palabras · ${text.length} caracteres`;
  }

  /* ================= Guardado ================= */
  async function saveKey(key, opts = {}) {
    const s = sessionOf(key);
    if (!s) return null;
    if (key === activeKey) stashActive();

    const titulo = (s.titulo || '').trim() || 'Sin título';
    const wasNew = !s.id;

    if (s.materia) await App.ensureSubject(s.materia);

    const doc = await Store.saveNote({
      id: s.id,
      titulo,
      materia: s.materia,
      contenido: s.contenido,
      imagenes: s.images.map(img => img.stored
        ? { stored: img.name }
        : { name: img.name, dataURL: img.dataURL })
    });

    s.id = doc._id;
    s.rev = doc._rev;
    s.dirty = false;
    s.loaded = true;
    s.images = s.images.map(img => img.stored ? img : { ...img, stored: img.name, url: null });

    // La pestaña de borrador pasa a identificarse por el id real de la nota
    if (key !== doc._id) {
      sessions.delete(key);
      sessions.set(doc._id, s);
      const t = tabs.find(t => t.key === key);
      if (t) t.key = doc._id;
      if (activeKey === key) activeKey = doc._id;
    }

    renderTabs();
    updateCrumb();
    renderEditorSide();
    if (!opts.silent) UI.toast('Nota guardada ✓', 'ok');
    App.refreshAll();

    // FLUJO LIMPIO: guardar una nota NUEVA (manual) cierra su pestaña
    // y regresa a la vista principal.
    if (wasNew && !opts.silent) {
      await closeTab(doc._id);
      App.showView('dashboard');
    }
    return doc;
  }

  async function save(opts = {}) {
    if (!activeKey) return null;
    return saveKey(activeKey, opts);
  }

  function close() {
    const finish = () => App.showView('notes', { back: true });
    const s = sessionOf(activeKey);
    if (s && s.dirty) saveKey(activeKey, { silent: true }).then(finish);
    else finish();
  }

  /* ================= SPLIT VIEW (solo PC) ================= */
  function canSplit() { return window.matchMedia(SPLIT_QUERY).matches; }

  function toggleSplit() {
    if (!canSplit()) {
      UI.toast('La vista dividida está disponible en PC (pantalla > 1024px)', 'info', 3600);
      return;
    }
    splitOpen = !splitOpen;
    $('view-editor').classList.toggle('split-open', splitOpen);
    $('editorPaneB').hidden = !splitOpen;
    if (splitOpen) fillPaneB();
  }

  function closeSplit() {
    splitOpen = false;
    $('view-editor').classList.remove('split-open');
    $('editorPaneB').hidden = true;
  }

  async function fillPaneB() {
    const notes = (await Store.getNotes())
      .filter(n => n._id !== sessionOf(activeKey)?.id);
    const sel = $('paneBSelect');
    sel.innerHTML = notes.map(n =>
      `<option value="${UI.escapeAttr(n._id)}">${UI.escapeHTML(n.titulo || 'Sin título')}</option>`).join('');
    if (notes.length) loadPaneB(notes[0]._id);
    else $('paneBContent').value = '';
    updatePaneBCounter();
  }

  async function loadPaneB(id) {
    if (!id) return;
    try {
      const notes = await Store.getNotes();
      const n = notes.find(x => x._id === id);
      if (!n) return;
      paneB = { id: n._id, rev: n._rev, materia: n.materia || '' };
      $('paneBTitle').value = n.titulo || '';
      $('paneBContent').value = n.contenido || '';
      updatePaneBCounter();
    } catch (e) {
      UI.toast('No se pudo abrir la nota en el panel B', 'err');
    }
  }

  async function savePaneB() {
    const titulo = $('paneBTitle').value.trim() || 'Sin título';
    const contenido = $('paneBContent').value;
    if (paneB.materia) await App.ensureSubject(paneB.materia);
    const doc = await Store.saveNote({
      id: paneB.id, titulo, materia: paneB.materia, contenido, imagenes: []
    });
    paneB.rev = doc._rev;
    UI.toast('Panel B guardado ✓', 'ok');
    App.refreshAll();
  }

  function updatePaneBCounter() {
    const el = $('paneBCounter');
    if (!el) return;
    const text = $('paneBContent').value;
    const words = (text.trim().match(/\S+/g) || []).length;
    el.textContent = `${words} palabras · ${text.length} caracteres`;
  }

  /* ================= IMPORTACIÓN (.md / .pdf) ================= */
  function readFileText(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();                 // FileReader, como pide el spec
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(new Error('No se pudo leer el archivo'));
      fr.readAsText(file);
    });
  }

  async function importFiles(files) {
    for (const f of files) {
      const base = f.name.replace(/\.(md|markdown|pdf)$/i, '').trim() || 'Importada';
      try {
        if (/\.pdf$/i.test(f.name)) {
          await importPDF(f, base);
        } else {
          const text = await readFileText(f);
          const doc = await Store.saveNote({ titulo: base, materia: '', contenido: text });
          UI.toast(`Markdown importado: ${base} ✓`, 'ok');
          App.refreshAll();
          open(doc._id);                            // queda abierta en una pestaña
        }
      } catch (e) {
        UI.toast(`No se pudo importar ${f.name}: ${e.message}`, 'err', 5000);
      }
    }
  }

  /* Extrae el texto legible del PDF con pdf.js (CDN) y crea la nota */
  async function importPDF(file, base) {
    if (!window.pdfjsLib) throw new Error('pdf.js no está disponible (¿sin conexión?)');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

    let text = '';
    const maxPages = Math.min(pdf.numPages, 60);    // tope sensato por rendimiento
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      text += tc.items.map(it => it.str).join(' ') + '\n\n';
    }
    if (pdf.numPages > maxPages) text += `\n_(…${pdf.numPages - maxPages} páginas restantes no extraídas)_`;
    if (!text.trim()) text = '(El PDF no contenía texto extraíble; probablemente es un escaneo de imágenes.)';

    const doc = await Store.saveNote({ titulo: base, materia: '', contenido: text.trim() });
    UI.toast(`PDF importado: ${base} (${maxPages} pág.) ✓`, 'ok');
    App.refreshAll();
    open(doc._id);
  }

  /* ================= API pública ================= */
  return { init, open, save, close, importFiles, toggleSplit };
})();
