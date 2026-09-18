/* ============================================================
   AURA — calendar.js
   Calendario mensual/semanal + agenda del día seleccionado.
   Depende de: Store, UI, App (showView, openCapture).
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
      state.cursor.setDate(state.cursor.getDate() + dir * 7);
    }
    render();
  }

  /* ------------ Render month grid ------------ */
  async function render() {
    const tasks = await Store.getTasks();
    renderDow();
    if (state.mode === 'month') {
      weekView().hidden = true;
      grid().hidden = false;
      renderMonth(tasks);
    } else {
      grid().hidden = true;
      weekView().hidden = false;
      renderWeek(tasks);
    }
    renderSelected(tasks);
    title().textContent = state.mode === 'month'
      ? `${UI.MESES[state.cursor.getMonth()]} ${state.cursor.getFullYear()}`
      : `Semana del ${state.cursor.getDate()} ${UI.MESES[state.cursor.getMonth()].toLowerCase()}`;
  }

  function renderDow() {
    dow().innerHTML = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
      .map(d => `<div class="cal-dow">${d}</div>`).join('');
  }

  function renderMonth(tasks) {
    const y = state.cursor.getFullYear();
    const m = state.cursor.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = (first.getDay() + 6) % 7; // lunes=0
    const gridStart = new Date(y, m, 1 - startOffset);
    const todayKey = UI.dayKey(new Date());

    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const key = UI.dayKey(d);
      const other = d.getMonth() !== m;
      const isToday = key === todayKey;
      const isSel = key === state.selected;

      const dayTasks = tasks.filter(t => t.vence && UI.dayKey(new Date(t.vence)) === key && !t.hecho);
      const dots = dayTasks.slice(0, 3).map(t => {
        const c = UI.colorFor(t.materia, App.subjectsCache);
        return `<i class="${c === '#22d3ee' ? 'cyan' : ''}" style="background:${c};box-shadow:0 0 6px ${c}"></i>`;
      }).join('');

      html += `
        <div class="cal-cell ${other ? 'other' : ''} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-date="${key}">
          <span class="daynum">${d.getDate()}</span>
          <span class="cal-dots">${dots}</span>
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
    const off = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - off);
    return copy;
  }

  function renderWeek(tasks) {
    const start = startOfWeek(state.cursor);
    const todayKey = UI.dayKey(new Date());
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = UI.dayKey(d);
      const dayTasks = tasks
        .filter(t => t.vence && UI.dayKey(new Date(t.vence)) === key)
        .sort((a, b) => (a.vence || '').localeCompare(b.vence || ''));

      html += `
        <div class="card week-day ${key === todayKey ? 'today' : ''}" data-date="${key}">
          <div class="wd-head">
            <span class="wd-name">${UI.DIAS[d.getDay()]}</span>
            <span class="wd-num">${d.getDate()} ${UI.MESES[d.getMonth()].slice(0, 3).toLowerCase()}</span>
          </div>
          ${dayTasks.length
            ? dayTasks.map(taskRowMini).join('')
            : '<div class="muted small">Sin eventos.</div>'}
        </div>`;
    }
    weekView().innerHTML = html;
    weekView().querySelectorAll('.week-day').forEach(wd => {
      wd.addEventListener('click', e => {
        if (e.target.closest('.task-check')) return;
        state.selected = wd.dataset.date;
        render();
      });
    });
  }

  function taskRowMini(t) {
    const c = UI.colorFor(t.materia, App.subjectsCache);
    return `
      <div class="timeline-item" data-id="${t._id}" style="padding:8px 10px;">
        <span class="tl-time">${t.vence ? UI.fmtTime(new Date(t.vence)) : '—'}</span>
        <span class="tl-title">${UI.escapeHTML(t.titulo)}</span>
        <span class="materia-tag" style="background:${c}22;color:${c};border-color:${c}44;">${UI.escapeHTML((t.materia || 'General').slice(0, 12))}</span>
      </div>`;
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
