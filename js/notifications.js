/* ============================================================
   AURA — notifications.js
   Notification API + Service Worker: recordatorios de tareas
   próximas a vencer (30 min antes). Sin duplicados por sesión.
   Depende de: Store, Settings, UI.
   ============================================================ */

const Notify = (() => {
  const CHECK_INTERVAL = 60 * 1000;   // cada minuto
  const LEAD_TIME = 30 * 60 * 1000;   // 30 min antes
  const notified = new Set();

  function supported() {
    return 'Notification' in window;
  }

  async function requestPermission() {
    if (!supported()) {
      UI.toast('Este navegador no soporta notificaciones', 'err');
      return false;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      UI.toast('Permiso de notificaciones denegado', 'err');
      return false;
    }
    return true;
  }

  function show(title, body, tag) {
    const options = {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag,
      renotify: true,
      data: { url: './index.html' }
    };
    // Prefer SW so notifications work even if the tab is backgrounded
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        payload: { title, options }
      });
    } else if (supported() && Notification.permission === 'granted') {
      try { new Notification(title, options); } catch (e) { /* noop */ }
    }
  }

  async function checkTasks() {
    if (!(Settings.get().notifications || false)) return;
    if (!supported() || Notification.permission !== 'granted') return;

    const tasks = await Store.getTasks();
    const now = Date.now();

    for (const t of tasks) {
      if (t.hecho || !t.vence) continue;
      const due = new Date(t.vence).getTime();
      if (isNaN(due)) continue;
      const timeLeft = due - now;

      // Por vencer (dentro de la ventana de 30 min)
      if (timeLeft > 0 && timeLeft <= LEAD_TIME && !notified.has(t._id + ':due')) {
        notified.add(t._id + ':due');
        show('⏰ Tarea próxima a vencer',
          `${t.titulo} — vence ${UI.relTime(t.vence)}`,
          `task-${t._id}`);
      }
      // Recién vencida (grace de 5 min)
      if (timeLeft <= 0 && timeLeft > -5 * 60000 && !notified.has(t._id + ':over')) {
        notified.add(t._id + ':over');
        show('🔔 Tarea vencida', `${t.titulo} — ¡revisa tu agenda!`, `task-${t._id}`);
      }
    }
  }

  function start() {
    setInterval(checkTasks, CHECK_INTERVAL);
    setTimeout(checkTasks, 4000);
    // Re-chequear al volver a la pestaña
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkTasks();
    });
  }

  function onNotificationClickFocus() {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'NOTIFICATION_CLICK') {
          window.focus();
          App.showView('tasks');
        }
      });
    }
  }

  return { requestPermission, checkTasks, start, onNotificationClickFocus, supported };
})();
