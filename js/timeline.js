/* ============================================================
   AURA — timeline.js
   Línea de Tiempo de notas:
   - Fecha exacta -> notas creadas o modificadas ese día.
   - Si no hay, las 5 notas MÁS CERCANAS cronológicamente
     (anteriores o posteriores) con insignia "A X días de distancia".
   Búsqueda en memoria sobre Store (IndexedDB/PouchDB, no bloquea UI).
   Depende de: Store, UI, App.
   ============================================================ */

const Timeline = (() => {
  const $ = id => document.getElementById(id);
  const NEARBY_LIMIT = 5;

  function init() {
    $('timelineBtn').addEventListener('click', open);
    $('timelineDatePicker').addEventListener('change', () => render());

    // Fecha por defecto: hoy
    const today = new Date();
    $('timelineDatePicker').value = UI.dayKey(today);
  }

  function open() {
    if (!$('timelineDatePicker').value) {
      $('timelineDatePicker').value = UI.dayKey(new Date());
    }
    UI.openModal('timelineModal');
    render();
  }

  /* ---------------- Core ---------------- */
  function noteStamp(n) {
    // Prioriza updatedAt (edición); fallback createdAt
    const t = n.updatedAt || n.createdAt;
    const d = new Date(t || 0);
    return isNaN(d) ? null : d;
  }

  async function render() {
    const info = $('timelineInfo');
    const results = $('timelineResults');

    const val = $('timelineDatePicker').value; // YYYY-MM-DD
    if (!val) return;

    const notes = await Store.getNotes();
    const stamped = notes
      .map(n => ({ note: n, date: noteStamp(n) }))
      .filter(x => x.date);

    const targetStart = new Date(val + 'T00:00:00');
    const targetEnd = new Date(val + 'T23:59:59.999');

    // 1) Coincidencias exactas del día (creación o edición)
    const exact = stamped
      .filter(x => x.date >= targetStart && x.date <= targetEnd)
      .sort((a, b) => b.date - a.date);

    info.hidden = true;
    if (exact.length) {
      results.innerHTML = exact.map(x => card(x.note, null)).join('');
      bindCards(results);
      return;
    }

    // 2) REGLA CRÍTICA: sin coincidencias -> 5 más cercanas por |diferencia|
    if (!stamped.length) {
      results.innerHTML = emptyState('Todavía no hay notas en tu bóveda.');
      return;
    }

    const targetMid = new Date(val + 'T12:00:00').getTime();
    const nearest = stamped
      .map(x => ({ ...x, diff: Math.abs(x.date.getTime() - targetMid) }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, NEARBY_LIMIT);

    info.hidden = false;
    info.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:16px;">info</span>
      Sin notas el ${UI.fmtDate(targetStart)} — mostrando las ${nearest.length} más cercanas:`;

    results.innerHTML = nearest
      .sort((a, b) => b.date - a.date)
      .map(x => card(x.note, daysBetween(targetStart, x.date)))
      .join('');
    bindCards(results);
  }

  function daysBetween(from, to) {
    const a = new Date(from); a.setHours(12, 0, 0, 0);
    const b = new Date(to); b.setHours(12, 0, 0, 0);
    return Math.round(Math.abs(b - a) / 86400000);
  }

  /* ---------------- Tarjetas ---------------- */
  function card(note, distDays) {
    const c = note.materia === 'VIDA_COTIDIANA'
      ? 'var(--cyan)'
      : UI.colorFor(note.materia, App.subjectsCache);
    const label = note.materia === 'VIDA_COTIDIANA'
      ? '🏠 Vida Cotidiana'
      : UI.escapeHTML(note.materia || 'General');
    const d = noteStamp(note);
    const badge = distDays !== null && distDays !== undefined
      ? `<span class="timeline-dist"><span class="material-symbols-outlined" style="font-size:12px;">near_me</span> A ${distDays} día${distDays === 1 ? '' : 's'} de distancia</span>`
      : '';
    return `
      <div class="timeline-note card card--hover" data-note="${UI.escapeAttr(note._id)}">
        <div class="tn-marker" style="background:${c};box-shadow:0 0 10px ${c};"></div>
        <div class="tn-body">
          <div class="tn-title">${UI.escapeHTML(note.titulo || 'Sin título')}</div>
          <p class="tn-preview">${UI.escapeHTML(UI.stripMarkdown(note.contenido).slice(0, 120))}</p>
          <div class="tn-meta">
            <span class="materia-tag" style="background:${c}22;color:${c};">${label}</span>
            <span class="tn-date">${d ? UI.fmtDateTime(d) : ''}</span>
            ${badge}
          </div>
        </div>
      </div>`;
  }

  function emptyState(msg) {
    return `
      <div class="empty empty--sm">
        <span class="material-symbols-outlined">timeline</span>
        <p>${UI.escapeHTML(msg)}</p>
      </div>`;
  }

  function bindCards(root) {
    root.querySelectorAll('[data-note]').forEach(el =>
      el.addEventListener('click', () => {
        UI.closeModal('timelineModal');
        App.openEditor(el.dataset.note);
      }));
  }

  return { init, open, render };
})();
