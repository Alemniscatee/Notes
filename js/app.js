/* ============================================================
   AURA — app.js
   Orquestador: router de vistas, dashboard, tareas, notas,
   materias (CRUD completo), horario de clases, ajustes,
   sincronización, install y SW registration.
   Depende de: Settings, DB, Store, Gemini, UI, Cal, Editor,
   Capture, Vault, Notify.
   ============================================================ */

const App = (() => {
  let subjectsCache = [];
  let tasksCache = [];
  let notesCache = [];
  let tasksFilter = 'pending';
  let tasksMateria = '';
  let editingMateriaId = null;   // id de materia en edición (modal Materias)
  let deferredPrompt = null;
  let currentView = 'dashboard';
  let navHistory = [];            // historial para botones "volver"

  const $ = id => document.getElementById(id);

  /* ================= Router ================= */
  const VALID = ['dashboard', 'calendar', 'tasks', 'notes', 'timetable', 'editor', 'vault', 'settings'];

  function showView(name, opts = {}) {
    if (!VALID.includes(name)) return;

    // Historial: guarda la vista anterior salvo que sea reemplazo o vuelta atrás
    if (name !== currentView) {
      if (opts.replace) navHistory = [];
      else if (!opts.back) navHistory.push(currentView);
      if (navHistory.length > 30) navHistory.shift();
    }

    currentView = name;
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('active', n.dataset.view === name));
    document.querySelectorAll('.side-item').forEach(n =>
      n.classList.toggle('active', n.dataset.view === name));

    // Lazy renders
    if (name === 'dashboard') renderDashboard();
    if (name === 'calendar') Cal.render();
    if (name === 'tasks') renderTasks();
    if (name === 'notes') renderNotes();
    if (name === 'timetable') Timetable.render();

    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function goBack() {
    const prev = navHistory.pop();
    showView(prev || 'dashboard', { back: true, replace: !prev });
  }

  /* ================= Sidebar ================= */
  /* Drawer móvil + toggle hamburguesa unificado (móvil y desktop):
     - Móvil / <1100px: drawer con scrim (clase .open).
     - Desktop ≥1100px: alterna expanded <-> rail (modo persistente).
     - Modo 'hidden': el hover en la franja izquierda la desliza (peek). */
  function openSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarScrim').classList.add('show');
    $('menuBtn')?.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarScrim').classList.remove('show');
    $('menuBtn')?.setAttribute('aria-expanded', 'false');
  }
  function toggleSidebar() {
    // En desktop la sidebar es persistente: el toggle contrae/expande el modo.
    if (window.matchMedia('(min-width: 1100px)').matches) {
      const mode = Settings.cycleSidebarMode();
      UI.toast(
        mode === 'expanded' ? 'Panel expandido' :
        mode === 'rail' ? 'Panel compacto (solo iconos)' : 'Panel oculto',
        'info', 1800);
      return;
    }
    const isOpen = $('sidebar').classList.contains('open');
    isOpen ? closeSidebar() : openSidebar();
  }

  /* Ciclo de modos en desktop: expandida -> riel -> oculta (persistente) */
  function bindSidebarModes() {
    const collapseBtn = $('sidebarCollapseBtn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const mode = Settings.cycleSidebarMode();
        UI.toast(
          mode === 'expanded' ? 'Panel expandido' :
          mode === 'rail' ? 'Panel compacto (solo iconos)' : 'Panel oculto',
          'info', 1800);
      });
    }
    // En modo oculto, el hover en la franja izquierda la desliza temporalmente
    const edge = document.createElement('div');
    edge.className = 'sidebar-edge';
    document.body.appendChild(edge);
    edge.addEventListener('mouseenter', () => {
      if (document.documentElement.classList.contains('side-hidden')) {
        $('sidebar').classList.add('peek');
      }
    });
    edge.addEventListener('mouseleave', () => $('sidebar').classList.remove('peek'));
    $('sidebar').addEventListener('mouseleave', () => $('sidebar').classList.remove('peek'));
  }

  /* Brillo especular que sigue el cursor sobre tarjetas glass */
  function initPointerGlow() {
    if (window.matchMedia('(hover: none)').matches) return;
    let raf = null;
    document.addEventListener('pointermove', e => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const card = e.target.closest('.card, .quick-btn, .side-item');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width * 100) + '%');
        card.style.setProperty('--my', ((e.clientY - rect.top) / rect.height * 100) + '%');
      });
    }, { passive: true });
  }

  /* ================= Bootstrap ================= */
  async function init() {
    Settings.load();
    Settings.applyTheme();
    Settings.applySidebarMode();
    UI.initModals();
    UI.initRipple();
    UI.initWikilinks();
    initPointerGlow();

    await DB.init();
    bindNav();
    bindHeader();
    bindSidebarModes();
    bindDashboard();
    bindTasks();
    bindNotes();
    bindMaterias();
    bindSettings();
    Cal.init();
    Editor.init();
    Capture.init();
    Timetable.init();
    Vault.init();
    Timeline.init();
    Notify.start();
    Notify.onNotificationClickFocus();

    Store.setChangeHook(() => refreshAll());
    DB.onStatus(updateSyncUI);

    // Sync inicial automática si hay credencial guardada (localStorage)
    const s = Settings.get();
    if (s.couchURL) DB.startSync(s.couchURL);
    else updateSyncUI(navigator.onLine ? 'ok' : 'offline');

    // Mantener la sync viva en segundo plano (PC y celular):
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resumeCloudSync();
    });
    window.addEventListener('online', resumeCloudSync);

    await refreshAll();
    fillSettingsForm();

    // Deeplinks PWA (shortcuts): ?action=capture|vault
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'capture') Capture.open();
    if (params.get('action') === 'vault') showView('vault');

    registerSW();
    registerInstall();
    updateClock();
    setInterval(updateClock, 15000);
  }  /* ================= Nav & header ================= */
  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(btn =>
      btn.addEventListener('click', () => showView(btn.dataset.view)));
    document.querySelectorAll('.side-item').forEach(btn =>
      btn.addEventListener('click', () => showView(btn.dataset.view)));
    document.querySelectorAll('[data-goto]').forEach(el =>
      el.addEventListener('click', () => showView(el.dataset.goto)));
    document.querySelectorAll('[data-back]').forEach(el =>
      el.addEventListener('click', goBack));
    document.querySelectorAll('[data-action]').forEach(el =>
      el.addEventListener('click', () => {
        if (el.dataset.action === 'capture') Capture.open();
        if (el.dataset.action === 'quick-voice') Capture.openVoice();
        if (el.dataset.action === 'vault') showView('vault');
        if (el.dataset.action === 'materias') openMaterias();
      }));

    // Hamburguesa: toggle real del menú lateral (drawer móvil / modos desktop)
    $('menuBtn').addEventListener('click', toggleSidebar);
    $('sidebarScrim').addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSidebar();
    });
  }

  function bindHeader() {
    $('themeToggle').addEventListener('click', () => {
      const next = Settings.get().theme === 'dark' ? 'light' : 'dark';
      Settings.patch({ theme: next });
      Settings.applyTheme();
    });
    $('settingsBtn').addEventListener('click', () => showView('settings'));
    // El chip de nube del header abre Ajustes → Sincronización en la nube
    const cloudChip = $('cloudChip');
    if (cloudChip) cloudChip.addEventListener('click', () => showView('settings'));
  }

  function bindDashboard() {
    $('newTaskBtn') && null;
  }

  /* ================= Dashboard ================= */
  function updateClock() {
    const el = $('clockTime');
    if (el) el.textContent = UI.fmtTime(new Date());
  }

  async function renderDashboard() {
    const s = Settings.get();
    $('dashName').textContent = s.userName || 'Estudiante';
    const h = new Date().getHours();
    $('dashGreeting').textContent =
      h < 12 ? 'Buenos días — esto es lo tuyo para hoy.' :
      h < 19 ? 'Buenas tardes — esto es lo tuyo para hoy.' :
               'Buenas noches — esto es lo tuyo para hoy.';

    const tasks = tasksCache;
    const todayKey = UI.dayKey(new Date());
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);

    const pending = tasks.filter(t => !t.hecho);
    $('statTasks').textContent = pending.length;
    $('statToday').textContent = pending.filter(t =>
      t.vence && UI.dayKey(new Date(t.vence)) === todayKey).length;

    // "Esta semana" = clases fijas del horario que caen hoy + tareas a 7 días
    const classes = await Store.getClasses();
    const dowNow = new Date().getDay();
    const todayClasses = classes.filter(c => (c.dias || []).includes(dowNow)).length;
    $('statWeek').textContent = todayClasses + pending.filter(t => {
      if (!t.vence) return false;
      const d = new Date(t.vence);
      return d >= new Date() && d <= weekEnd;
    }).length;

    $('statNotes').textContent = notesCache.length;

    // Agenda de hoy (tareas + notas de hoy)
    const todayItems = pending
      .filter(t => t.vence && UI.dayKey(new Date(t.vence)) === todayKey)
      .sort((a, b) => (a.vence || '').localeCompare(b.vence || ''))
      .map(t => {
        const c = UI.colorFor(t.materia, subjectsCache);
        const ov = UI.isOverdue(t.vence);
        return `
          <div class="timeline-item ${ov ? 'overdue' : ''}">
            <span class="tl-time">${UI.fmtTime(new Date(t.vence))}</span>
            <span class="tl-title">${UI.escapeHTML(t.titulo)}</span>
            <span class="materia-tag" style="background:${c}22;color:${c};">${UI.escapeHTML(t.materia || 'General')}</span>
          </div>`;
      });

    $('todayList').innerHTML = todayItems.length
      ? todayItems.join('')
      : `<div class="empty empty--sm" style="width:100%;">
           <span class="material-symbols-outlined">event_available</span>
           <p>Nada para hoy. Disfruta o adelanta trabajo 💪</p>
         </div>`;
  }

  /* ================= Tareas ================= */
  function bindTasks() {
    $('newTaskBtn').addEventListener('click', () => Capture.open());
    $('tasksFilterPending').addEventListener('click', () => setTaskFilter('pending'));
    $('tasksFilterAll').addEventListener('click', () => setTaskFilter('all'));
    $('tasksFilterMateria').addEventListener('change', e => {
      tasksMateria = e.target.value;
      renderTasks();
    });
  }

  function setTaskFilter(f) {
    tasksFilter = f;
    $('tasksFilterPending').classList.toggle('active', f === 'pending');
    $('tasksFilterAll').classList.toggle('active', f === 'all');
    renderTasks();
  }

  async function renderTasks() {
    // Select de materias
    const sel = $('tasksFilterMateria');
    const selVal = tasksMateria;
    sel.innerHTML = '<option value="">Todas las materias</option>' +
      subjectsCache.map(s => `<option value="${UI.escapeAttr(s.nombre)}" ${s.nombre === selVal ? 'selected' : ''}>${UI.escapeHTML(s.nombre)}</option>`).join('');

    let list = [...tasksCache];
    if (tasksFilter === 'pending') list = list.filter(t => !t.hecho);
    if (tasksMateria) list = list.filter(t => t.materia === tasksMateria);

    const pendingCount = tasksCache.filter(t => !t.hecho).length;
    // Badges duales: nav inferior (móvil) + sidebar
    const badge = $('tasksBadge');
    badge.hidden = pendingCount === 0;
    badge.textContent = pendingCount;
    const badgeSide = $('tasksBadgeSide');
    badgeSide.hidden = pendingCount === 0;
    badgeSide.textContent = pendingCount;

    const wrap = $('tasksList');
    if (!list.length) {
      wrap.innerHTML = `
        <div class="empty">
          <span class="material-symbols-outlined">task_alt</span>
          <p>${tasksFilter === 'pending' ? '¡Todo al día! No hay tareas pendientes.' : 'No hay tareas todavía. Usa ＋ Nueva tarea o el botón Ingresar.'}</p>
        </div>`;
      return;
    }

    wrap.innerHTML = list.map(t => {
      const c = UI.colorFor(t.materia, subjectsCache);
      const ov = UI.isOverdue(t.vence) && !t.hecho;
      return `
        <div class="task-row card card--hover ${t.hecho ? 'done' : ''}">
          <button class="task-check" data-toggle="${t._id}" aria-label="Completar">
            <span class="material-symbols-outlined">check</span>
          </button>
          <div class="task-body">
            <span class="task-title">${UI.escapeHTML(t.titulo)}</span>
            <div class="task-meta">
              <span class="materia-tag" style="background:${c}22;color:${c};">${UI.escapeHTML(t.materia || 'General')}</span>
              ${t.vence ? `<span class="${ov ? 'task-overdue' : ''}"><span class="material-symbols-outlined">schedule</span> ${UI.fmtDateTime(t.vence)}${ov ? ' · vencida' : ''}</span>` : '<span>Sin fecha</span>'}
              ${t.contenido ? `<span title="${UI.escapeAttr(t.contenido)}">${UI.escapeHTML(UI.stripMarkdown(t.contenido).slice(0, 60))}${t.contenido.length > 60 ? '…' : ''}</span>` : ''}
            </div>
          </div>
          <div class="task-actions">
            <button class="icon-btn" data-edit="${t._id}" aria-label="Editar"><span class="material-symbols-outlined">edit</span></button>
            <button class="icon-btn" data-del="${t._id}" aria-label="Eliminar"><span class="material-symbols-outlined">delete</span></button>
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('[data-toggle]').forEach(b =>
      b.addEventListener('click', () => toggleTask(b.dataset.toggle)));
    wrap.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => deleteTask(b.dataset.del)));
    wrap.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => editTask(b.dataset.edit)));
  }

  function editTask(id) {
    const t = tasksCache.find(x => x._id === id);
    if (!t) return;
    Capture.open();
    // Pre-carga en modo manual tipo tarea
    setTimeout(() => {
      $('capTitulo').value = t.titulo || '';
      $('capMateria').value = t.materia || '';
      if (t.vence) {
        const d = new Date(t.vence);
        const p = n => String(n).padStart(2, '0');
        $('capFecha').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      }
    }, 150);
  }

  async function toggleTask(id) {
    await Store.toggleTask(id);
    await refreshAll();
  }

  async function deleteTask(id) {
    if (!confirm('¿Eliminar este elemento?')) return;
    await Store.deleteDoc(id);
    UI.toast('Eliminado', 'ok');
    await refreshAll();
  }

  /* ================= Notas ================= */
  function bindNotes() {
    $('newNoteBtn').addEventListener('click', () => Editor.open());
    $('notesSearch').addEventListener('input', renderNotes);
    $('notesFilterMateria').addEventListener('change', renderNotes);
  }

  async function renderNotes() {
    const q = ($('notesSearch').value || '').toLowerCase();
    const mat = $('notesFilterMateria').value || '';

    // Select de materias de NOTAS: opción fija VIDA_COTIDIANA + materias dinámicas
    const selN = $('notesFilterMateria');
    selN.innerHTML = '<option value="">Todas las materias</option>' +
      '<option value="VIDA_COTIDIANA">🏠 Vida Cotidiana (Sin materia)</option>' +
      subjectsCache.map(s => `<option value="${UI.escapeAttr(s.nombre)}" ${s.nombre === mat ? 'selected' : ''}>${UI.escapeHTML(s.nombre)}</option>`).join('');

    let list = notesCache;
    if (mat) list = list.filter(n => n.materia === mat);
    if (q) list = list.filter(n =>
      (n.titulo || '').toLowerCase().includes(q) ||
      (n.contenido || '').toLowerCase().includes(q));

    const grid = $('notesGrid');
    if (!list.length) {
      grid.innerHTML = `
        <div class="empty" style="grid-column: 1 / -1;">
          <span class="material-symbols-outlined">stylus_note</span>
          <p>${q ? 'Sin resultados para tu búsqueda.' : mat === 'VIDA_COTIDIANA' ? 'Aún no hay notas de vida cotidiana. Créalas desde ＋ Nueva nota eligiendo 🏠 Vida Cotidiana.' : 'Tu bóveda está vacía. Crea tu primera nota.'}</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map(n => {
      const isDaily = n.materia === 'VIDA_COTIDIANA';
      const c = isDaily ? 'var(--cyan)' : UI.colorFor(n.materia, subjectsCache);
      const tagLabel = isDaily ? '🏠 Vida Cotidiana' : UI.escapeHTML(n.materia || 'General');
      const firstAtt = Object.keys(n._attachments || {})[0];
      return `
        <div class="card card--hover note-card" data-note="${n._id}">
          ${firstAtt ? `<img class="note-thumb" data-att="${n._id}" data-name="${UI.escapeAttr(firstAtt)}" alt="">` : ''}
          <button class="note-del" data-del-note="${n._id}" aria-label="Eliminar nota: ${UI.escapeAttr(n.titulo || 'Sin título')}" title="Eliminar nota">
            <span class="material-symbols-outlined">delete</span>
          </button>
          <h4>${UI.escapeHTML(n.titulo || 'Sin título')}</h4>
          <p class="note-preview">${UI.escapeHTML(UI.stripMarkdown(n.contenido).slice(0, 160))}</p>
          <div class="note-foot">
            <span class="note-tag" style="background:${isDaily ? 'rgba(34,211,238,0.12)' : c + '22'};color:${c};${isDaily ? 'border:1px solid rgba(34,211,238,0.3);' : ''}">${tagLabel}</span>
            <span>${n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('es-ES') : ''}</span>
          </div>
        </div>`;
    }).join('');

    // Cargar thumbnails (blob URLs)
    grid.querySelectorAll('[data-att]').forEach(async img => {
      const url = await Store.getAttachment(img.dataset.att, img.dataset.name);
      if (url) img.src = url;
    });

    // Abrir nota (el clic en el botón eliminar no debe propagarse)
    grid.querySelectorAll('[data-note]').forEach(card =>
      card.addEventListener('click', e => {
        if (e.target.closest('.note-del')) return;
        Editor.open(card.dataset.note);
      }));
    grid.querySelectorAll('[data-del-note]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteNote(btn.dataset.delNote);
      }));
  }

  /* Borrado permanente en PouchDB (db.remove) + refresh de la vista sin recargar */
  async function deleteNote(id) {
    const n = notesCache.find(x => x._id === id);
    const label = n && n.titulo ? `"${n.titulo}"` : 'esta nota';
    if (!confirm(`¿Eliminar ${label} permanentemente? Esta acción no se puede deshacer.`)) return;
    try {
      const doc = await DB.get().get(id);
      await DB.get().remove(doc);          // borrado permanente en PouchDB
      UI.toast('Nota eliminada ✓', 'ok');
      await refreshAll();                  // re-renderiza la vista al instante
    } catch (e) {
      UI.toast('No se pudo eliminar: ' + e.message, 'err');
    }
  }

  /* ================= Materias (CRUD completo) ================= */
  function bindMaterias() {
    $('materiasListBtn').addEventListener('click', openMaterias);
    $('materiaAddBtn').addEventListener('click', addMateria);
    $('materiaCancelEditBtn').addEventListener('click', resetMateriaForm);
    $('materiaNombre').addEventListener('keydown', e => {
      if (e.key === 'Enter') addMateria();
    });
  }

  function resetMateriaForm() {
    editingMateriaId = null;
    $('materiaFormTitle').textContent = '➕ Nueva materia';
    $('materiaAddBtn').textContent = 'Añadir materia';
    $('materiaCancelEditBtn').hidden = true;
    $('materiaNombre').value = '';
    $('materiaCodigo').value = '';
    $('materiaProfesor').value = '';
    $('materiaColor').value = '#8b5cf6';
  }

  function openMaterias() {
    UI.openModal('materiaModal');
    renderMaterias();
  }

  async function renderMaterias() {
    const list = $('materiasList');
    if (!subjectsCache.length) {
      list.innerHTML = '<div class="muted small">Aún no hay materias. Añádelas arriba con nombre, código, profesor y color.</div>';
      return;
    }
    list.innerHTML = subjectsCache.map(s => {
      const count = tasksCache.filter(t => t.materia === s.nombre && !t.hecho).length;
      return `
        <div class="materia-row">
          <span class="materia-dot" style="background:${s.color};color:${s.color};"></span>
          <div class="materia-info">
            <b>${UI.escapeHTML(s.nombre)}</b>
            <span class="muted">${s.codigo ? `· ${UI.escapeHTML(s.codigo)} ` : ''}${s.profesor ? `· ${UI.escapeHTML(s.profesor)} ` : ''}</span>
          </div>
          <span class="muted">${count} pendiente${count === 1 ? '' : 's'}</span>
          <button class="icon-btn" data-editmat="${s._id}" style="width:32px;height:32px;" aria-label="Editar materia">
            <span class="material-symbols-outlined" style="font-size:15px;">edit</span>
          </button>
          <button class="icon-btn" data-delmat="${s._id}" style="width:32px;height:32px;" aria-label="Eliminar materia">
            <span class="material-symbols-outlined" style="font-size:15px;">delete</span>
          </button>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-delmat]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar materia? Las tareas y notas no se borran.')) return;
        const sub = subjectsCache.find(s => s._id === b.dataset.delmat);
        await Store.deleteSubject(b.dataset.delmat, sub._rev);
        if (editingMateriaId === b.dataset.delmat) resetMateriaForm();
        await refreshAll();
        renderMaterias();
      }));

    list.querySelectorAll('[data-editmat]').forEach(b =>
      b.addEventListener('click', () => editMateria(b.dataset.editmat)));
  }

  function editMateria(id) {
    const s = subjectsCache.find(x => x._id === id);
    if (!s) return;
    editingMateriaId = id;
    $('materiaFormTitle').textContent = '✏️ Editando: ' + s.nombre;
    $('materiaAddBtn').textContent = 'Guardar cambios';
    $('materiaCancelEditBtn').hidden = false;
    $('materiaNombre').value = s.nombre || '';
    $('materiaCodigo').value = s.codigo || '';
    $('materiaProfesor').value = s.profesor || '';
    $('materiaColor').value = s.color || '#8b5cf6';
    $('materiaNombre').focus();
  }

  async function addMateria() {
    const name = $('materiaNombre').value.trim();
    if (!name) { UI.toast('Escribe el nombre de la materia', 'err'); return; }

    await Store.saveSubject(name, $('materiaColor').value, {
      codigo: $('materiaCodigo').value.trim(),
      profesor: $('materiaProfesor').value.trim()
    }, editingMateriaId);

    UI.toast(editingMateriaId ? 'Materia actualizada ✓' : 'Materia añadida ✓', 'ok');
    resetMateriaForm();
    await refreshAll();
    renderMaterias();
  }

  async function ensureSubject(nombre, extras) {
    if (!nombre || nombre === 'General' || nombre === 'VIDA_COTIDIANA') return;
    const exists = subjectsCache.some(s =>
      (s.nombre || '').toLowerCase() === nombre.toLowerCase());
    if (!exists) await Store.saveSubject(nombre, null, extras);
  }

  /* ================= Ajustes ================= */
  function bindSettings() {
    $('saveSettingsBtn').addEventListener('click', saveSettings);
    $('testGeminiBtn').addEventListener('click', testGemini);
    $('testSyncBtn').addEventListener('click', testSync);
    $('startSyncBtn').addEventListener('click', startSyncNow);
    $('stopSyncBtn').addEventListener('click', () => {
      DB.stopSync();
      UI.toast('Sincronización detenida', 'info');
      updateSyncUI('offline');
    });
    $('setNotifications').addEventListener('change', async e => {
      if (e.target.checked) {
        const ok = await Notify.requestPermission();
        if (!ok) { e.target.checked = false; return; }
        Settings.patch({ notifications: true });
        UI.toast('Notificaciones activadas ✓', 'ok');
        Notify.checkTasks();
      } else {
        Settings.patch({ notifications: false });
      }
    });
    $('exportBtn').addEventListener('click', exportJSON);
    $('wipeBtn').addEventListener('click', wipeDB);
  }

  function fillSettingsForm() {
    const s = Settings.get();
    $('setGeminiKey').value = s.geminiKey || '';
    $('setGeminiModel').value = s.geminiModel || 'gemini-3.5-flash';
    $('setCouchURL').value = s.couchURL || '';
    $('setUserName').value = s.userName || 'Estudiante';
    $('setNotifications').checked = !!s.notifications;
  }

  function saveSettings() {
    Settings.patch({
      geminiKey: $('setGeminiKey').value.trim(),
      geminiModel: $('setGeminiModel').value,
      couchURL: $('setCouchURL').value.trim(),
      userName: $('setUserName').value.trim() || 'Estudiante'
    });
    const url = $('setCouchURL').value.trim();
    if (url) DB.startSync(url);
    UI.toast('Ajustes guardados ✓', 'ok');
    renderDashboard();
  }

  async function testGemini() {
    const out = $('geminiTestResult');
    out.textContent = 'Probando…';
    Settings.patch({
      geminiKey: $('setGeminiKey').value.trim(),
      geminiModel: $('setGeminiModel').value
    });
    try {
      const r = await Gemini.testKey();
      out.innerHTML = `<span style="color:var(--ok);">✓ Conexión OK — el modelo respondió: "${UI.escapeHTML(r)}"</span>`;
    } catch (e) {
      out.innerHTML = `<span style="color:var(--alert);">✕ ${UI.escapeHTML(e.message)}</span>`;
    }
  }

  async function testSync() {
    const out = $('syncTestResult');
    out.textContent = 'Probando…';
    const url = $('setCouchURL').value.trim();
    Settings.patch({ couchURL: url });
    try {
      const info = await DB.testConnection(url);
      out.innerHTML = `<span style="color:var(--ok);">✓ Conectado a "${UI.escapeHTML(info.db_name || 'remoto')}"</span>`;
    } catch (e) {
      out.innerHTML = `<span style="color:var(--alert);">✕ No se pudo conectar (${UI.escapeHTML(e.message)}). Revisa URL, credenciales y CORS.</span>`;
    }
  }

  function startSyncNow() {
    const url = $('setCouchURL').value.trim();
    if (!url) { UI.toast('Ingresa la URL remota primero', 'err'); return; }
    Settings.patch({ couchURL: url });
    const ok = DB.startSync(url);
    UI.toast(ok ? 'Sincronización en vivo iniciada' : 'No se pudo iniciar sync', ok ? 'ok' : 'err');
  }

  /* Indicador de sincronización en la nube (chip del header):
     🟢 Sincronizado en la nube · 🟡 Guardado local · 🔴 Error de conexión */
  function updateSyncUI(status, detail) {
    const chip = $('cloudChip');
    const label = $('cloudChipText');
    if (!chip || !label) return;
    chip.classList.remove('cloud-chip--cloud', 'cloud-chip--local', 'cloud-chip--error', 'cloud-chip--syncing');
    const hasRemote = !!DB.remoteURL;

    if (status === 'syncing') {
      chip.classList.add('cloud-chip--syncing');
      label.textContent = 'Sincronizando…';
    } else if (status === 'error' || status === 'denied') {
      chip.classList.add('cloud-chip--error');
      label.textContent = 'Error de conexión';
    } else if (status === 'offline') {
      chip.classList.add(hasRemote ? 'cloud-chip--error' : 'cloud-chip--local');
      label.textContent = hasRemote ? 'Sin conexión' : 'Guardado local';
    } else if (status === 'ok') {
      if (hasRemote) {
        chip.classList.add('cloud-chip--cloud');
        label.textContent = 'Sincronizado en la nube';
      } else {
        chip.classList.add('cloud-chip--local');
        label.textContent = 'Guardado local';
      }
    }
    chip.title = hasRemote
      ? 'Sync automática activa con: ' + DB.remoteURL
      : 'Sin nube configurada — toca para configurar';
  }

  /* Reanuda la sync en segundo plano: al volver a la app (PC/celular)
     o al recuperar conexión. No duplica handlers si ya está activa. */
  function resumeCloudSync() {
    const url = Settings.get().couchURL;
    if (url && !DB.isSyncing) DB.startSync(url);
  }

  /* ================= Export / wipe ================= */
  async function exportJSON() {
    try {
      const docs = await DB.get().allDocs({ include_docs: true });
      const withAtts = await Promise.all(docs.rows.map(async row => {
        const doc = row.doc;
        if (doc._attachments) {
          for (const [name, att] of Object.entries(doc._attachments)) {
            try {
              const blob = await DB.get().getAttachment(doc._id, name);
              att.b64 = await Store.blobToDataURL(blob);
            } catch (e) { /* noop */ }
          }
        }
        return doc;
      }));
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), docs: withAtts }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aura-backup-${UI.dayKey(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      UI.toast('Backup exportado ✓', 'ok');
    } catch (e) {
      UI.toast('Error exportando: ' + e.message, 'err');
    }
  }

  async function wipeDB() {
    if (!confirm('¿Borrar TODOS los datos locales? Esta acción no se puede deshacer (el remoto no se toca).')) return;
    if (!confirm('¿Seguro seguro? Considera exportar un backup antes.')) return;
    await DB.get().destroy();
    location.reload();
  }

  /* ================= Refresh global ================= */
  async function refreshAll() {
    const [subjects, tasks, notes] = await Promise.all([
      Store.getSubjects(), Store.getTasks(), Store.getNotes()
    ]);
    subjectsCache = subjects;
    tasksCache = tasks;
    notesCache = notes;
    renderDashboard();
    if (currentView === 'tasks') renderTasks();
    if (currentView === 'notes') renderNotes();
    if (currentView === 'calendar') Cal.render();
    if (currentView === 'timetable') Timetable.render();
  }

  /* ================= PWA: SW + install ================= */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err =>
        console.warn('SW registration failed:', err));
    });
  }

  function registerInstall() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      $('installBtn').hidden = false;
    });
    $('installBtn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') $('installBtn').hidden = true;
      deferredPrompt = null;
    });
    // Ocultar el botón si ya está instalada
    if (window.matchMedia('(display-mode: standalone)').matches) $('installBtn').hidden = true;
  }

  /* ================= API pública ================= */
  return {
    init, showView, refreshAll,
    toggleTask, deleteTask,
    ensureSubject,
    openMaterias,
    openEditor: id => Editor.open(id),
    openCapture: opts => {
      Capture.open();
      if (opts && opts.tipo === 'tarea' && opts.fecha) {
        setTimeout(() => { $('capFecha').value = opts.fecha; }, 200);
      }
    },
    get subjectsCache() { return subjectsCache; },
    get tasksCache() { return tasksCache; },
    get notesCache() { return notesCache; }
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
