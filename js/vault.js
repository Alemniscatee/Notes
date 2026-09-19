/* ============================================================
   AURA — vault.js
   BOTÓN B ("🧠 Preguntar a la Bóveda"): chat con IA sobre tu
   bóveda. Arma contexto (materias + tareas + notas) y consulta
   a Gemini. Soporta dictado por voz y render de markdown.
   Depende de: Gemini, Store, UI, App.
   ============================================================ */

const Vault = (() => {
  const $ = id => document.getElementById(id);
  let busy = false;
  let recognition = null;

  function init() {
    $('btnAskVault').addEventListener('click', () => App.showView('vault'));
    $('vaultSendBtn').addEventListener('click', send);
    $('vaultInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    $('vaultMicBtn').addEventListener('click', startVoice);
    $('vaultOrbStop').addEventListener('click', stopVoice);
    document.querySelectorAll('#vaultEmpty [data-q]').forEach(chip =>
      chip.addEventListener('click', () => {
        $('vaultInput').value = chip.dataset.q;
        send();
      }));
    autoGrow();
  }

  function autoGrow() {
    const ta = $('vaultInput');
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    });
  }

  /* ---------------- Voz ---------------- */
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { UI.toast('Tu navegador no soporta dictado', 'err'); return; }
    recognition = new SR();
    recognition.lang = navigator.language || 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = true;

    const modal = $('vaultMicModal');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    const tr = $('vaultVoiceTranscript');

    /* FIX Voz: prioriza el resultado FINAL (isFinal) y envía solo texto claro. */
    let finalText = '';
    recognition.onresult = e => {
      tr.textContent = '“' + [...e.results].map(r => r[0].transcript).join('') + '”';
      for (const res of e.results) {
        if (res.isFinal && res[0].transcript.trim()) finalText = res[0].transcript.trim();
      }
    };
    recognition.onend = () => {
      setTimeout(() => {
        modal.classList.remove('open');
        if (!document.querySelector('.modal-root.open')) document.body.style.overflow = '';
        const raw = tr.textContent.replace(/^“|”$/g, '').trim();
        const text = finalText || raw;
        const placeholder = !text || /^escuchando/i.test(text);
        if (!placeholder) {
          $('vaultInput').value = text;
          send();                            // envío automático a la Bóveda
        } else {
          UI.toast('El dictado no capturó texto claro.', 'err', 4000);
        }
      }, 500);
    };
    recognition.onerror = () => {
      modal.classList.remove('open');
      UI.toast('No se pudo usar el micrófono', 'err');
    };
    recognition.start();
  }

  function stopVoice() {
    try { recognition && recognition.stop(); } catch (e) {}
  }

  /* ---------------- Envío ---------------- */
  async function send() {
    if (busy) return;
    const q = $('vaultInput').value.trim();
    if (!q) return;

    if (!(Settings.get().geminiKey || '').trim()) {
      UI.toast('Configura tu API Key de Gemini en ⚙️ Ajustes', 'err', 5000);
      App.showView('settings');
      return;
    }

    busy = true;
    $('vaultInput').value = '';
    $('vaultInput').style.height = 'auto';
    hideEmpty();

    appendMsg('user', q);
    const typing = appendTyping();

    try {
      const [notes, tasks, subjects] = await Promise.all([
        Store.getNotes(), Store.getTasks(), Store.getSubjects()
      ]);
      const answer = await Gemini.askVault(q, { notes, tasks, subjects });
      typing.remove();
      appendMsg('aura', answer);
    } catch (err) {
      typing.remove();
      appendMsg('aura', `⚠️ ${UI.escapeHTML(err.message || 'Error consultando a Gemini.')}`);
    } finally {
      busy = false;
      $('vaultInput').focus();
    }
  }

  /* ---------------- Render ---------------- */
  function hideEmpty() {
    const e = $('vaultEmpty');
    if (e) e.remove();
  }

  function appendMsg(role, text) {
    const chat = $('vaultChat');
    const wrap = document.createElement('div');
    wrap.className = `vault-msg ${role}`;
    const icon = role === 'user' ? 'person' : 'auto_awesome';
    wrap.innerHTML = `
      <div class="msg-avatar ${role === 'user' ? 'user-avatar' : ''}">
        <span class="material-symbols-outlined">${icon}</span>
      </div>
      <div class="msg-bubble">${role === 'user' ? UI.escapeHTML(text) : UI.mdToHTML(text)}</div>`;
    chat.appendChild(wrap);
    // Diagramas ```mermaid dentro de las respuestas de la IA
    if (role !== 'user') UI.renderCodeBlocks(wrap.querySelector('.msg-bubble'));
    chat.scrollTop = chat.scrollHeight;
    return wrap;
  }

  function appendTyping() {
    const chat = $('vaultChat');
    const wrap = document.createElement('div');
    wrap.className = 'vault-msg aura';
    wrap.innerHTML = `
      <div class="msg-avatar"><span class="material-symbols-outlined">auto_awesome</span></div>
      <div class="msg-bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div>`;
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return wrap;
  }

  return { init, send };
})();
