# fast-app (GitHub Pages)

Frontend PWA FAST APP untuk backend Google Apps Script.

## Struktur repo
```
fast-app/
├─ .github/workflows/pages.yml   build + deploy otomatis setiap push ke main
├─ .gitignore                    dist/ dan node_modules/ TIDAK ikut repo
├─ build.js                      menggabungkan source/ + public/ menjadi dist/
├─ config.json                   berisi EXEC_URL (alamat /exec Apps Script)
├─ package.json
├─ source/                       berkas .html dari Apps Script (diisi runPublishToGitHub)
├─ public/                       aset PWA statis (disalin apa adanya ke dist/)
│  ├─ api-adapter.js  sw.js  pwa-update.js  pwa-install.js
│  ├─ firebase-config.js         nilai Firebase milik Anda (jangan ditimpa)
│  ├─ manifest.json  test.html
│  └─ icons/                     ikon + badge notifikasi
└─ tools/sync-from-folder.js     alternatif lokal untuk mengisi source/
```
`dist/` dibuat otomatis oleh GitHub Actions. Jangan dibuat/diedit/di-commit sendiri.

## Ke mana setiap jenis berkas ditaruh
| Berkas | Taruh di |
|---|---|
| `*.html` (index, styles, script-*, login-*, statistik, pdfrender) | `source/` (otomatis lewat `runPublishToGitHub`, atau salin manual) |
| `sw.js`, `pwa-update.js`, `pwa-install.js`, `api-adapter.js`, `manifest.json`, `test.html` | `public/` |
| `firebase-config.js` | `public/` (isi milik Anda, jangan ditimpa paket) |
| Ikon (`icon-*.png`, `badge-96.png`, `*.svg`) | `public/icons/` |
| `build.js`, `config.json`, `package.json`, `README.md` | root repo |
| `pages.yml` | `.github/workflows/` |
| Berkas `.gs` (backend) | TIDAK PERNAH ke GitHub; hanya di editor Apps Script |

## Alur update
1. Backend (`.gs`) dan UI (`.html`): tempel di editor Apps Script, Deploy > versi baru.
2. Jalankan `runPublishToGitHub` (mengisi `source/`). Berkas di `public/`, `build.js`, dll disalin manual.
3. Commit + push, lalu cek tab Actions hijau.
