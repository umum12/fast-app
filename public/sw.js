/* sw.js — FAST APP. Hanya cache "cangkang" statis. Data selalu lewat jaringan
 * (request ke script.google.com / googleusercontent tidak pernah disentuh). */
// Nama cache unik per aplikasi: memuat path scope (mis. /fast-app/), sehingga tidak
// bentrok dengan project GitHub Pages lain di domain yang sama (user.github.io).
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = 'fastapp:' + SCOPE_PATH + ':';
const CACHE = CACHE_PREFIX + '__BUILD_ID__';
const LEGACY_CACHE_RE = /^fastapp-[0-9a-f]{10}$/; // format lama versi sebelumnya
const SHELL = __SHELL__;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (k.startsWith(CACHE_PREFIX) || LEGACY_CACHE_RE.test(k))).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: pembaruan selalu terambil; cache hanya cadangan saat offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return; // hanya path aplikasi ini
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});

// ---------------------------------------------------------------------------
// Notifikasi push (FCM Web Push). Pesan dikirim server sebagai data-only:
// { title, body, tag, url }. Service worker inilah yang menampilkannya.
// ---------------------------------------------------------------------------
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; }
  catch (err) { try { payload = { data: { body: e.data.text() } }; } catch (_) { payload = {}; } }

  // FCM membungkus: { data: {...}, notification: {...} }; toleran bila datar.
  const d = Object.assign({}, payload.notification || {}, payload.data || (payload.title || payload.body ? payload : {}));
  const title = d.title || 'Facility Support';
  const options = {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'fastapp',
    renotify: true,
    data: { url: d.url || '' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const rel = (e.notification.data && e.notification.data.url) || '';
  const target = new URL(rel, self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
