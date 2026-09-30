/* ============================================================
   AURA — calendar.js
   Calendario mensual (matriz 7×5/6, número arriba-izquierda,
   HOY = círculo sólido del acento SOLO en el número) + vista
   semanal (rejilla hora × 7 días con clases del horario) +
   agenda del día seleccionado.
   Depende de: Store, UI, App (openCapture, toggleTask...).
   ============================================================ */

const Cal = (() => {
  const state = {
    mode: 'month',            // 'month' | 'week'
    cursor: new Date(),       // mes/semana visible
    selected: UI.dayKey(new Date())
  };

  const grid = () => document.getElementById('calGrid');
  const dow = () => document.getElementById('calDow');
  const title = () => document.getElementById('calTitle');
  const weekView = () => document.getElementById('calWeekView');

  const DAY_ABBR = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  const toMin = hm => {
    const [h, m] = String(hm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const p2 = n => String(n).padStart(2, '0');

  function init() {
    document.getElementById('calPrev').addEventListener('click', () => { shift(-1); });
    document.getElementById('calNext').addEventListener('click', () => { shift(1); });
    document.getElementById('calTodayBtn').addEventListener('click', () => {
      state.cursor = new Date();
      state.selected = UI.dayKey(new Date());
      render();
    });
    document.getElementById('calModeMonth').addEventListener('click', () => setMode('month'));
    document.getElementById('calModeWeek').addEventListener('click', () => setMode('week'));
    document.getElementById('selAdd').addEventListener('click', () => {
      App.openCapture({ tipo: 'tarea', fecha: state.selected });
    });
    render();
  }

  function setMode(m) {
    state.mode = m;
    document.getElementById('calModeMonth').classList.toggle('active', m === 'month');
    document.getElementById('calModeWeek').classList.toggle('active', m === 'week');
    render();
  }

  function shift(dir) {
    if (state.mode === 'month') {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + dir, 1);
    } else {
      const d = new Date(state.cursor);
      d.setDate(d.getDate() + dir * 7);
      state.cursor = d;
    }
    render();
  }

  /* ------------ Encabezado L M X J V S D (SIEMPRE visible) ------------ */
  function renderDow() {
    dow().innerHTML = DAY_ABBR
      .map(d => `<div class="cal-dow">${d}</div>`).join('');
  }

  /* ------------ Render month grid ------------ */
  async function render() {
    const tasks = await Store.getTasks().catch(() => []);
    let classes = [];
    try { classes = await Store.getClasses(); } catch (e) { classes = []; }
    renderDow();
    renderDow();
    if (state.mode === 'month') {
      weekView().hidden = true;
      grid().hidden = false;
      renderMonth(tasks, classes);
    } else {
      grid().hidden = true;
      weekView().hidden = false;
      renderWeek(tasks, classes);
    }
    renderSelected(tasks);
    title().textContent = state.mode === 'month'
      ? `${UI.MESES[state.cursor.getMonth()]} ${state.cursor.getFullYear()}`
      : `Semana del ${state.cursor.getDate()} ${UI.MESES[state.cursor.getMonth()].toLowerCase()}`;
  }

  function renderMonth(tasks, classes) {
    const y = state.cursor.getFullYear();
    const m = state.cursor.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = (first.getDay() + 6) % 7; // lunes=0
    const gridStart = new Date(y, m, 1 - startOffset);
    const todayKey = UI.dayKey(new Date());

    // Tareas pendientes por día
    const tasksByDay = {};
    for (const t of tasks) {
      if (!t.vence || t.hecho) continue;
      const k = UI.dayKey(new Date(t.vence));
      (tasksByDay[k] = tasksByDay[k] || []).push(t);
    }
    // Clases del horario por día de semana (getDay: 0=Domingo)
    const classesByDow = {};
    for (const c of classes) {
      for (const d of (c.dias || [])) {
        (classesByDow[d] = classesByDow[d] || []).push(c);
      }
    }

    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const key = UI.dayKey(d);
      const other = d.getMonth() !== m;
      const isToday = key === todayKey;
      const isSel = key === state.selected;

      const dayTasks = (tasksByDay[key] || []).slice(0, 3);
      const more = (tasksByDay[key] || []).length - dayTasks.length;
      const dayClasses = (classesByDow[d.getDay()] || [])
        .slice()
        .sort((a, b) => toMin(a.inicio) - toMin(b.inicio))
        .slice(0, 2);

      const evHTML =
        dayTasks.map(t => {
          const c = UI.colorFor(t.materia, App.subjectsCache);
          return `<span class="cal-ev" style="--ev-color:${c};">${UI.escapeHTML(t.titulo)}</span>`;
        }).join('') +
        dayClasses.map(c => {
          const col = UI.colorFor(c.materia, App.subjectsCache);
          return `<span class="cal-ev" style="--ev-color:${col};opacity:0.75;">${p2(Math.floor(toMin(c.inicio) / 60))}:${p2(toMin(c.inicio) % 60)} ${UI.escapeHTML((c.materia || 'Clase').slice(0, 14))}</span>`;
        }).join('');

      html += `
        <div class="cal-cell ${other ? 'other' : ''} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-date="${key}">
          <span class="daynum">${d.getDate()}</span>
          ${evHTML}
          ${more > 0 ? `<span class="cal-more">+${more} más</span>` : ''}
        </div>`;
    }
    grid().innerHTML = html;

    grid().querySelectorAll('.cal-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        state.selected = cell.dataset.date;
        render();
      });
    });
  }

  function startOfWeek(d) {
    const copy = new Date(d);
    const off = (copy.getDay() + 6) % 7; // lunes=0
    copy.setDate(copy.getDate() - off);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  /* ------------ Vista semanal: rejilla hora × 7 días ------------ */
  function renderWeek(tasks, classes) {
    const start = startOfWeek(state.cursor);
    const todayKey = UI.dayKey(new Date());
    const START_H = 7, END_H = 23;

    // Clases por día de semana + tareas por día
    const classesByDow = {};
    for (const c of classes) {
      for (const d of (c.dias || [])) {
        (classesByDow[d] = classesByDow[d] || []).push(c);
      }
    }
    const tasksByDay = {};
    for (const t of tasks) {
      if (!t.vence) continue;
      const k = UI.dayKey(new Date(t.vence));
      (tasksByDay[k] = tasksByDay[k] || []).push(t);
    }
    const sortCls = arr => (arr || []).slice().sort((a, b) => toMin(a.inicio) - toMin(b.inicio));

    // Fila de encabezados: esquina + 7 días (fila 1 explícita)
    let html = `<div class="wk-head wk-corner" style="grid-row:1;grid-column:1;"></div>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = UI.dayKey(d);
      html += `
        <div class="wk-head ${key === todayKey ? 'today' : ''}" style="grid-row:1;grid-column:${i + 2};" data-date="${key}">
          <span class="wd-name">${DAY_ABBR[i]}</span>
          <span class="wd-num">${d.getDate()}</span>
        </div>`;
    }

    // Filas de horas 07:00 → 22:00 (filas explícitas 2..17)
    for (let h = START_H; h < END_H; h++) {
      const row = h - START_H + 2;
      html += `<div class="wk-time" style="grid-row:${row};grid-column:1;">${p2(h)}:00</div>`;
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = UI.dayKey(d);
        const dowNum = d.getDay();
        const isToday = key === todayKey;

        const cls = sortCls(classesByDow[dowNum]).find(c => {
          const s = toMin(c.inicio);
          const e = Math.max(toMin(c.fin), s + 30);
          return h * 60 >= Math.floor(s / 60) * 60 && h * 60 < Math.ceil(e / 60) * 60;
        });

        let inner = '';
        if (cls) {
          const col = UI.colorFor(cls.materia, App.subjectsCache);
          inner = `<div class="wk-cls" style="--ev-color:${col};">
            <b>${UI.escapeHTML(cls.materia || 'Clase')}</b>
            <span>${p2(Math.floor(toMin(cls.inicio) / 60))}:${p2(toMin(cls.inicio) % 60)}${cls.aula ? ' · ' + UI.escapeHTML(cls.aula) : ''}</span>
          </div>`;
        } else {
          const dayTasks = (tasksByDay[key] || []).filter(t => !t.hecho).slice(0, 1);
          if (dayTasks.length) {
            const col = UI.colorFor(dayTasks[0].materia, App.subjectsCache);
            inner = `<div class="wk-cls" style="--ev-color:${col};"><b>${UI.escapeHTML(dayTasks[0].titulo)}</b></div>`;
          }
        }

        html += `<div class="wk-cell ${isToday ? 'today' : ''}" style="grid-row:${row};grid-column:${i + 2};" data-date="${key}" data-dow="${dowNum}">${inner}</div>`;
      }
    }

    weekView().className = 'week-grid';
    weekView().innerHTML = html;

    weekView().querySelectorAll('.wk-head').forEach(hd => {
      hd.addEventListener('click', () => {
        state.selected = hd.dataset.date;
        render();
      });
    });
    // Clic en celda de clase -> editar; celda libre -> nada (evita capturas accidentales)
    weekView().querySelectorAll('.wk-cell').forEach(cell => {
      cell.addEventListener('click', e => {
        const ev = e.target.closest('.wk-cls');
        if (!ev) return;
        if (typeof Timetable !== 'undefined') {
          App.showView('timetable');
        }
      });
    });
  }

  /* ------------ Panel del día seleccionado ------------ */
  async function renderSelected(tasks) {
    const label = document.getElementById('selDateLabel');
    const list = document.getElementById('selList');
    const [y, m, d] = state.selected.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    label.textContent = UI.fmtDate(date);

    const dayItems = tasks.filter(t => t.vence && UI.dayKey(new Date(t.vence)) === state.selected);
    if (!dayItems.length) {
      list.innerHTML = '<div class="muted small">Nada programado este día.</div>';
      return;
    }
    list.innerHTML = dayItems.map(t => {
      const c = UI.colorFor(t.materia, App.subjectsCache);
      const ov = UI.isOverdue(t.vence) && !t.hecho;
      return `
        <div class="task-row card ${t.hecho ? 'done' : ''}" style="background:var(--glass-input);">
          <button class="task-check" data-toggle="${t._id}" aria-label="Completar">
            <span class="material-symbols-outlined">check</span>
          </button>
          <div class="task-body">
            <span class="task-title">${UI.escapeHTML(t.titulo)}</span>
            <div class="task-meta">
              <span class="materia-tag" style="background:${c}22;color:${c};">${UI.escapeHTML(t.materia || 'General')}</span>
              <span class="${ov ? 'task-overdue' : ''}">${t.vence ? UI.fmtTime(new Date(t.vence)) : ''} ${ov ? '· vencida' : ''}</span>
            </div>
          </div>
          <div class="task-actions">
            <button class="icon-btn" data-del="${t._id}" aria-label="Eliminar">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-toggle]').forEach(b =>
      b.addEventListener('click', () => App.toggleTask(b.dataset.toggle)));
    list.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => App.deleteTask(b.dataset.del)));
  }

  return { init, render, state };
})();
