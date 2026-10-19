/* pwa-update.js — FAST APP · Update Manager (ringan)
 *
 * - Memeriksa versi baru: saat aplikasi dibuka, saat kembali terlihat (maks. sekali / 30 menit),
 *   dan lewat tombol "Periksa Pembaruan" (menu Akun → Tentang Aplikasi, bila ada).
 * - Pembanding: window.FASTAPP_BUILD (versi yang SEDANG berjalan, dari config.js) melawan
 *   version.json di server (selalu no-store). Service worker diminta memeriksa juga (reg.update()).
 * - Bila ada versi baru: banner "Pembaruan tersedia" [Perbarui Sekarang] [Nanti].
 *   Reload HANYA terjadi setelah pengguna menekan tombol — tidak pernah otomatis (formulir aman).
 * - Pemulihan ("mode aman"): bila halaman tidak pernah tampil 2x berturut-turut (layar putih),
 *   cache milik aplikasi ini dihapus lalu dimuat ulang satu kali. Service worker TIDAK
 *   di-unregister agar langganan notifikasi push tidak hilang.
 * Hanya dimuat di versi GitHub Pages (disisipkan build.js).
 */
(function () {
  'use strict';
  var RUNNING = window.FASTAPP_BUILD || null;
  var CHECK_EVERY_MS = 30 * 60 * 1000;
  var SNOOZE_MS = 30 * 60 * 1000;
  var BOOT_WAIT_MS = 12000;
  var K_LAST = 'fs_upd_last', K_SNOOZE = 'fs_upd_snooze', K_BOOTFAIL = 'fs_boot_fail', K_RECOVER = 'fs_boot_recover';
  var S_RELOAD = 'fs_upd_reload';

  var state = 'idle';        // idle | checking | latest | available | offline | error
  var remote = null;         // {id, at} versi di server
  var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  var reloading = false;
  var banner = null;

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function ss(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function el(id) { return document.getElementById(id); }
  function now() { return Date.now(); }

  function fmtAt(iso) {
    try {
      return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso || ''; }
  }

  // ------------------------------------------------------------------ tampilan
  function renderUi(message, tone) {
    var box = el('app-update-box');
    if (!box) return;
    box.style.display = '';
    var lbl = el('app-build-label');
    if (lbl) lbl.textContent = RUNNING ? (RUNNING.id + ' · ' + fmtAt(RUNNING.at)) : '—';
    var st = el('app-update-status');
    if (st) {
      st.textContent = message || '';
      st.style.color = tone === 'ok' ? '#15803d' : tone === 'warn' ? '#b45309' : '';
    }
    var btn = el('btn-check-update');
    if (btn) {
      btn.disabled = state === 'checking';
      var btnText = state === 'available' ? 'Perbarui Sekarang' : (state === 'checking' ? 'Memeriksa...' : 'Periksa Pembaruan');
      var btnLbl = el('btn-check-update-label');
      if (btnLbl) btnLbl.textContent = btnText; else btn.textContent = btnText;
    }
  }

  function showBanner() {
    if (banner || reloading) return;
    var snooze = parseInt(ls(K_SNOOZE) || '0', 10);
    if (snooze && now() < snooze) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:2147483000;' +
      'max-width:480px;margin:0 auto;background:#1F4E9C;color:#fff;border-radius:14px;padding:12px 14px;' +
      'box-shadow:0 8px 24px rgba(15,23,42,.28);font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    banner.innerHTML = '<span style="flex:1;min-width:160px;">Pembaruan aplikasi tersedia.</span>' +
      '<button type="button" id="fs-upd-later" style="background:transparent;border:1px solid rgba(255,255,255,.55);color:#fff;border-radius:999px;padding:8px 14px;font:inherit;cursor:pointer;">Nanti</button>' +
      '<button type="button" id="fs-upd-now" style="background:#fff;border:0;color:#1F4E9C;border-radius:999px;padding:8px 14px;font:inherit;font-weight:800;cursor:pointer;">Perbarui Sekarang</button>';
    document.body.appendChild(banner);
    banner.querySelector('#fs-upd-now').addEventListener('click', apply);
    banner.querySelector('#fs-upd-later').addEventListener('click', function () {
      ls(K_SNOOZE, String(now() + SNOOZE_MS));
      hideBanner();
    });
  }
  function hideBanner() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; }

  function setState(next, message, tone) {
    state = next;
    if (next === 'available') {
      renderUi('Pembaruan tersedia' + (remote && remote.at ? ' (dibuat ' + fmtAt(remote.at) + ')' : '') + '.', 'warn');
      showBanner();
    } else {
      renderUi(message, tone);
      if (next !== 'checking') hideBanner();
    }
  }

  // --------------------------------------------------------------- pemeriksaan
  function check(manual) {
    if (state === 'checking' || reloading) return Promise.resolve(state);
    if (!manual && state === 'available') return Promise.resolve(state);
    var prev = state;
    setState('checking', 'Memeriksa pembaruan...');
    ls(K_LAST, String(now()));

    var url = new URL('version.json', location.href).href + '?t=' + now();
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (v) {
      remote = v;
      // Minta browser memeriksa service worker juga (tanpa menunggu navigasi).
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); }).catch(function () {});
      }
      if (v && v.id && RUNNING && v.id !== RUNNING.id) {
        setState('available');
      } else {
        setState('latest', manual ? 'Sudah versi terbaru.' : '', 'ok');
      }
      return state;
    }).catch(function () {
      if (prev === 'available') { setState('available'); return state; }
      var offline = (navigator.onLine === false);
      setState(offline ? 'offline' : 'error',
        manual ? (offline ? 'Tidak bisa memeriksa: sedang offline.' : 'Gagal memeriksa pembaruan. Coba lagi nanti.') : '', 'warn');
      return state;
    });
  }

  // ------------------------------------------------------------------- terapkan
  function apply() {
    if (reloading) return;
    // Pengaman loop: jangan reload lagi bila baru saja reload karena pembaruan (<20 dtk).
    var last = parseInt(ss(S_RELOAD) || '0', 10);
    if (last && now() - last < 20000) {
      renderUi('Pembaruan sedang diterapkan. Jika tampilan belum berubah, tutup lalu buka kembali aplikasi.', 'warn');
      hideBanner();
      return;
    }
    reloading = true;
    hideBanner();
    renderUi('Menerapkan pembaruan...');
    var btn = el('btn-check-update'); if (btn) btn.disabled = true;

    var finish = function () { ss(S_RELOAD, String(now())); location.reload(); };
    var timer = setTimeout(finish, 2500);   // jangan menunggu selamanya
    var go = function () { clearTimeout(timer); finish(); };

    if (!navigator.serviceWorker) { go(); return; }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { go(); return; }
      navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
      if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); return; }
      reg.update().then(function () {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else if (!reg.installing) go();      // tidak ada SW baru -> cukup muat ulang (network-first)
      }).catch(go);
    }).catch(go);
  }

  // Service worker baru mengambil alih saat halaman lama masih terbuka -> tandai ada pembaruan.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) { hadController = true; return; }
      remote = remote || null;
      setState('available');
    });
  }

  // -------------------------------------------------------------- pemicu otomatis
  function maybeAutoCheck() {
    var last = parseInt(ls(K_LAST) || '0', 10);
    if (!last || now() - last > CHECK_EVERY_MS) check(false);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') maybeAutoCheck();
  });

  // --------------------------------------------------------------- mode aman
  var sawError = false;
  window.addEventListener('error', function () { sawError = true; });
  window.addEventListener('unhandledrejection', function () { sawError = true; });

  function screens() { return Array.prototype.slice.call(document.querySelectorAll('[id^="screen-"]')); }
  function pageShown() {
    return screens().some(function (n) { var cs = window.getComputedStyle(n); return cs.display !== 'none' && cs.visibility !== 'hidden'; });
  }
  function pageBroken() {
    if (!screens().length) return true;           // markup tidak lengkap (mis. scriptlet mentah) -> rusak
    return sawError && !pageShown();              // ada error JS dan tidak ada layar yang tampil
  }
  function ownCacheKeys(keys) {
    var path = new URL('./', location.href).pathname;
    return keys.filter(function (k) { return k.indexOf('fastapp:' + path + ':') === 0 || /^fastapp-[0-9a-f]{10}$/.test(k); });
  }
  function recover() {
    var lastRec = parseInt(ls(K_RECOVER) || '0', 10);
    if (lastRec && now() - lastRec < 10 * 60 * 1000) { showRecoveryHelp(); return; }   // sekali per 10 menit
    ls(K_RECOVER, String(now()));
    var done = function () { ls(K_BOOTFAIL, null); location.reload(); };
    var p = window.caches ? caches.keys().then(function (keys) { return Promise.all(ownCacheKeys(keys).map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
    p.catch(function () {}).then(function () {
      if (navigator.serviceWorker) return navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {});
    }).then(done, done);
  }
  function showRecoveryHelp() {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:480px;margin:0 auto;background:#fff;color:#111827;border:1px solid #fecaca;border-radius:14px;padding:14px;font:14px -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.2);';
    d.innerHTML = 'Aplikasi belum dapat dimuat. Coba tutup lalu buka kembali, atau buka <a href="test.html" style="color:#1F4E9C;font-weight:700;">halaman pemulihan</a>.';
    (document.body || document.documentElement).appendChild(d);
  }
  function watchdog() {
    var t0 = now();
    (function tick() {
      if (pageShown() && !pageBroken()) { ls(K_BOOTFAIL, null); return; }
      if (now() - t0 < BOOT_WAIT_MS && screens().length) { setTimeout(tick, 1000); return; }
      if (!pageBroken()) return;                  // lambat tapi tidak rusak (mis. server Apps Script dingin)
      var n = 0;
      try { var o = JSON.parse(ls(K_BOOTFAIL) || 'null'); if (o && now() - o.ts < 10 * 60 * 1000) n = o.n; } catch (e) {}
      n++;
      ls(K_BOOTFAIL, JSON.stringify({ n: n, ts: now() }));
      if (n >= 2) recover();
    })();
  }

  // -------------------------------------------------------------------- mulai
  function bind() {
    var btn = el('btn-check-update');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', function () { if (state === 'available') apply(); else check(true); });
    }
    renderUi(state === 'available' ? 'Pembaruan tersedia.' : '', state === 'available' ? 'warn' : '');
  }
  function start() {
    bind();
    setTimeout(function () { check(false); }, 3000);
    watchdog();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.FASTAPP_UPDATE = { check: check, apply: apply, get state() { return state; } };
})();
