/* ============================================================
   AURA — gemini.js
   Google Gemini REST client:
   1) parseIntention: voice/text -> strict JSON for capture
   2) askVault: RAG-ish Q&A over the user's PouchDB content
   ============================================================ */

const Gemini = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  const DEFAULT_MODEL = 'gemini-3.5-flash';

  function model() {
    return (Settings.get().geminiModel || DEFAULT_MODEL).trim();
  }
  function key() {
    return (Settings.get().geminiKey || '').trim();
  }

  async function callGemini(prompt, { json = false, temperature = 0.4 } = {}) {
    if (!key()) throw new Error('Falta la API Key de Gemini (⚙️ Ajustes).');
    const url = `${BASE}/${encodeURIComponent(model())}:generateContent?key=${encodeURIComponent(key())}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: 2048,
        ...(json ? { response_mime_type: 'application/json' } : {})
      }
    };

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('Sin conexión con Gemini. Verifica tu red.');
    }

    /* Blindaje anti-404: si el modelo configurado ya no existe en la API
       (los IDs se retiran con el tiempo), reintenta una vez con el modelo
       por defecto y persiste el cambio para no volver a fallar. */
    if (res.status === 404 && model() !== DEFAULT_MODEL) {
      Settings.patch({ geminiModel: DEFAULT_MODEL });
      return callGemini(prompt, { json, temperature });
    }

    if (!res.ok) {
      let msg = 'Error ' + res.status;
      try {
        const err = await res.json();
        msg = err.error?.message || msg;
      } catch (_) { /* keep default */ }
      throw new Error(msg);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!text) throw new Error('Gemini devolvió una respuesta vacía.');
    return text;
  }

  /* ------------------------------------------------------------
     1) Parse intention -> strict JSON
     { "tipo": "tarea"|"nota", "materia": string, "titulo": string,
       "fecha_recordatorio": string|null, "contenido": string }
  ------------------------------------------------------------ */
  const PARSE_SCHEMA = `{
  "tipo": "tarea" | "nota",
  "materia": string,
  "titulo": string,
  "fecha_recordatorio": string | null,
  "contenido": string
}`;

  /* ------------------------------------------------------------
     Matching difuso de materias: normaliza acentos/mayúsculas y
     compara por igualdad, contención o similitud de tokens/n-gramas.
     Devuelve el nombre REAL de la materia o null si nada encaja.
  ------------------------------------------------------------ */
  function normalizeStr(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita acentos
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m + n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  function diceBigram(a, b) {
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const grams = s => {
      const set = new Set();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const A = grams(a), B = grams(b);
    let inter = 0;
    for (const g of A) if (B.has(g)) inter++;
    return (2 * inter) / (A.size + B.size);
  }

  function matchSubject(name, subjects) {
    const list = (subjects || []).filter(s => s && s.nombre);
    if (!list.length) return null;
    const target = normalizeStr(name);
    if (!target || target === 'general') return null;

    let best = null, bestScore = 0;
    for (const s of list) {
      const cand = normalizeStr(s.nombre);
      if (!cand) continue;
      let score = 0;
      if (cand === target) score = 1;
      else if (cand.includes(target) || target.includes(cand)) score = 0.93;
      else {
        const tTokens = target.split(' ').filter(t => t.length > 2);
        const cTokens = cand.split(' ').filter(t => t.length > 2);
        const shared = tTokens.filter(t => cTokens.includes(t)).length;
        const tokenScore = (tTokens.length && cTokens.length)
          ? shared / Math.min(tTokens.length, cTokens.length) : 0;
        const dist = levenshtein(cand, target);
        const maxLen = Math.max(cand.length, target.length);
        const levScore = 1 - dist / maxLen;
        score = Math.max(tokenScore * 0.9, levScore, diceBigram(cand, target) * 0.95);
      }
      if (score > bestScore) { bestScore = score; best = s.nombre; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  async function parseIntention(transcript, subjects, now) {
    const subjList = subjects.map(s => s.nombre).join(', ') || '(ninguna todavía)';
    const nowStr = now.toLocaleString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const prompt = `Eres el parser de intención de "AURA Life Dashboard", una app académica.
Convierte la frase del estudiante en EXACTAMENTE un objeto JSON válido, sin texto adicional, sin markdown.

ESQUEMA ESTRICTO:
${PARSE_SCHEMA}

REGLAS:
- "tipo": "tarea" si es algo por hacer/entregar/examen/recordatorio con fecha; "nota" si es apunte/concepto/resumen.
- "materia": elige la materia MÁS PARECIDA de esta lista: [${subjList}]. Copia el nombre EXACTO de la lista (sin inventar). Si ninguna encaja usa "General".
- "titulo": máximo 80 caracteres, claro y en imperativo si es tarea.
- "fecha_recordatorio": ISO 8601 ("YYYY-MM-DDTHH:MM:SS") o null si no hay fecha explícita/derivabile. Hoy es ${nowStr}.
  Ejemplos: "mañana a las 5pm" -> mañana 17:00; "el viernes" -> próximo viernes 09:00; "para el 12 de octubre" -> "YYYY-10-12T09:00:00".
- "contenido": la frase original ampliada con detalles citados. Nunca vacío.
- Responde SOLO el JSON.`;

    const raw = await callGemini(prompt, { json: true, temperature: 0.1 });
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Gemini no devolvió JSON válido.');
      obj = JSON.parse(m[0]);
    }

    // Normalize
    obj.tipo = obj.tipo === 'tarea' ? 'tarea' : 'nota';
    obj.materia = (obj.materia || 'General').toString().slice(0, 60);
    /* Blindaje anti-alucinación: si Gemini inventó una materia que no
       existe, la reemplazamos por la más parecida de la lista real.
       Así los dictados siempre caen en una materia reconocible. */
    const matched = matchSubject(obj.materia, subjects);
    obj.materia = matched || 'General';
    obj.titulo = (obj.titulo || 'Sin título').toString().slice(0, 120);
    if (obj.fecha_recordatorio === '') obj.fecha_recordatorio = null;
    if (obj.fecha_recordatorio) {
      const d = new Date(obj.fecha_recordatorio);
      obj.fecha_recordatorio = isNaN(d) ? null : d.toISOString();
    }
    obj.contenido = (obj.contenido || transcript).toString();
    return obj;
  }

  /* ------------------------------------------------------------
     2) Vault Q&A: build compact context from PouchDB and ask
  ------------------------------------------------------------ */
  async function askVault(question, context) {
    const { notes, tasks, subjects } = context;

    const noteBlock = notes.slice(0, 40).map(n =>
      `- [${n.materia || 'General'}] ${n.titulo}: ${stripMarkdown(n.contenido).slice(0, 600)}`
    ).join('\n') || '(sin notas)';

    const taskBlock = tasks.slice(0, 30).map(t =>
      `- [${t.materia || 'General'}] ${t.titulo} — vence: ${t.vence || 'sin fecha'}${t.hecho ? ' (hecha)' : ''}`
    ).join('\n') || '(sin tareas)';

    const subjBlock = subjects.map(s => `- ${s.nombre}`).join(', ') || '(ninguna)';

    const prompt = `Eres "AURA", asistente académico dentro de la bóveda personal de un estudiante universitario.
Responde en español, con formato markdown ligero, de forma clara, útil y concisa.
 Usa ÚNICAMENTE la información de la bóveda del estudiante que te doy abajo. Si la respuesta no está, dilo honestamente y sugiere qué nota crear.
 Si citas datos, menciona de qué nota/materia provienen.
 Puedes sugerir acciones concretas de estudio.

== MATERIAS ==
${subjBlock}

== TAREAS ==
${taskBlock}

== NOTAS (título + extracto) ==
${noteBlock}

== PREGUNTA DEL ESTUDIANTE ==
${question}`;

    return callGemini(prompt, { json: false, temperature: 0.5 });
  }

  function stripMarkdown(md) {
    return (md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_>`~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Test key/model quickly */
  async function testKey() {
    const r = await callGemini('Responde solo: OK', { temperature: 0 });
    return r.trim().slice(0, 40);
  }

  return { parseIntention, askVault, testKey, stripMarkdown };
})();
