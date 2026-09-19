/* ============================================================
   AURA — settings.js (localStorage-backed preferences)
   ============================================================ */

const Settings = (() => {
  const KEY = 'aura_settings_v1';

  const DEFAULTS = {
    theme: 'dark',            // 'dark' | 'light'
    colorTheme: '',           // '' (Aura Violeta) | 'emerald' | 'sunset' | 'sapphire'
    geminiKey: '',
    geminiModel: 'gemini-3.5-flash',
    couchURL: '',
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
    if (meta) meta.setAttribute('content', cache.theme === 'light' ? '#f8fafc' : (PALETTE_BG[cache.colorTheme] || '#0d0d11'));
  }

  /* Paletas de color Liquid Glass / Neón (ver css/base.css: [data-theme])
     '' = Aura Violeta (predeterminado). Persistencia vía Settings.patch → localStorage. */
  const THEMES = ['', 'emerald', 'sunset', 'sapphire'];
  const PALETTE_BG = { emerald: '#050d0a', sunset: '#120c07', sapphire: '#060b13' };

  /* Aplica el atributo data-theme en <html> + tinte del theme-color de la PWA */
  function applyColorTheme() {
    const t = THEMES.includes(cache.colorTheme) ? cache.colorTheme : '';
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    applyTheme();
  }

  function setColorTheme(t) {
    cache.colorTheme = THEMES.includes(t) ? t : '';
    localStorage.setItem(KEY, JSON.stringify(cache));
    applyColorTheme();
    return cache.colorTheme;
  }

  /* Modo de sidebar en desktop: expanded | rail | hidden */
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

  return { load, get, patch, applyTheme, applyColorTheme, setColorTheme, applySidebarMode, cycleSidebarMode };
})();
