/* ============================================================
   AURA — timetable.js
   Vista "Horario Académico": cuadrícula semanal fija (Lun–Sáb)
   dividida en bloques de 30 min. Las clases se guardan en
   PouchDB como docs type:'class' y se renderizan como eventos
   posicionados absolutamente sobre la rejilla.
   Depende de: Store, UI, App.
   ============================================================ */

const Timetable = (() => {
  const $ = id => document.getElementById(id);

  /* ---------------- Config de la rejilla ---------------- */
  const START_HOUR = 7;    // 07:00
  const END_HOUR = 22;     // hasta 22:00
  const SLOT_MIN = 30;     // bloques de 30 minutos
  const DAYS = [1, 2, 3, 4, 5, 6]; // Lunes..Sábado
  const DAY_LABELS = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };

  const TOTAL_MIN = (END_HOUR - START_HOUR) * 60;
  const ROWS = (END_HOUR - START_HOUR) * (60 / SLOT_MIN);

  let classesCache = [];
  let editingId = null;

  const toMin = hm => {
    const [h, m] = String(hm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  /* ---------------- Inicialización ---------------- */
  function init() {
    $('ttAddBtn').addEventListener('click', () =>
      openClassModal(null, { inicio: '08:00', fin: '10:00' }));

    $('clsSaveBtn').addEventListener('click', saveClass);
    $('clsDeleteBtn').addEventListener('click', deleteEditingClass);

    // Clic en celda vacía -> nueva clase prellenada con ese día y hora
    $('ttGrid').addEventListener('click', e => {
      const cell = e.target.closest('.tt-cell');
      if (!cell) return;
      const day = Number(cell.dataset.day);
      const slot = Number(cell.dataset.slot);
      const startMin = START_HOUR * 60 + slot * SLOT_MIN;
      const p = n => String(n).padStart(2, '0');
      openClassModal(null, {
        dia: day,
        inicio: `${p(Math.floor(startMin / 60))}:${p(startMin % 60)}`,
        fin: `${p(Math.floor((startMin + 60) / 60))}:${p((startMin + 60) % 60)}`
      });
    });

    // Clic en un evento -> editar esa clase
    $('ttGrid').addEventListener('click', e => {
      const ev = e.target.closest('.tt-event');
      if (!ev) return;
      e.stopPropagation();
      const cls = classesCache.find(c => c._id === ev.dataset.id);
      if (cls) openClassModal(cls);
    });
  }

  /* ---------------- Render del grid semanal ---------------- */
  async function render() {
    classesCache = await Store.getClasses();
    renderGrid();
    renderLegend();

    const empty = $('ttEmpty');
    empty.hidden = classesCache.length > 0;
  }

  function renderGrid() {
    const grid = $('ttGrid');
    const p = n => String(n).padStart(2, '0');

    let html = '';

    // Cabecera: esquina + días
    html += `<div class="tt-corner"></div>`;
    for (const d of DAYS) {
      const isToday = new Date().getDay() === d;
      html += `<div class="tt-dow ${isToday ? 'today' : ''}">${DAY_LABELS[d]}</div>`;
    }

    // Filas de horas: etiqueta + 12 celdas de 30 min por hora
    for (let r = 0; r < ROWS; r++) {
      if (r % 2 === 0) {
        const hh = START_HOUR + r / 2;
        html += `<div class="tt-time">${p(hh)}:00</div>`;
      }
      for (const d of DAYS) {
        html += `<div class="tt-cell" data-day="${d}" data-slot="${r}"></div>`;
      }
    }

    // Eventos posicionados absolutamente: un bloque por CADA día asignado
    for (const cls of classesCache) {
      const color = UI.colorFor(cls.materia, App.subjectsCache);
      const startM = Math.max(toMin(cls.inicio), START_HOUR * 60);
      const endM = Math.min(Math.max(toMin(cls.fin), startM + SLOT_MIN), END_HOUR * 60);
      const top = ((startM - START_HOUR * 60) / TOTAL_MIN) * 100;
      const height = ((endM - startM) / TOTAL_MIN) * 100;
      const dias = (cls.dias || []).filter(d => DAYS.includes(d));
      if (!dias.length) continue;

      for (const d of dias) {
        html += `
        <div class="tt-event" data-id="${cls._id}"
             style="left:calc(44px + (100% - 44px) / ${DAYS.length} * ${d - 1} + 2px);
                    width:calc((100% - 44px) / ${DAYS.length} - 4px);
                    top:calc(${top.toFixed(3)}% + 1px);
                    height:calc(${height.toFixed(3)}% - 2px);
                    --ev-color:${color};">
          <div class="tt-ev-time">${cls.inicio} – ${cls.fin}</div>
          <div class="tt-ev-title">${UI.escapeHTML(cls.materia || 'Clase')}</div>
          ${cls.aula ? `<div class="tt-ev-aula"><span class="material-symbols-outlined">location_on</span>${UI.escapeHTML(cls.aula)}</div>` : ''}
        </div>`;
      }
    }

    grid.innerHTML = html;
  }

  function renderLegend() {
    const legend = $('ttLegend');
    const used = [...new Set(classesCache.map(c => c.materia).filter(Boolean))];
    if (!used.length) { legend.innerHTML = ''; return; }
    legend.innerHTML = used.map(m => {
      const c = UI.colorFor(m, App.subjectsCache);
      return `<span class="tt-chip"><i style="background:${c};box-shadow:0 0 8px ${c};"></i>${UI.escapeHTML(m)}</span>`;
    }).join('');
  }

  /* ---------------- Modal de clase ---------------- */
  async function openClassModal(data, preset) {
    editingId = data ? data._id : null;

    // Poblar select de materias desde el catálogo persistido
    const subjects = App.subjectsCache || await Store.getSubjects();
    const sel = $('clsMateria');
    if (!subjects.length) {
      sel.innerHTML = '<option value="">(crea una materia primero)</option>';
    } else {
      sel.innerHTML = subjects.map(s =>
        `<option value="${UI.escapeAttr(s._id)}">${UI.escapeHTML(s.nombre)}</option>`).join('');
    }

    $('clsModalTitle').textContent = data ? 'Editar clase' : 'Nueva clase';
    $('clsDeleteBtn').hidden = !data;

    const diasArr = data ? (data.dias || []) : (preset && preset.dia ? [preset.dia] : [1]);
    $('clsDias').querySelectorAll('input').forEach(cb => {
      cb.checked = diasArr.includes(Number(cb.value));
    });
    $('clsMateria').value = data ? (data.materiaId || '') : (subjects[0] ? subjects[0]._id : '');
    if (!$('clsMateria').value && sel.options.length) sel.selectedIndex = 0;
    $('clsAula').value = data ? (data.aula || '') : '';
    $('clsInicio').value = data ? data.inicio : (preset?.inicio || '08:00');
    $('clsFin').value = data ? data.fin : (preset?.fin || '10:00');

    UI.openModal('classModal');
  }

  async function saveClass() {
    const matId = $('clsMateria').value;
    if (!matId) {
      UI.toast('Primero crea una materia (📚 Gestionar Materias)', 'err', 4500);
      return;
    }
    const subject = (App.subjectsCache || []).find(s => s._id === matId);
    const dias = [...$('clsDias').querySelectorAll('input:checked')].map(cb => Number(cb.value));
    if (!dias.length) { UI.toast('Selecciona al menos un día', 'err'); return; }

    const inicio = $('clsInicio').value || '08:00';
    const fin = $('clsFin').value || '09:00';
    if (toMin(fin) <= toMin(inicio)) {
      UI.toast('La hora de fin debe ser mayor a la de inicio', 'err');
      return;
    }

    await Store.upsertClass({
      id: editingId,
      materiaId: matId,
      materia: subject ? subject.nombre : '',
      aula: $('clsAula').value.trim(),
      inicio, fin, dias
    });

    UI.closeModal('classModal');
    UI.toast(editingId ? 'Clase actualizada ✓' : 'Clase agregada al horario ✓', 'ok');
    editingId = null;
    await render();
    App.refreshAll();
  }

  async function deleteEditingClass() {
    if (!editingId) return;
    if (!confirm('¿Eliminar esta clase del horario?')) return;
    await Store.deleteClass(editingId);
    UI.closeModal('classModal');
    UI.toast('Clase eliminada', 'ok');
    editingId = null;
    await render();
    App.refreshAll();
  }

  return { init, render };
})();
