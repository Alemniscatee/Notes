/* ============================================================
   AURA — capture.js
   BOTÓN A ("+ Ingresar"): captura manual o por voz.
   El dictado se envía a Gemini -> JSON estricto
   { tipo, materia, titulo, fecha_recordatorio, contenido }
   Depende de: Gemini, Store, UI, App, Settings.
   ============================================================ */

const Capture = (() => {
  let mode = 'manual';
  let capType = 'tarea';
  let recognition = null;
  let listening = false;
  let parsed = null;          // resultado de Gemini listo para guardar
  let transcript = '';

  const $ = id => document.getElementById(id);

  function init() {
    $('btnAddEntry').addEventListener('click', open);
    $('capModeManual').addEventListener('click', () => setMode('manual'));
    $('capModeVoice').addEventListener('click', () => setMode('voice'));
    $('capTypeSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-type]');
      if (!b) return;
      capType = b.dataset.type;
      $('capTypeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      $('capFechaField').hidden = capType !== 'tarea';
      $('capContenidoField').hidden = capType !== 'nota';
    });
    $('capSaveBtn').addEventListener('click', saveManual);
    $('voiceOrb').addEventListener('click', toggleListen);
    $('voiceCancelBtn').addEventListener('click', () => {
      stopListening();
      $('parsePreview').hidden = true;
      $('voiceTranscript').innerHTML = 'Toca el orbe y dicta.<br>Ej: «Entrega del laboratorio de física para el viernes a las 5»';
      $('voiceSaveBtn').disabled = true;
    });
    $('voiceSaveBtn').addEventListener('click', saveParsed);
  }

  function open() {
    setMode('manual');
    UI.openModal('captureModal');
    refreshDatalist();
    setTimeout(() => $('capTitulo').focus(), 250);
  }

  /* Abre el modal directamente en la pestaña Voz + IA e inicia la escucha
     de inmediato (acceso rápido "🎙️ Dictado Rápido"). */
  function openVoice() {
    setMode('voice');
    UI.openModal('captureModal');
    refreshDatalist();
    startListening();   // activa el micrófono de inmediato (sin tocar el orbe)
  }

  function refreshDatalist() {
    const subjects = App.subjectsCache || [];
    $('materiasDatalist').innerHTML = subjects.map(s =>
      `<option value="${UI.escapeAttr(s.nombre)}">`).join('');
  }

  function setMode(m) {
    mode = m;
    $('capModeManual').classList.toggle('active', m === 'manual');
    $('capModeVoice').classList.toggle('active', m === 'voice');
    /* FIX Voz: al entrar en "Voz + IA" oculta COMPLETAMENTE el formulario
       manual y muestra el panel de voz; al volver a Manual, detiene la escucha. */
    const manual = $('capManual');
    const voice = $('capVoice');
    manual.hidden = m !== 'manual';
    voice.hidden = m !== 'voice';
    voice.classList.toggle('active', m === 'voice');
    if (m !== 'voice') stopListening();
  }

  /* Activa la escucha por voz si no está ya activa (Web Speech API). */
  function startListening() {
    if (listening) return;
    if (!SR) {
      UI.toast('Tu navegador no soporta voz. Escribe en modo Manual.', 'err', 5000);
      return;
    }
    // Pequeña espera: el modal termina su transición antes de pedir el micrófono
    setTimeout(() => { if (!listening) toggleListen(); }, 250);
  }

  /* ---------------- Manual ---------------- */
  async function saveManual() {
    const titulo = $('capTitulo').value.trim();
    if (!titulo) { UI.toast('Escribe un título', 'err'); return; }
    const materia = $('capMateria').value.trim() || 'General';
    await App.ensureSubject(materia);

    if (capType === 'tarea') {
      const vence = $('capFecha').value || null;
      await Store.saveTask({ titulo, materia, vence, contenido: '' });
      UI.toast('Tarea guardada ✓', 'ok');
    } else {
      const contenido = $('capContenidoQuick').value.trim() || titulo;
      await Store.saveNote({ titulo, materia, contenido });
      UI.toast('Nota guardada ✓', 'ok');
    }

    $('capTitulo').value = '';
    $('capFecha').value = '';
    $('capContenidoQuick').value = '';
    UI.closeModal('captureModal');
    App.refreshAll();
  }

  /* ---------------- Voz (Web Speech API) ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function toggleListen() {
    if (listening) { stopListening(); return; }
    if (!SR) {
      UI.toast('Tu navegador no soporta voz. Escribe en modo Manual.', 'err', 5000);
      return;
    }
    startRecognition();
  }

  function startRecognition() {
    recognition = new SR();
    recognition.lang = (navigator.language || 'es-ES');
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const orb = $('voiceOrb');
    recognition.onstart = () => {
      listening = true;
      orb.classList.add('listening');
      $('wave').classList.add('on');
      $('voiceTranscript').textContent = 'Escuchando…';
    };
    /* FIX Voz: se espera a que el resultado sea FINAL (isFinal) para
       disparar el flujo de guardado; los parciales solo alimentan el
       feedback en pantalla. */
    let finalHandled = false;
    recognition.onresult = e => {
      transcript = [...e.results].map(r => r[0].transcript).join('');
      $('voiceTranscript').textContent = `“${transcript}”`;
      for (const res of e.results) {
        if (res.isFinal && !finalHandled) {
          finalHandled = true;
          const finalText = res[0].transcript.trim();
          if (finalText) {
            try { recognition.stop(); } catch (err) {}
            parseWithGemini(finalText);   // flujo automático hacia Store/DB
          }
        }
      }
    };
    recognition.onerror = e => {
      listening = false;
      orb.classList.remove('listening');
      $('wave').classList.remove('on');
      UI.toast(e.error === 'not-allowed'
        ? 'Permiso de micrófono denegado'
        : 'Error de voz: ' + e.error, 'err');
    };
    recognition.onend = () => {
      listening = false;
      orb.classList.remove('listening');
      $('wave').classList.remove('on');
      // Fallback: si isFinal no llegó (algunos navegadores), usa el transcript acumulado
      if (!finalHandled && transcript.trim()) parseWithGemini(transcript.trim());
      else if (!finalHandled && !transcript.trim())
        UI.toast('El dictado no capturó texto claro. Intenta de nuevo.', 'err', 4500);
    };
    recognition.start();
  }

  function stopListening() {
    try { recognition && recognition.stop(); } catch (e) {}
    listening = false;
    $('voiceOrb').classList.remove('listening');
    $('wave') && $('wave').classList.remove('on');
  }

  async function parseWithGemini(text) {
    const btn = $('voiceSaveBtn');
    btn.disabled = true;
    $('voiceTranscript').insertAdjacentHTML('beforeend', '<div class="typing-dots"><i></i><i></i><i></i></div>');
    try {
      const subjects = await Store.getSubjects();
      parsed = await Gemini.parseIntention(text, subjects, new Date());
      renderPreview(parsed);
      btn.disabled = false;
      /* ENVÍO AUTOMÁTICO: guardado directo en la base de datos sin
         requerir pulsar "Enviar". */
      await saveParsed();
    } catch (err) {
      UI.toast(err.message || 'Error al interpretar con Gemini', 'err', 6000);
      $('voiceTranscript').textContent = 'No se pudo interpretar. Intenta de nuevo o usa el modo manual.';
    }
  }

  function renderPreview(p) {
    const el = $('parsePreview');
    el.hidden = false;
    const color = UI.colorFor(p.materia, App.subjectsCache);
    el.innerHTML = `
      <div class="pp-head"><span class="material-symbols-outlined" style="font-size:14px;">auto_awesome</span> Gemini entendió:</div>
      <div class="parse-row"><b>Tipo</b><span>${p.tipo === 'tarea' ? '✅ Tarea' : '🗒️ Nota'}</span></div>
      <div class="parse-row"><b>Título</b><span>${UI.escapeHTML(p.titulo)}</span></div>
      <div class="parse-row"><b>Materia</b><span class="materia-tag" style="background:${color}22;color:${color};">${UI.escapeHTML(p.materia)}</span></div>
      <div class="parse-row"><b>Fecha</b><span>${p.fecha_recordatorio ? UI.fmtDateTime(p.fecha_recordatorio) : '—'}</span></div>
      <div class="parse-row"><b>Detalle</b><span>${UI.escapeHTML((p.contenido || '').slice(0, 140))}</span></div>`;
  }

  async function saveParsed() {
    if (!parsed) {
      // El dictado no produjo texto interpretable
      UI.toast('El dictado no capturó texto claro. Intenta de nuevo.', 'err', 4500);
      return;
    }
    const p = parsed;
    await App.ensureSubject(p.materia || 'General');
    if (p.tipo === 'tarea') {
      await Store.saveTask({
        titulo: p.titulo, materia: p.materia,
        vence: p.fecha_recordatorio, contenido: p.contenido || ''
      });
      UI.toast('Tarea creada por voz ✓', 'ok');
    } else {
      await Store.saveNote({
        titulo: p.titulo, materia: p.materia,
        contenido: p.contenido || p.titulo
      });
      UI.toast('Nota creada por voz ✓', 'ok');
    }
    parsed = null;
    transcript = '';
    $('parsePreview').hidden = true;
    $('voiceTranscript').textContent = 'Toca el orbe y dicta de nuevo cuando quieras.';
    $('voiceSaveBtn').disabled = true;
    UI.closeModal('captureModal');
    App.refreshAll();
  }

  return { init, open, openVoice, setMode, startListening };
})();
