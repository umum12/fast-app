/* sw.js — FAST APP. Hanya cache "cangkang" statis. Data selalu lewat jaringan
 * (request ke script.google.com / googleusercontent tidak pernah disentuh). */
const CACHE = 'fastapp-__BUILD_ID__';
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('fastapp-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: pembaruan selalu terambil; cache hanya cadangan saat offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
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
