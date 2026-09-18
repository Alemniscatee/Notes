/* ============================================================
   AURA — ui.js
   Utilidades de UI: toasts, modales, ripple, markdown, fechas,
   badges de materia y selector compartido.
   ============================================================ */

const UI = (() => {
  /* ---------------- Toasts ---------------- */
  function toast(msg, kind = 'info', ms = 3200) {
    const icons = { ok: 'check_circle', err: 'error', info: 'info' };
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.innerHTML = `<span class="material-symbols-outlined">${icons[kind] || 'info'}</span><span>${escapeHTML(msg)}</span>`;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  /* ---------------- Modales ---------------- */
  function openModal(id) {
    const root = document.getElementById(id);
    if (!root) return;
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    const root = document.getElementById(id);
    if (!root) return;
    root.classList.remove('open');
    if (!document.querySelector('.modal-root.open')) document.body.style.overflow = '';
  }
  function initModals() {
    document.querySelectorAll('.modal-root').forEach(root => {
      root.querySelectorAll('[data-close]').forEach(btn =>
        btn.addEventListener('click', () => closeModal(root.id)));
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.modal-root.open').forEach(r => closeModal(r.id));
    });
  }

  /* ---------------- Ripple ---------------- */
  function initRipple() {
    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.btn, .chip, .nav-item, .voice-orb');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const span = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - rect.left - size / 2) + 'px';
      span.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(span);
      setTimeout(() => span.remove(), 600);
    });
  }

  /* ---------------- Markdown ---------------- */
  function mdToHTML(md) {
    if (!md) return '';
    let html;
    if (window.marked) {
      marked.setOptions({ breaks: true, gfm: true });
      html = marked.parse(md);
    } else {
      // fallback minimal
      html = md
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.*)$/gm, '<h3>$1</h3>')
        .replace(/^## (.*)$/gm, '<h2>$1</h2>')
        .replace(/^# (.*)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }
    // [[Wikilinks]] -> enlaces a notas/materias
    html = html.replace(/\[\[([^\]]+)\]\]/g, (_, t) =>
      `<a href="#" class="wlink" data-wikilink="${escapeAttr(t.trim())}">${escapeHTML(t.trim())}</a>`);
    return html;
  }

  function stripMarkdown(md) {
    return (md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_>`~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------------- Fechas ---------------- */
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  function fmtTime(d) {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(d) {
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`;
  }
  function fmtDateTime(v) {
    if (!v) return 'Sin fecha';
    const d = new Date(v);
    if (isNaN(d)) return 'Sin fecha';
    return `${fmtDate(d)} · ${fmtTime(d)}`;
  }
  function dayKey(d) { // YYYY-MM-DD local
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function relTime(v) {
    const d = new Date(v);
    if (isNaN(d)) return '';
    const diff = d - Date.now();
    const abs = Math.abs(diff);
    const mins = Math.round(abs / 60000);
    const hours = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);
    let txt;
    if (mins < 60) txt = `${mins} min`;
    else if (hours < 24) txt = `${hours} h`;
    else txt = `${days} d`;
    return diff >= 0 ? `en ${txt}` : `hace ${txt}`;
  }
  function isOverdue(v) {
    if (!v) return false;
    const d = new Date(v);
    return !isNaN(d) && d.getTime() < Date.now() - 60000;
  }

  /* ---------------- Colores por materia ---------------- */
  const PALETTE = ['#8b5cf6', '#22d3ee', '#f59e0b', '#f43f5e', '#10b981', '#d946ef', '#3b82f6', '#eab308'];
  function colorFor(name, subjects) {
    const s = (subjects || []).find(x => (x.nombre || '').toLowerCase() === (name || '').toLowerCase());
    if (s) return s.color;
    if (!name) return 'var(--text-3)';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /* ---------------- Escape helpers ---------------- */
  function escapeHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHTML(s).replace(/`/g, '&#96;'); }

  /* ---------------- Wikilink click delegation ---------------- */
  function initWikilinks() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a.wlink');
      if (!a) return;
      e.preventDefault();
      const target = a.dataset.wikilink;
      openWikilink(target);
    });
  }

  async function openWikilink(target) {
    // Busca nota por título; si no, abre notas filtradas
    try {
      const notes = await Store.getNotes();
      const note = notes.find(n => (n.titulo || '').toLowerCase() === target.toLowerCase());
      if (note) {
        App.openEditor(note._id);
        return;
      }
    } catch (e) { /* fallthrough */ }
    App.showView('notes');
    const search = document.getElementById('notesSearch');
    if (search) {
      search.value = target;
      search.dispatchEvent(new Event('input'));
    }
  }

  return {
    toast, openModal, closeModal, initModals, initRipple,
    mdToHTML, stripMarkdown,
    DIAS, MESES, fmtTime, fmtDate, fmtDateTime, dayKey, relTime, isOverdue,
    colorFor, PALETTE, escapeHTML, escapeAttr, initWikilinks, openWikilink
  };
})();
