/* ============================================================
   AURA — settings.js (localStorage-backed preferences)
   - Tema claro/oscuro persistente
   - Accent color personalizable (San Francisco / Esmeralda /
     Violeta / Ámbar) aplicado vía data-accent en <html>
   - Credenciales Supabase (URL + anon key)
   ============================================================ */

const Settings = (() => {
  const KEY = 'aura_settings_v2';

  const DEFAULTS = {
    theme: 'dark',            // 'dark' | 'light'
    accent: 'sf',             // 'sf' | 'emerald' | 'violet' | 'amber'
    geminiKey: '',
    geminiModel: 'gemini-3.5-flash',
    notifications: false,
    userName: 'Estudiante',
    sidebarMode: 'expanded'   // 'expanded' | 'rail' | 'hidden' (solo desktop)
  };

  let cache = { ...DEFAULTS };

  function load() {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch (e) {
      cache = { ...DEFAULTS };
    }
    // Migración: IDs retirados por Google → modelo vigente (evita 404)
    const RETIRED_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro'];
    if (RETIRED_MODELS.includes(cache.geminiModel)) {
      cache.geminiModel = DEFAULTS.geminiModel;
      localStorage.setItem(KEY, JSON.stringify(cache));
    }
    // Migración v1 → v2: colorTheme viejo → accent nuevo
    if (!cache.accent || cache.accent === '') {
      try {
        const old = JSON.parse(localStorage.getItem('aura_settings_v1') || '{}');
        if (old.colorTheme === 'sapphire') cache.accent = 'sf';
        else if (old.colorTheme === 'emerald') cache.accent = 'emerald';
        else if (old.colorTheme === 'sunset') cache.accent = 'amber';
        else if (old.colorTheme === '') cache.accent = 'violet';
      } catch (e) { /* noop */ }
    }
    return cache;
  }

  function get() { return cache; }

  function patch(partial) {
    cache = { ...cache, ...partial };
    localStorage.setItem(KEY, JSON.stringify(cache));
    return cache;
  }

  function applyTheme() {
    document.documentElement.classList.toggle('light', cache.theme === 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cache.theme === 'light' ? '#f2f2f7' : '#121212');
  }

  /* ---------------- Accent color ---------------- */
  const ACCENTS = ['sf', 'emerald', 'violet', 'amber'];

  function applyAccent() {
    const a = ACCENTS.includes(cache.accent) ? cache.accent : 'sf';
    if (a === 'sf') document.documentElement.removeAttribute('data-accent');
    else document.documentElement.setAttribute('data-accent', a);
  }

  function setAccent(a) {
    cache.accent = ACCENTS.includes(a) ? a : 'sf';
    localStorage.setItem(KEY, JSON.stringify(cache));
    applyAccent();
    return cache.accent;
  }

  /* ---------------- Sidebar (desktop) ---------------- */

  function applySidebarMode() {
    const root = document.documentElement;
    root.classList.remove('side-expanded', 'side-rail', 'side-hidden');
    const mode = ['expanded', 'rail', 'hidden'].includes(cache.sidebarMode)
      ? cache.sidebarMode : 'expanded';
    root.classList.add('side-' + mode);
  }

  function cycleSidebarMode() {
    const order = ['expanded', 'rail', 'hidden'];
    const idx = order.indexOf(cache.sidebarMode);
    cache.sidebarMode = order[(idx + 1) % order.length];
    localStorage.setItem(KEY, JSON.stringify(cache));
    applySidebarMode();
    return cache.sidebarMode;
  }

  return { load, get, patch, applyTheme, applyAccent, setAccent, applySidebarMode, cycleSidebarMode };
})();
