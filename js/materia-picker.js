/* ============================================================
   AURA — materia-picker.js
   Selector rápido de materias por chips (toque, sin escribir).
   Instancias: #capMateriaChips (captura rápida, input de texto)
   y #editorMateriaChips (editor, select #editorMateria).
   Depende de: Store (getSubjects), UI (escapeHTML/escapeAttr).
   ============================================================ */

const MateriaPicker = (() => {
  const instances = [];   // { rootId, targetId, mode, onChange }
  let subjectsCache = [];

  const $ = id => document.getElementById(id);

  /* ---------- Render de chips para cada instancia ---------- */
  function renderAll() {
    instances.forEach(inst => {
      const root = $(inst.rootId);
      if (!root) return;
      const cur = getTargetValue(inst);

      const chips = subjectsCache.map(s => {
        const active = cur && cur.toLowerCase() === (s.nombre || '').toLowerCase();
        return `<button type="button" class="materia-chip${active ? ' active' : ''}"
                  data-value="${UI.escapeAttr(s.nombre)}"
                  role="option" aria-selected="${active}">
                  <i style="background:${s.color || '#8b5cf6'};color:${s.color || '#8b5cf6'};"></i>
                  ${UI.escapeHTML(s.nombre)}
                </button>`;
      }).join('');

      /* La opción VIDA_COTIDIANA solo aplica al editor (select). En
         captura rápida basta dejar el campo vacío = General. */
      const extra = inst.mode === 'select'
        ? `<button type="button" class="materia-chip${cur === 'VIDA_COTIDIANA' ? ' active' : ''}"
             data-value="VIDA_COTIDIANA" role="option" aria-selected="${cur === 'VIDA_COTIDIANA'}">🏠 Vida Cotidiana</button>`
        : '';

      root.innerHTML = chips
        ? extra + chips
        : `<span class="hint" style="margin:0;">Sin materias creadas aún — escribe la materia y se guardará automáticamente.</span>`;
    });
  }

  function getTargetValue(inst) {
    const t = $(inst.targetId);
    if (!t) return '';
    return inst.mode === 'select' ? (t.value || '') : (t.value || '').trim();
  }

  function setTargetValue(inst, value) {
    const t = $(inst.targetId);
    if (!t) return;
    if (inst.mode === 'select') {
      t.value = value;
      t.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      t.value = value;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ---------- Delegación de clics ---------- */
  function bindClicks() {
    document.addEventListener('click', e => {
      const chip = e.target.closest('.materia-chip');
      if (!chip) return;
      const root = chip.closest('.materia-chips');
      if (!root) return;
      const inst = instances.find(i => i.rootId === root.id);
      if (!inst) return;
      const value = chip.dataset.value || '';
      const already = getTargetValue(inst).toLowerCase() === value.toLowerCase();
      // Segundo toque sobre el chip activo = desasignar (quedará General / Sin materia)
      setTargetValue(inst, already ? '' : value);
      if (inst.onChange) inst.onChange(already ? '' : value);
      renderAll();
    });
  }

  /* ---------- Refresco desde la base de datos ---------- */
  async function refresh() {
    try {
      subjectsCache = await Store.getSubjects();
    } catch (e) {
      subjectsCache = [];
    }
    renderAll();
  }

  /* ---------- Init público ---------- */
  function init() {
    instances.push(
      { rootId: 'capMateriaChips', targetId: 'capMateria', mode: 'input' },
      { rootId: 'editorMateriaChips', targetId: 'editorMateria', mode: 'select' }
    );
    bindClicks();
    // Estado inicial (si Store aún no cargó, queda vacío hasta refresh())
    refresh();
    // Al escribir a mano el input/select, sincroniza el chip activo
    ['capMateria', 'editorMateria'].forEach(id => {
      $(id)?.addEventListener('input', renderAll);
      $(id)?.addEventListener('change', renderAll);
    });
  }

  return { init, refresh, renderAll };
})();
