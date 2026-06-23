/* ── Service Worker — Grupo FAMIl ─────────────────────────────────────────── */
const CACHE = 'famil-v6.1';
const SHELL = ['/app', '/style.css?v=6.1', '/app.js?v=6.1', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // API sempre pela rede
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // App shell: cache-first com ignoreSearch para query params (cache busting)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => cached || fetch(e.request))
  );
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    e.waitUntil(
      self.registration.showNotification(data.title || 'Grupo FAMIl', {
        body: data.body,
        icon: data.icon || '/icon.svg',
        badge: '/icon.svg',
        vibrate: [200, 100, 200]
      })
    );
  } catch (err) {
    console.error('Erro no push', err);
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      if (windowClients.length > 0) {
        windowClients[0].focus();
      } else {
        clients.openWindow('/app');
      }
    })
  );
});
