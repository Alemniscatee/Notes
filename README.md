# AURA Life Dashboard 🌟

PWA **100% offline-first** para la vida académica universitaria: notas con Markdown, tareas, calendario, captura por voz con IA (Gemini) y sincronización bidireccional con CouchDB.

![Dashboard](screenshots/shot-1-dashboard.png)

## ✨ Características

| Módulo | Descripción |
|---|---|
| **➕ Botón A — Ingresar** | Captura manual o por **voz** (Web Speech API). La transcripción se envía a Gemini, que devuelve JSON estricto `{tipo, materia, titulo, fecha_recordatorio, contenido}` y se guarda como tarea o nota. |
| **🧠 Botón B — Preguntar a la Bóveda** | Chat con IA que lee tus notas/tareas de PouchDB, arma el contexto y responde preguntas sobre **tus** apuntes (RAG ligero). También acepta dictado por voz. |
| **📅 Calendario** | Vista mensual/semanal con puntos de colores por materia, panel de agenda del día y creación rápida. |
| **✅ Tareas** | Filtro por estado y materia, badge de pendientes, vencidas en rojo, completar/editar/eliminar. |
| **🗒️ Notas** | Editor Markdown con vista previa, **wikilinks** `[[Nota/Materia]]` clicables, imágenes guardadas como adjuntos en PouchDB, búsqueda y filtro por materia. |
| **⏱️ Línea de Tiempo** | Modal con selector de fecha: muestra las notas creadas/editadas ese día. Si no hay ninguna, despliega automáticamente las **5 más cercanas** cronológicamente con insignia "A X días de distancia". |
| **🏠 Vida Cotidiana** | Categoría fija para notas personales (listas, ideas, diario) sin materia universitaria, con etiqueta visual distintiva en cyan/neutro. |
| **🔔 Notificaciones** | Notification API + Service Worker: aviso 30 min antes del vencimiento (y al vencer), sin duplicados. |
| **☁️ Sync CouchDB** | `PouchDB.sync()` bidireccional en vivo con `retry`; configurable desde ⚙️ Ajustes, con indicador de estado en el header. |
| **🧭 Navegación** | **Panel lateral principal**: drawer con scrim en móvil (botón ☰) y sidebar fija en PC (≥1100px) con **3 modos persistentes**: expandida → compacta (solo iconos) → oculta (asoma al acercar el cursor al borde izquierdo). Badges de pendientes. **Botones de retroceso** con historial en cada vista. |
| **🪟 Liquid Glass** | Estilo Apple: superficies translúcidas con `backdrop-filter: blur + saturate`, brillo diagonal interno, **reflejo especular que sigue el cursor** sobre tarjetas y botones, modales con desensfoque progresivo, transiciones de vista con blur/scale y entradas escalonadas (stagger). |
| **🎨 Estética** | Dark/Light mode, glassmorphism (`backdrop-filter`), orbes ambientales animados, micro-interacciones, ripple y responsive móvil/desktop. |

## 🚀 Ejecución local (puerto 8080)

Necesitas servir por HTTP (el Service Worker no funciona con `file://`). Elige una:

```bash
# Opción 1 — Python (abre el navegador solo)
python serve.py

# Opción 2 — Node sin dependencias
node serve.js

# Opción 3 — npm (http-server)
npm install && npm start        # http-server -p 8080

# Opción 4 — directos
npx http-server -p 8080
python -m http.server 8080

# Opción 5 — VS Code → Live Server
```

Abre `http://localhost:8080` — verás el botón de instalación en el header (o instálala desde el menú del navegador → "Instalar app"). Todas las rutas de `manifest.json` y `sw.js` son relativas (`./`), así que funcionan igual en `localhost:8080`, un subdirectorio o producción.

## ⚙️ Configuración

En **⚙️ Ajustes**:

1. **Gemini API Key** → consíguela gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Se guarda solo en tu dispositivo (localStorage). Elige modelo (`gemini-1.5-flash` por defecto, hasta `gemini-2.5-flash`) y prueba la conexión.
2. **CouchDB URL** → ej. `http://admin:pass@192.168.1.50:5984/aura`. Botones *Probar / Sincronizar / Detener*. Todo funciona sin esto: la sync es opcional.

### Desplegar CouchDB rápido (opcional)

```bash
docker run -d --name couchdb \
  -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=tu_pass \
  -p 5984:5984 -v couchdb_data:/opt/couchdb/data \
  couchdb:3
# Crear la BD: curl -X PUT http://admin:tu_pass@localhost:5984/aura
```

> ⚠️ **CORS**: para sync desde el navegador, habilita CORS en CouchDB (Fauxton → Settings → CORS → *All domains* o tu origen exacto).

## 📦 Despliegue (HTTPS requerido para instalarse)

Sube la carpeta completa a **Netlify / Vercel / GitHub Pages / Cloudflare Pages** — no necesita build. Con HTTPS, el manifest + SW activan el prompt de instalación en móvil y PC.

## 🗂️ Arquitectura

```
index.html          Shell + vistas + modales
manifest.json       PWA instalable (iconos, shortcuts)
sw.js               Offline-first: precache shell, CDN cache-first, APIs network-only
css/                base (tokens/temas) · components · layout · views · app
js/
  settings.js       Preferencias (localStorage) + tema
  db.js             PouchDB + índices + sync bidireccional live/retry
  store.js          CRUD tareas/notas/materias + adjuntos (blobs)
  gemini.js         Cliente REST Gemini: parseIntention + askVault
  ui.js             Toasts, modales, markdown+wikilinks, fechas, colores
  calendar.js       Calendario mes/semana + agenda del día
  editor.js         Editor de notas (Markdown, [[links]], imágenes)
  capture.js        Botón A: manual + voz → Gemini → guardado
  vault.js          Botón B: chat RAG sobre tu bóveda
  timeline.js       Línea de tiempo: notas por día + 5 más cercanas
  notifications.js  Recordatorios (30 min antes)
  app.js            Router, dashboard, tareas, notas, materias, ajustes, install
serve.py / serve.js  Servidores locales en puerto 8080
```

## 🔒 Privacidad

Tus datos viven **en tu dispositivo** (IndexedDB vía PouchDB). Solo se envía a Gemini: el texto que dictas/escribes para parsear, o los extractos de tus notas al preguntar a la Bóveda. La clave nunca sale del navegador excepto hacia la API de Google.

## 🧪 Verificado

Smoke tests end-to-end vía Chrome DevTools Protocol: carga de módulos, CRUD en PouchDB, calendario, semana, tareas con badge, notas, editor, modal de captura, markdown + wikilinks, manejo sin API key, filtro/editor con VIDA_COTIDIANA, timeline (día exacto + fallback de 5 cercanas con insignia) y dictado rápido con auto-escucha. Capturas en `screenshots/`.
