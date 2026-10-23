/**
 * api-adapter.js — FAST APP
 * Meniru google.script.run di GitHub Pages: setiap pemanggilan diteruskan
 * lewat fetch() ke  <EXEC_URL>?route=api  (Apps Script doPost -> handleApiRequest_).
 * Kode UI (script-*.html) TIDAK perlu diubah.
 *
 * CORS: POST dengan Content-Type text/plain = "simple request" (tanpa preflight);
 * Apps Script membalas lewat redirect googleusercontent yang mengizinkan CORS.
 */
(function () {
  'use strict';
  var CFG = window.FASTAPP_CONFIG || {};
  var EXEC_URL = CFG.EXEC_URL || '';
  var TIMEOUT_MS = CFG.TIMEOUT_MS || 330000;
  // Permintaan baca/startup dibatasi singkat agar tidak menggantung (mis. koneksi lama mati setelah aplikasi dibuka
  // kembali di Android). Operasi tulis & PDF tetap memakai batas panjang agar tidak terputus di tengah proses.
  var SHORT_TIMEOUT_MS = 25000;
  var SHORT_FNS = { getBootstrapData: 1, loginByAccessCode: 1, getHomeBootstrap: 1, getDashboard: 1, getContentAktif: 1,
    getJadwalAktif: 1, getPekerjaanList: 1, getPekerjaanVersion: 1, getKomentarList: 1 };

  var PAGE_MAP = { stats: 'statistik.html', statistik: 'statistik.html', pdfrender: 'pdfrender.html' };
  // Alamat dasar situs ini (folder tempat halaman berada), mis. https://user.github.io/fast-app/
  var BASE_URL = new URL('./', location.href).href;
  var EXEC_RE = /^https:\/\/script\.google\.com\/macros\/(?:u\/\d+\/)?s\/[^\/]+\/(?:exec|dev)(?:\?|#|$)/;

  function callApi(fn, args) {
    return new Promise(function (resolve, reject) {
      if (!EXEC_URL || EXEC_URL.indexOf('GANTI_DENGAN') !== -1) {
        reject(new Error('EXEC_URL belum diisi di config.json.')); return;
      }
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, SHORT_FNS[fn] ? Math.min(SHORT_TIMEOUT_MS, TIMEOUT_MS) : TIMEOUT_MS) : null;

      fetch(EXEC_URL + '?route=api', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ fn: fn, args: args }),
        redirect: 'follow',
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        return res.text();
      }).then(function (text) {
        if (timer) clearTimeout(timer);
        var data;
        // webAppUrl dari server menunjuk ke /exec; di sini diarahkan ke situs ini
        // supaya tombol/tautan internal tetap berada di GitHub Pages.
        try { data = JSON.parse(text, function (k, v) { return (k === 'webAppUrl' && typeof v === 'string') ? BASE_URL : v; }); }
        catch (e) { reject(new Error('Respons server tidak valid. Pastikan Apps Script sudah di-deploy ulang (versi baru) dengan akses "Anyone".')); return; }
        resolve(data);
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        reject(new Error(err && err.name === 'AbortError'
          ? 'Server terlalu lama merespons. Coba lagi.'
          : 'Tidak dapat terhubung ke server. Periksa koneksi internet.'));
      });
    });
  }

  function makeRunner(state) {
    return new Proxy({}, {
      get: function (_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop === 'withSuccessHandler') return function (fn) { return makeRunner({ s: fn, f: state.f, u: state.u }); };
        if (prop === 'withFailureHandler') return function (fn) { return makeRunner({ s: state.s, f: fn, u: state.u }); };
        if (prop === 'withUserObject') return function (o) { return makeRunner({ s: state.s, f: state.f, u: o }); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          callApi(prop, args).then(
            function (result) { if (state.s) state.s(result, state.u); },
            function (err) {
              if (state.f) state.f(err, state.u);
              else if (window.console) console.error('[api] ' + prop + ': ' + err.message);
            }
          );
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = {
    run: makeRunner({}),
    host: { close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} } },
    history: { push: function () {}, replace: function () {}, setChangeHandler: function () {} },
    url: {
      getLocation: function (cb) {
        var p = {}, ps = {};
        new URLSearchParams(location.search).forEach(function (v, k) { p[k] = v; (ps[k] = ps[k] || []).push(v); });
        cb({ hash: location.hash.replace(/^#/, ''), parameter: p, parameters: ps });
      }
    }
  };
  window.FASTAPP_callApi = callApi; // untuk test.html

  // ---- Router halaman: index.html?page=stats -> statistik.html, dst. ----
  (function routePageParam() {
    var m = /(?:^|[?&])page=([^&#]*)/.exec(location.search);
    var target = m && PAGE_MAP[decodeURIComponent(m[1])];
    var here = location.pathname.split('/').pop() || 'index.html';
    if (!target || target === here) return;
    var rest = location.search.replace(/([?&])page=[^&#]*&?/, '$1').replace(/[?&]$/, '');
    location.replace(new URL(target + (rest && rest !== '?' ? rest : ''), location.href).href + location.hash);
  })();

  // ---- Tautan internal: ?page=... pada URL /exec -> halaman statis setara ----
  function rewrite(url) {
    try {
      if (!EXEC_RE.test(url)) return url;
      var u = new URL(url);
      var page = u.searchParams.get('page');
      var target = page ? PAGE_MAP[page] : 'index.html';
      if (!target) return url;
      u.searchParams.delete('page');
      var q = u.searchParams.toString();
      return new URL(target + (q ? '?' + q : '') + (u.hash || ''), location.href).href;
    } catch (e) { return url; }
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var r = rewrite(a.href);
    if (r !== a.href) a.setAttribute('href', r);
  }, true);
  var nativeOpen = window.open;
  window.open = function (u) {
    var rest = Array.prototype.slice.call(arguments, 1);
    return nativeOpen.apply(window, [typeof u === 'string' ? rewrite(u) : u].concat(rest));
  };
})();
