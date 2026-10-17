# fast-app (GitHub Pages)

Frontend PWA FAST APP untuk backend Google Apps Script. Panduan lengkap: `CARA-PAKAI.md` di paket.

- `source/`  salinan file .html dari editor Apps Script (diisi otomatis oleh `runPublishToGitHub`)
- `public/`  aset statis (adapter, manifest, service worker, ikon, test.html)
- `build.js` menggabungkan `source/` menjadi halaman statis di `dist/`
- `config.json` berisi `EXEC_URL`
