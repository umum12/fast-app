#!/usr/bin/env node
/**
 * build.js — FAST APP · Build frontend statis dari partial Apps Script.
 *
 * Sumber kebenaran UI = file .html di editor Apps Script. Salinannya ada di
 * folder source/. Skrip ini:
 *   1. meresolusi  <?!= include('nama') ?>  -> isi source/nama.html
 *   2. menyuntik tag PWA + config.js + api-adapter.js ke <head>
 *   3. menyalin public/ (adapter, manifest, sw, ikon, test.html) ke dist/
 *
 * Pakai:  node build.js            -> dist/
 *         node build.js --out docs -> docs/   (jika Pages dari folder /docs)
 *         EXEC_URL=... node build.js  (menimpa config.json)
 * Tanpa dependensi npm.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT = path.resolve(ROOT, outArg >= 0 ? argv[outArg + 1] : 'dist');
const SRC = path.join(ROOT, 'source');
const PUBLIC = path.join(ROOT, 'public');

// Halaman: template Apps Script -> file statis (mengikuti routing doGet).
const PAGES = [
  { src: 'index',      out: 'index.html',     title: 'Facility Support', manifest: 'manifest.json', required: true },
  { src: 'statistik',  out: 'statistik.html', title: 'Statistik Laporan - Facility Support', manifest: 'manifest.json' },
  { src: 'buat-cepat', out: 'buat.html',      title: 'Buat Laporan - Facility Support', manifest: 'manifest-buat.json' },
  { src: 'pdfrender',  out: 'pdfrender.html', title: 'PDF - Facility Support', manifest: 'manifest.json' }
];

const INCLUDE_RE = /<\?!?=\s*include\(\s*(['"])([^'"]+)\1\s*\)\s*;?\s*\?>/g;
const ANY_SCRIPTLET_RE = /<\?[\s\S]*?\?>/;
const THEME = '#1F4E9C';

function fail(msg) { console.error('\n[BUILD GAGAL] ' + msg + '\n'); process.exit(1); }
function warn(msg) { console.warn('[peringatan] ' + msg); }
function readSource(name) {
  const f = path.join(SRC, name + '.html');
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8');
}

function resolveIncludes(html, from, stack) {
  return html.replace(INCLUDE_RE, (m, q, name) => {
    if (stack.includes(name)) fail('include melingkar: ' + stack.concat(name).join(' -> '));
    if (stack.length > 8) fail('include terlalu dalam di ' + from);
    const inner = readSource(name);
    if (inner === null) fail("source/" + name + ".html tidak ditemukan (di-include dari " + from + ").");
    return resolveIncludes(inner, name, stack.concat(name));
  });
}

// Scriptlet Apps Script yang diketahui, diganti padanan statisnya.
function replaceKnownScriptlets(html, execUrl) {
  // buat-cepat.html: manifest dinamis dari /exec -> manifest statis di situs ini.
  html = html.replace(/<link\s+rel=["']manifest["']\s+href=["']<\?!?=\s*WEBAPP_EXEC_URL\s*\?>\?page=manifest-buat["']\s*>/g,
    '<link rel="manifest" href="manifest-buat.json">');
  // Sisa pemakaian WEBAPP_EXEC_URL (jika ada) -> URL /exec dari config.
  html = html.replace(/<\?!?=\s*WEBAPP_EXEC_URL\s*\?>/g, execUrl);
  return html;
}

function inject(html, page, execUrlOk) {
  const head = [];
  if (!/<meta[^>]+charset/i.test(html)) head.push('<meta charset="utf-8">');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    head.push('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">');
  }
  if (!/<title[\s>]/i.test(html)) head.push('<title>' + page.title + '</title>');
  if (!/<link[^>]+rel=["']manifest["']/i.test(html)) head.push('<link rel="manifest" href="' + page.manifest + '">');
  if (!/name=["']theme-color["']/i.test(html)) head.push('<meta name="theme-color" content="' + THEME + '">');
  head.push('<meta name="mobile-web-app-capable" content="yes">');
  head.push('<meta name="apple-mobile-web-app-capable" content="yes">');
  head.push('<link rel="icon" type="image/png" href="icons/icon-192.png">');
  head.push('<link rel="apple-touch-icon" href="icons/icon-192.png">');
  // Adapter HARUS dimuat sebelum script aplikasi (mendefinisikan google.script.run).
  head.push('<script src="config.js"></script>');
  head.push('<script src="api-adapter.js"></script>');
  head.push("<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}</script>");
  const block = '\n' + head.join('\n') + '\n';

  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + block);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + block + '</head>');
  return '<!DOCTYPE html><html><head>' + block + '</head><body>' + html + '</body></html>';
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function main() {
  if (!fs.existsSync(SRC)) fail('folder source/ tidak ada.');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) { warn('config.json tidak terbaca: ' + e.message); }
  const execUrl = (process.env.EXEC_URL || cfg.EXEC_URL || '').trim();
  const execOk = /^https:\/\/script\.google\.com\/macros\/(u\/\d+\/)?s\/[^\/]+\/exec$/.test(execUrl);
  if (!execOk) warn('EXEC_URL belum valid di config.json (harus berakhiran /exec). Halaman tetap dibuild, tetapi login tidak akan berfungsi.');

  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(PUBLIC, OUT);

  const builtPages = [];
  for (const page of PAGES) {
    const tpl = readSource(page.src);
    if (tpl === null) {
      if (page.required) fail('source/' + page.src + '.html wajib ada.');
      warn('source/' + page.src + '.html tidak ada -> ' + page.out + ' dilewati.');
      continue;
    }
    let html = resolveIncludes(tpl, page.src, [page.src]);
    html = replaceKnownScriptlets(html, execUrl);
    const left = html.match(ANY_SCRIPTLET_RE);
    if (left) fail('Scriptlet Apps Script tersisa di ' + page.src + ': "' + left[0].slice(0, 80) + '". Beri tahu developer untuk menanganinya.');
    html = inject(html, page, execOk);
    fs.writeFileSync(path.join(OUT, page.out), html);
    builtPages.push(page.out);
    console.log('  ok  ' + page.out + '  (' + Math.round(html.length / 1024) + ' KB)');
  }

  const cfgJs = 'window.FASTAPP_CONFIG=' + JSON.stringify({ EXEC_URL: execUrl, TIMEOUT_MS: 330000 }) + ';\n';
  fs.writeFileSync(path.join(OUT, 'config.js'), cfgJs);

  // Service worker: versi cache + daftar shell.
  const hash = crypto.createHash('sha1');
  for (const f of builtPages.concat(['api-adapter.js', 'config.js'])) hash.update(fs.readFileSync(path.join(OUT, f)));
  const buildId = hash.digest('hex').slice(0, 10);
  const swPath = path.join(OUT, 'sw.js');
  const shell = ['./'].concat(builtPages, ['config.js', 'api-adapter.js', 'manifest.json', 'manifest-buat.json', 'icons/icon-192.png', 'icons/icon-512.png']);
  fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/__BUILD_ID__/g, buildId).replace('__SHELL__', JSON.stringify(shell)));

  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log('Selesai -> ' + path.relative(ROOT, OUT) + '/  (build ' + buildId + ')');
}
main();
