/* pwa-install.js — FAST APP · tombol "Pasang Aplikasi"
 * Menangkap prompt instalasi bawaan browser (beforeinstallprompt) dan
 * menampilkannya lewat kartu #card-pasang di menu Akun (bila ada).
 * Kartu otomatis disembunyikan saat sudah terpasang / berjalan standalone.
 * iPhone/iPad tidak punya prompt native -> ditampilkan petunjuk manual.
 * Hanya dimuat di versi GitHub Pages (disisipkan build.js); di /exec tidak ada. */
(function () {
  'use strict';
  var deferred = null;

  function el(id) { return document.getElementById(id); }
  function standalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) ||
      window.navigator.standalone === true;
  }
  function ios() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function update() {
    var card = el('card-pasang'), btn = el('btn-pasang-app'), hint = el('pasang-hint');
    if (!card) return;
    if (standalone()) { card.style.display = 'none'; return; }
    if (deferred) {
      card.style.display = '';
      if (btn) btn.style.display = '';
      if (hint) hint.textContent = 'Pasang aplikasi di perangkat ini agar bisa dibuka dari layar utama, tampil layar penuh, dan menerima notifikasi.';
    } else if (ios()) {
      card.style.display = '';
      if (btn) btn.style.display = 'none';
      if (hint) hint.textContent = 'Untuk memasang di iPhone/iPad: buka menu Bagikan di Safari, pilih "Tambah ke Layar Utama", lalu buka aplikasi dari ikonnya.';
    } else {
      card.style.display = 'none';
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();      // tahan mini-infobar; tombol kita yang memicu prompt
    deferred = e;
    update();
  });
  window.addEventListener('appinstalled', function () { deferred = null; update(); });

  try {
    var mq = window.matchMedia('(display-mode: standalone)');
    if (mq.addEventListener) mq.addEventListener('change', update);
    else if (mq.addListener) mq.addListener(update);
  } catch (e) {}

  function bind() {
    var btn = el('btn-pasang-app');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', function () {
        if (!deferred) { update(); return; }
        var ev = deferred;
        deferred = null;     // prompt hanya bisa dipakai sekali
        try {
          ev.prompt();
          Promise.resolve(ev.userChoice).then(update, update);
        } catch (e) { update(); }
        update();
      });
    }
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
  window.FASTAPP_INSTALL = { refresh: bind };
})();
