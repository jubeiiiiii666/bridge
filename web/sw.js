// App shell cache (network first, so updates from the PC arrive immediately) + push notifications.
const CACHE = 'pocket-bridge-v1';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest',
  '/vendor/preact.mjs', '/vendor/preact-hooks.mjs', '/vendor/htm.mjs', '/vendor/marked.mjs', '/vendor/purify.mjs',
  '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/pair') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Pocket Bridge', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Pocket Bridge', {
    body: data.body || '',
    tag: data.tag,
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    icon: data.icon || '/icons/icon-192.png', // senders may pick their own icon and vibration
    badge: '/icons/badge-96.png',
    data: { url: data.url || '/' },
    vibrate: data.vibrate || (data.requireInteraction ? [120, 60, 120] : [80]),
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === location.origin) {
        await c.focus();
        c.postMessage({ t: 'navigate', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
