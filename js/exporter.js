/* ============================================================
   AURA — exporter.js
   Módulo de exportación de datos:
   a) Nota individual en Markdown (.md)
   b) Respaldo global de todas las notas en un único .json
   Depende de: Store, UI.  (NO toca js/db.js ni la sincronización)
   ============================================================ */

const Exporter = (() => {

  /* ---------------- Helpers de descarga ---------------- */
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function safeName(str) {
    return String(str || 'nota')
      .replace(/[\\/:*?"<>|#]+/g, '-')
      .trim()
      .slice(0, 80) || 'nota';
  }

  /* ---------------- a) Nota individual (.md) ---------------- */
  /* Exporta el contenido tal cual se está editando (o el guardado
     si se pasa un id de nota ya persistida). */
  async function exportNoteMD({ id = null, titulo = '', contenido = '', materia = '' } = {}) {
    let t = titulo;
    let c = contenido;
    let m = materia;

    // Si no llegó texto, intenta recuperar la nota guardada por id
    if (id && !(c || '').trim()) {
      try {
        const notes = await Store.getNotes();
        const n = notes.find(x => x._id === id);
        if (n) { t = t || n.titulo; c = c || n.contenido; m = m || n.materia; }
      } catch (e) { /* fallback: usa lo que haya en pantalla */ }
    }

    if (!(c || '').trim() && !(t || '').trim()) {
      UI.toast('No hay contenido que exportar', 'err');
      return;
    }

    const header =
      `# ${t || 'Sin título'}\n\n` +
      (m ? `> Materia: **${m}** · Exportado desde AURA el ${new Date().toLocaleString('es-ES')}\n\n` : '');
    const blob = new Blob([header + (c || '')], { type: 'text/markdown;charset=utf-8' });
    download(blob, `${safeName(t)}.md`);
    UI.toast('Nota exportada en Markdown ✓', 'ok');
  }

  /* ---------------- b) Respaldo global de notas (.json) ---------------- */
  async function exportAllNotesJSON() {
    try {
      const notes = await Store.getNotes();
      const payload = {
        app: 'AURA Life Dashboard',
        kind: 'notes-backup',
        exportedAt: new Date().toISOString(),
        count: notes.length,
        notes: notes.map(n => ({
          _id: n._id,
          titulo: n.titulo || '',
          materia: n.materia || '',
          contenido: n.contenido || '',
          createdAt: n.createdAt || null,
          updatedAt: n.updatedAt || null,
          adjuntos: Object.keys(n._attachments || {})
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      download(blob, `aura-notas-${UI.dayKey(new Date())}.json`);
      UI.toast(`Respaldo exportado: ${notes.length} nota${notes.length === 1 ? '' : 's'} ✓`, 'ok');
    } catch (e) {
      UI.toast('Error exportando respaldo: ' + e.message, 'err');
    }
  }

  return { exportNoteMD, exportAllNotesJSON };
})();
