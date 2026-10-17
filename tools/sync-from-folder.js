#!/usr/bin/env node
/**
 * Salin file .html dari sebuah folder ke source/ (alternatif lokal).
 * Pakai:  node tools/sync-from-folder.js <folder-berisi-file-html>
 * Contoh folder: hasil `clasp pull` atau folder tempat Anda menyimpan salinan.
 * Hanya .html yang disalin; .gs tidak pernah disalin ke repo.
 */
'use strict';
const fs = require('fs'), path = require('path');
const from = process.argv[2];
if (!from || !fs.existsSync(from)) { console.error('Pakai: node tools/sync-from-folder.js <folder>'); process.exit(1); }
const to = path.join(__dirname, '..', 'source');
fs.mkdirSync(to, { recursive: true });
let n = 0, changed = 0;
for (const f of fs.readdirSync(from)) {
  if (!f.toLowerCase().endsWith('.html')) continue;
  const a = path.join(from, f), b = path.join(to, f);
  const data = fs.readFileSync(a);
  n++;
  if (!fs.existsSync(b) || !fs.readFileSync(b).equals(data)) { fs.writeFileSync(b, data); changed++; console.log('  diubah  ' + f); }
}
console.log(n + ' file html diperiksa, ' + changed + ' diperbarui di source/.');
