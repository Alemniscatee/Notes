/* ============================================================
   AURA Life Dashboard — Service Worker
   Offline-first: precache del shell + estrategias runtime:
   - CDN libs: cache-first (son inmutables por versión)
   - Gemini/API: network-only (no cacheamos respuestas privadas)
   ============================================================ */

const VERSION = 'aura-v2.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const CDN_CACHE = `${VERSION}-cdn`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/views.css',
  './css/app.css',
  './js/db.js',
  './js/store.js',
  './js/settings.js',
  './js/gemini.js',
  './js/ui.js',
  './js/calendar.js',
  './js/editor.js',
  './js/capture.js',
  './js/vault.js',
  './js/timeline.js',
  './js/timetable.js',
  './js/notifications.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/pouchdb@9.0.0/dist/pouchdb.min.js',
  'https://cdn.jsdelivr.net/npm/pouchdb@9.0.0/dist/pouchdb.find.min.js',
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
  'https://fonts.gstatic.com/s/plusjakartasans/v8/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_qU79TAI.woff2',
  'https://fonts.gstatic.com/s/materialsymbolsoutlined/v208/kJF1BvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzByHX9rA6RzaxHMPdY43zj-jCxv3fzvRNU22ZXGJpEpjC_1v-p_4MrImHCIJIZrDCvHOej.woff2'
];

/* ---------- Install: precache shell ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Cache individually so one failure doesn't abort the whole install
    await Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url)));
    // CDN warm-up is best-effort; the fetch handler will cache on first use
    const cdn = await caches.open(CDN_CACHE);
    await Promise.allSettled(CDN_ASSETS.map(url =>
      fetch(url, { mode: 'no-cors' }).then(res => cdn.put(url, res.clone())).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

/* ---------- Activate: purge old versions ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* ---------- Fetch strategies ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept Gemini or remote DB traffic (private, dynamic, CORS-heavy)
  if (/generativelanguage\.googleapis\.com$/i.test(url.hostname)) return;
  if (url.pathname.includes('/_remote_')) return;

  // App shell: network-first, fall back to cache (and notify clients to reload on update)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('<h1>AURA offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Same-origin static: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })());
    return;
  }

  // Cross-origin (CDN/fonts): cache-first, they are versioned & immutable
  event.respondWith((async () => {
    const cache = await caches.open(CDN_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});

/* ---------- Push-style local notifications from the page ---------- */
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = data.payload;
    self.registration.showNotification(title, options);
  }
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        client.postMessage({ type: 'NOTIFICATION_CLICK', action: event.notification.tag });
        return client.focus();
      }
    }
    return self.clients.openWindow('./index.html');
  })());
});
