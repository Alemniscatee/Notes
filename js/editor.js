/* ============================================================
   AURA — editor.js
   Editor de notas: Markdown, [[wikilinks]], imágenes en PouchDB
   (attachments), vista previa renderizada y autoguardado.
   Depende de: Store, UI, App.
   ============================================================ */

const Editor = (() => {
  let currentId = null;
  let currentRev = null;
  let images = [];          // [{ name, dataURL, stored }]
  let dirty = false;
  let previewOn = false;

  const $ = id => document.getElementById(id);

  function init() {
    $('editorBack').addEventListener('click', close);
    $('editorSaveBtn').addEventListener('click', save);
    $('editorPreviewBtn').addEventListener('click', togglePreview);
    $('editorImageBtn').addEventListener('click', () => $('editorImageInput').click());
    $('editorImageInput').addEventListener('change', onPickImages);
    $('editorLinkBtn').insertAdjacentText('afterbegin', ''); // noop keeps order
    $('editorLinkBtn').addEventListener('click', insertLink);
    $('editorContent').addEventListener('input', () => { dirty = true; if (previewOn) renderPreview(); });
    $('editorTitle').addEventListener('input', () => { dirty = true; });
  }

  function open(id = null) {
    currentId = id;
    currentRev = null;
    images = [];
    dirty = false;
    previewOn = false;
    $('editorPreview').hidden = true;
    $('editorContent').hidden = false;
    $('editorPreviewBtn').innerHTML = '👁️ Vista previa';
    $('editorHeading').textContent = id ? 'Editar nota' : 'Nueva nota';

    const fillMaterias = async () => {
      const subjects = await Store.getSubjects();
      $('editorMateria').innerHTML = '<option value="">Sin materia</option>' +
        '<option value="VIDA_COTIDIANA">🏠 Vida Cotidiana (Sin materia)</option>' +
        subjects.map(s => `<option value="${UI.escapeAttr(s.nombre)}">${UI.escapeHTML(s.nombre)}</option>`).join('');
    };
    fillMaterias();

    if (id) {
      Store.getNotes().then(notes => {
        const n = notes.find(x => x._id === id);
        if (!n) return;
        $('editorTitle').value = n.titulo || '';
        $('editorMateria').value = n.materia || '';
        $('editorContent').value = n.contenido || '';
        currentRev = n._rev;
        loadAttachments(n);
      });
    } else {
      $('editorTitle').value = '';
      $('editorMateria').value = '';
      $('editorContent').value = '';
    }
    $('editorAttachRow').innerHTML = '';
    App.showView('editor');
    $('editorTitle').focus();
  }

  async function loadAttachments(note) {
    images = [];
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
        dirty = true;
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
    dirty = true;
  }

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
    dirty = true;
  }

  function togglePreview() {
    previewOn = !previewOn;
    $('editorPreview').hidden = !previewOn;
    $('editorContent').hidden = previewOn;
    $('editorPreviewBtn').innerHTML = previewOn ? '✏️ Editar' : '👁️ Vista previa';
    if (previewOn) renderPreview();
  }

  function renderPreview() {
    $('editorPreview').innerHTML = UI.mdToHTML($('editorContent').value);
  }

  async function save() {
    const titulo = $('editorTitle').value.trim() || 'Sin título';
    const contenido = $('editorContent').value;
    const materia = $('editorMateria').value;

    // Asegura que la materia exista como subject doc
    if (materia) await App.ensureSubject(materia);

    const doc = await Store.saveNote({
      id: currentId,
      titulo,
      materia,
      contenido,
      imagenes: images.map(img => img.stored
        ? { stored: img.name }
        : { name: img.name, dataURL: img.dataURL })
    });

    dirty = false;
    currentId = doc._id;
    currentRev = doc._rev;
    images = images.map(img => img.stored ? img : { ...img, stored: img.name, url: null });
    $('editorHeading').textContent = 'Editar nota';
    UI.toast('Nota guardada ✓', 'ok');
    App.refreshAll();
    return doc;
  }

  function close() {
    const finish = () => App.showView('notes', { back: true });
    if (dirty) save().then(finish);
    else finish();
  }

  return { init, open, save, close };
})();
