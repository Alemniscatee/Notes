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
- "materia": elige la materia MÁS PARECIDA de esta lista: [${subjList}]. Si ninguna encaja usa "General".
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
