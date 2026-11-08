/* pwa-update.js — FAST APP · Update Manager (ringan)
 *
 * - Memeriksa versi baru: saat aplikasi dibuka, saat kembali terlihat (maks. sekali / 30 menit),
 *   dan lewat tombol "Periksa Pembaruan" (menu Akun → Tentang Aplikasi, bila ada).
 * - Pembanding: window.FASTAPP_BUILD (versi yang SEDANG berjalan, dari config.js) melawan
 *   version.json di server (selalu no-store). Service worker diminta memeriksa juga (reg.update()).
 * - Bila ada versi baru: dialog di tengah layar (latar buram, aksen garis gradien, badge) dengan
 *   tombol besar "Perbarui Sekarang" dan tautan kecil "Nanti saja".
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
      btn.style.display = '';
      btn.disabled = state === 'checking';
      var btnText = state === 'available' ? 'Perbarui Sekarang' : (state === 'checking' ? 'Memeriksa...' : 'Periksa Pembaruan');
      var btnLbl = el('btn-check-update-label');
      if (btnLbl) btnLbl.textContent = btnText; else btn.textContent = btnText;
    }
  }

  var UPD_CSS = [
    '#fs-upd-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}',
    '#fs-upd-bg{position:absolute;inset:0;background:rgba(2,6,23,.65);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:fsUpdFade .3s ease-out both}',
    '#fs-upd-card{position:relative;width:100%;max-width:384px;box-sizing:border-box;background:rgba(255,255,255,.97);color:#0f172a;border:1px solid rgba(255,255,255,.8);border-radius:32px;padding:30px 24px 22px;text-align:center;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.45);animation:fsUpdIn .35s cubic-bezier(.16,1,.3,1) both}',
    '#fs-upd-wrap.out #fs-upd-card{animation:fsUpdOut .25s cubic-bezier(.7,0,.84,0) both}#fs-upd-wrap.out #fs-upd-bg{animation:fsUpdFadeOut .25s ease-in both}',
    '#fs-upd-bar{position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,#1648A0 0%,#1648A0 35%,#8DC63F 70%,#E31E24 100%)}',
    '#fs-upd-icon{position:relative;width:76px;height:76px;margin:6px auto 16px;display:flex;align-items:center;justify-content:center}',
    '#fs-upd-glow{position:absolute;inset:0;border-radius:50%;background:#8DC63F;filter:blur(18px);animation:fsUpdPulse 2.5s ease-in-out infinite}',
    '#fs-upd-ico{position:relative;width:76px;height:76px;border-radius:24px;background:linear-gradient(135deg,#1648A0,#0F3478);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 24px rgba(22,72,160,.32)}',
    '#fs-upd-ico svg{animation:fsUpdBounce 1.8s ease-in-out infinite}',
    '#fs-upd-badge{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;background:rgba(236,252,203,.75);border:1px solid rgba(141,198,63,.45);color:#1e293b;font-size:12px;font-weight:700;margin-bottom:12px}',
    '#fs-upd-dot{position:relative;width:8px;height:8px;border-radius:50%;background:#E31E24;display:inline-block}',
    '#fs-upd-dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:#E31E24;animation:fsUpdPing 1.4s cubic-bezier(0,0,.2,1) infinite}',
    '#fs-upd-title{margin:0 0 8px;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-.01em;color:#0f172a}',
    '#fs-upd-desc{margin:0 0 22px;font-size:13.5px;line-height:1.55;color:#64748b}',
    '#fs-upd-now{width:100%;min-height:54px;border:0;border-radius:18px;background:#1648A0;color:#fff;font:inherit;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 10px 22px rgba(22,72,160,.32);transition:transform .15s,background .15s}',
    '#fs-upd-card:focus{outline:none}#fs-upd-now:focus-visible{outline:3px solid #8DC63F;outline-offset:2px}#fs-upd-now:active{transform:scale(.98);background:#0F3478}#fs-upd-now:disabled{opacity:.85;cursor:default}',
    '#fs-upd-now svg{flex:none}#fs-upd-spin{width:20px;height:20px;border-radius:50%;border:3px solid rgba(255,255,255,.35);border-top-color:#8DC63F;animation:fsUpdSpin .8s linear infinite;display:none}',
    '#fs-upd-later{display:inline-block;margin-top:10px;padding:8px 14px;background:transparent;border:0;border-radius:10px;color:#94a3b8;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}',
    '#fs-upd-later:active{background:#f1f5f9;color:#64748b}',
    'html[data-theme="dark"] #fs-upd-card{background:rgba(21,28,45,.97);color:#e6ebf5;border-color:rgba(255,255,255,.08)}',
    'html[data-theme="dark"] #fs-upd-title{color:#f1f5f9}html[data-theme="dark"] #fs-upd-desc{color:#9aa6bd}',
    'html[data-theme="dark"] #fs-upd-badge{background:rgba(141,198,63,.14);border-color:rgba(141,198,63,.35);color:#dbe8c4}',
    'html[data-theme="dark"] #fs-upd-later{color:#7c88a1}html[data-theme="dark"] #fs-upd-later:active{background:rgba(255,255,255,.06)}',
    '@keyframes fsUpdIn{from{opacity:0;transform:scale(.9) translateY(12px)}to{opacity:1;transform:none}}',
    '@keyframes fsUpdOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(.92) translateY(8px)}}',
    '@keyframes fsUpdFade{from{opacity:0}to{opacity:1}}@keyframes fsUpdFadeOut{from{opacity:1}to{opacity:0}}',
    '@keyframes fsUpdPulse{0%,100%{transform:scale(1);opacity:.25}50%{transform:scale(1.2);opacity:.5}}',
    '@keyframes fsUpdBounce{0%,100%{transform:translateY(-12%)}50%{transform:translateY(8%)}}',
    '@keyframes fsUpdPing{75%,100%{transform:scale(2.4);opacity:0}}@keyframes fsUpdSpin{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){#fs-upd-card,#fs-upd-bg,#fs-upd-glow,#fs-upd-ico svg,#fs-upd-dot::after{animation:none!important}}'
  ].join('');
  var ICON_SVG = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#8DC63F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/></svg>';
  var ARROW_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8DC63F" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

  function snooze() { ls(K_SNOOZE, String(now() + SNOOZE_MS)); hideBanner(true); }

  function showBanner() {
    if (banner || reloading) return;
    var sn = parseInt(ls(K_SNOOZE) || '0', 10);
    if (sn && now() < sn) return;
    if (!el('fs-upd-style')) {
      var st = document.createElement('style'); st.id = 'fs-upd-style'; st.textContent = UPD_CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    var ver = (remote && remote.id) ? String(remote.id).slice(0, 7) : '';
    banner = document.createElement('div');
    banner.id = 'fs-upd-wrap';
    banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-modal', 'true'); banner.setAttribute('aria-labelledby', 'fs-upd-title');
    banner.innerHTML =
      '<div id="fs-upd-bg"></div>' +
      '<div id="fs-upd-card">' +
        '<div id="fs-upd-bar"></div>' +
        '<div id="fs-upd-icon"><div id="fs-upd-glow"></div><div id="fs-upd-ico">' + ICON_SVG + '</div></div>' +
        '<div id="fs-upd-badge"><span id="fs-upd-dot"></span><span>Pembaruan Tersedia' + (ver ? ' &middot; ' + ver : '') + '</span></div>' +
        '<h3 id="fs-upd-title">Pembaruan Aplikasi Tersedia</h3>' +
        '<p id="fs-upd-desc">Perbarui untuk mendapatkan peningkatan stabilitas dan fitur terbaru Facility Support. Data yang belum disimpan sebaiknya disimpan dulu.</p>' +
        '<button type="button" id="fs-upd-now"><span id="fs-upd-spin"></span><span id="fs-upd-label">Perbarui Sekarang</span><span id="fs-upd-arrow">' + ARROW_SVG + '</span></button>' +
        '<button type="button" id="fs-upd-later">Nanti saja</button>' +
      '</div>';
    document.body.appendChild(banner);
    banner.querySelector('#fs-upd-now').addEventListener('click', apply);
    banner.querySelector('#fs-upd-later').addEventListener('click', snooze);
    banner.querySelector('#fs-upd-bg').addEventListener('click', function () { if (!reloading) snooze(); });
    try { var cd = banner.querySelector('#fs-upd-card'); cd.tabIndex = -1; cd.focus({ preventScroll: true }); } catch (e) {}
  }
  function hideBanner(animate) {
    var b = banner; banner = null;
    if (!b || !b.parentNode) return;
    if (animate) { b.classList.add('out'); setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 240); }
    else b.parentNode.removeChild(b);
  }
  // Dipakai tombol Back aplikasi: menutup dialog (sama dengan "Nanti saja"). true bila ada yang ditutup.
  function dismiss() { if (!banner || reloading) return false; snooze(); return true; }
  function setBannerBusy() {
    if (!banner) return;
    var n = banner.querySelector('#fs-upd-now'); if (n) n.disabled = true;
    var sp = banner.querySelector('#fs-upd-spin'); if (sp) sp.style.display = 'block';
    var ar = banner.querySelector('#fs-upd-arrow'); if (ar) ar.style.display = 'none';
    var lb = banner.querySelector('#fs-upd-label'); if (lb) lb.textContent = 'Menerapkan Pembaruan...';
    var lt = banner.querySelector('#fs-upd-later'); if (lt) lt.style.display = 'none';
  }

  function setState(next, message, tone) {
    state = next;
    if (next === 'available') {
      renderUi('Pembaruan tersedia' + (remote && remote.at ? ' (dibuat ' + fmtAt(remote.at) + ')' : '') + '.', 'warn');
      showBanner();
    } else {
      renderUi(message, tone);
      if (next !== 'checking') hideBanner(false);
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
      hideBanner(true);
      return;
    }
    reloading = true;
    setBannerBusy();
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

  window.FASTAPP_UPDATE = { check: check, apply: apply, dismiss: dismiss, get state() { return state; } };
})();
