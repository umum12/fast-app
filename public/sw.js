/* sw.js — FAST APP. Hanya cache "cangkang" statis. Data selalu lewat jaringan
 * (request ke script.google.com / googleusercontent tidak pernah disentuh). */
// Nama cache unik per aplikasi: memuat path scope (mis. /fast-app/), sehingga tidak
// bentrok dengan project GitHub Pages lain di domain yang sama (user.github.io).
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = 'fastapp:' + SCOPE_PATH + ':';
const CACHE = CACHE_PREFIX + '__BUILD_ID__';
const LEGACY_CACHE_RE = /^fastapp-[0-9a-f]{10}$/; // format lama versi sebelumnya
const SHELL = __SHELL__;

// Pemasangan ATOMIK: semua berkas kritis harus terunduh utuh (cache:'reload' = lewati cache HTTP
// browser, jadi tidak pernah menyimpan salinan lama dari GitHub Pages yang ber-max-age 10 menit).
// Gagal satu saja -> install ditolak, service worker lama tetap melayani (rollback otomatis).
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const fresh = (u) => new Request(u, { cache: 'reload' });
    try {
      await Promise.all(SHELL.critical.map(async (u) => {
        const res = await fetch(fresh(u));
        if (!res.ok) throw new Error('precache gagal: ' + u + ' (' + res.status + ')');
        await cache.put(u, res);
      }));
    } catch (err) {
      await caches.delete(CACHE);
      throw err;
    }
    await Promise.all(SHELL.optional.map((u) => fetch(fresh(u)).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (k.startsWith(CACHE_PREFIX) || LEGACY_CACHE_RE.test(k))).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first dengan revalidasi (cache:'no-cache' -> 304 murah bila belum berubah, sehingga tidak
// pernah tersaji salinan HTTP lama). Jaringan lambat > 4 dtk -> pakai cache sambil menunggu jaringan.
const NETWORK_TIMEOUT_MS = 4000;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;        // hanya path aplikasi ini
  if (url.pathname.endsWith('/version.json')) return;      // pemeriksaan versi selalu langsung ke jaringan
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const cached = () => caches.match(req, { ignoreSearch: true })
      .then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : null));
    const timer = setTimeout(() => {
      cached().then((r) => { if (r && !done) { done = true; resolve(r); } });
    }, NETWORK_TIMEOUT_MS);

    fetch(req, { cache: 'no-cache' }).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
        if (!done) { done = true; resolve(res); }
        return;
      }
      // Deploy bermasalah (berkas hilang / server error): pakai salinan yang pernah berhasil bila ada.
      if (res && (res.status === 404 || res.status >= 500)) {
        cached().then((r) => { if (!done) { done = true; resolve(r || res); } });
        return;
      }
      if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      if (done) return;
      cached().then((r) => { done = true; resolve(r || Response.error()); });
    });
  }));
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
    badge: 'icons/badge-96.png',
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
