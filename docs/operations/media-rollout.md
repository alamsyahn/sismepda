# Runbook: rollout penyimpanan media kanonik ke produksi

Dokumen ini adalah prosedur operasional untuk memindahkan produksi SISMEPDA dari
media-dalam-`bytea` ke penyimpanan media kanonik berbasis filesystem.

Dokumen lain yang berkaitan:

- [Arsitektur penyimpanan media](../architecture/media-storage.md) — cara kerja tiga lapis dan fallback legacy.
- [Deployment](deployment.md) — alur `deploy:check` / `deploy:prod` yang sudah ada.
- [Backup dan restore](backup-restore.md) — backup database.

Prinsip dokumen ini: **rollout harus dapat dihentikan dengan aman di setiap
checkpoint.** Byte legacy `bytea` masih ada dan masih melayani permintaan, jadi
tidak ada satu langkah pun yang wajib dilanjutkan hari itu juga.

## Kondisi produksi saat ini

Diverifikasi lewat inspeksi read-only:

| Aspek | Kondisi |
| --- | --- |
| SSH | `smpn2`, app di `/srv/apps/sismepda` |
| Compose | `deploy.yaml` di host, **tidak ada di Git** |
| Volume database | bind mount `/var/lib/sismepda/postgresql` |
| Volume media | dikonfigurasi lewat overlay `compose.media.yaml`; aktif setelah deploy berikutnya |
| `MEDIA_STORAGE_ROOT` | `/app/media`, ditetapkan overlay |
| Byte media legacy | ±7,1 MB di `bytea` |
| Migrasi belum diterapkan | 2 (`add_media_storage_keys`, `relax_media_consistency_checks`) |

## Persistensi media produksi

`deploy.yaml` berada di host dan sengaja tidak di-track Git, jadi konfigurasi
media **tidak** disuntikkan ke sana dengan tangan — suntingan manual tidak
terlacak, tidak ter-review, dan tidak teruji. Konfigurasinya hidup di repo
sebagai overlay Compose:

```yaml
# compose.media.yaml
services:
  app:
    environment:
      MEDIA_STORAGE_ROOT: /app/media
    volumes:
      - media:/app/media

volumes:
  media:
    name: sismepda_media_data
```

Setiap perintah compose produksi dijalankan sebagai:

```bash
docker compose -f deploy.yaml -f compose.media.yaml --env-file /etc/sismepda/sismepda.env ...
```

Beberapa hal yang menentukan keselamatan data:

- **Nama volume eksplisit.** Tanpa `name:`, Docker menamai volume
  `<project>_media`. Rename direktori deploy atau perubahan nama project akan
  diam-diam membuat volume BARU yang kosong, sementara media lama tetap ada di
  disk tetapi tidak lagi ter-mount.
- **Topologi database tidak disentuh.** Overlay tidak menyebut service maupun
  volume database; PostgreSQL tetap memakai bind mount
  `/var/lib/sismepda/postgresql` milik `deploy.yaml`.
- **Overlay tiba lewat Git.** Ia sampai ke produksi melalui `git merge --ff-only`
  di tengah alur deploy. Karena itu preflight (yang berjalan sebelum merge) hanya
  melaporkan statusnya, sedangkan tahap **build**, **migrate**, dan **activate**
  menolak berjalan bila overlay tidak ada — container app tidak pernah dibuat
  ulang tanpa volume media.
- **Kepemilikan direktori.** `Dockerfile` membuat `/app/media` dan men-`chown`
  ke `nextjs:nodejs` sebelum `USER nextjs`, sehingga volume kosong yang di-mount
  mewarisi kepemilikan itu. Tidak diperlukan `chmod 777` maupun root saat runtime.

### Jangan pernah menghapus volume media

`docker compose down -v`, `docker volume rm`, `docker volume prune`, dan
`--renew-anon-volumes` menghapus media produksi. Alur deploy tidak memakai satu
pun dari perintah tersebut, dan hal itu dikunci oleh test statis di
`tests/rollout-preparation.test.ts`. Aktivasi memakai `up -d`, yang membuat ulang
container tanpa menyentuh named volume.

### Backup

Backup set membaca akar media dari container (`printenv MEDIA_STORAGE_ROOT`),
bukan dari jalur yang ditulis ulang di skrip, sehingga backup selalu mengikuti
konfigurasi yang sama dengan aplikasi. Bila variabel itu tidak diset, backup
berhenti dengan `ABORT` alih-alih mengarsipkan direktori yang salah.

## PHASE 0 — Prasyarat

```bash
npm run deploy:preflight
```

Read-only terhadap produksi. Keluar non-nol dan mencetak `NOT READY` bila ada
blocker. Jangan lanjut sebelum `READY`.

## PHASE 1 — Backup lengkap

```bash
npm run backup:production -- --dry-run   # tinjau rencana
npm run backup:production
```

Menghasilkan satu set pemulihan di `/srv/backups/sismepda/sets/<set-id>/`:
`database.dump`, `media.tar.gz`, `manifest.json`.

Urutannya **database dulu, media kemudian**. Alasannya: alur tulis media adalah
`tulis berkas → perbarui referensi database`. Dengan urutan ini, berkas yang
lahir di antara kedua backup tetap tertangkap arsip media meski belum ada di
dump — kondisi yang aman (berkas yatim). Urutan terbalik akan menghasilkan
referensi database tanpa berkas — kondisi yang rusak.

**Batas kejujuran:** ini bukan snapshot atomik. Ada jeda beberapa detik antara
dump database dan arsip media. Untuk beban SISMEPDA (sekolah, unggahan jarang)
jeda ini dapat diterima. Bila suatu saat unggahan menjadi sering, jeda ini perlu
ditutup dengan snapshot filesystem, bukan dengan tooling ini.

## PHASE 2 — Deploy aplikasi

```bash
npm run deploy:prod
```

Ini alur yang sudah ada: validasi lokal → push → preflight → lock → backup
database → build → recreate → `prisma migrate deploy` → health check.

Kode baru **backward compatible**: baris yang belum punya kunci media tetap
dilayani dari `bytea`.

## PHASE 3 — Skema aditif

Dijalankan otomatis oleh `deploy:prod` di atas. Kedua migrasi bersifat aditif:
menambah kolom nullable dan melonggarkan CHECK constraint. Tidak ada
`DROP COLUMN`, tidak ada `DROP TABLE`.

## PHASE 4 — Verifikasi aplikasi

1. Health check (otomatis dalam `deploy:prod`).
2. Gambar legacy masih tampil — buka `/e-uks` dan `/sarpras`, pastikan gambar
   termuat. Ini membuktikan fallback `bytea` hidup.
3. Tulis media baru berhasil — lihat rencana smoke test di bawah.

**CHECKPOINT.** Sampai titik ini belum ada byte legacy yang dipindahkan.
Berhenti di sini aman dan boleh berlangsung berhari-hari.

## PHASE 5 — Verifikasi backup menangkap media baru

```bash
npm run backup:production
```

Set backup baru harus memuat berkas yang lahir dari smoke test PHASE 4. Ini
membuktikan media baru benar-benar masuk cakupan backup.

## PHASE 6 — Migrasi media legacy

**Tidak dijalankan otomatis oleh perintah deploy mana pun.** Ini tindakan
eksplisit terpisah.

```bash
npm run media:migrate -- --dry-run   # nol tulisan
# tinjau keluaran, lalu:
npm run media:migrate
```

Migrasi bersifat idempoten dan dapat diulang: baris yang sudah punya kunci
dilewati, dan `bytea` **dipertahankan**.

## PHASE 7 — Verifikasi migrasi

```bash
npm run media:migrate:verify
```

Read-only. Melaporkan `total / migrated / valid / missing / mismatch /
legacy retained`. Rollout dianggap sehat bila `missing = 0`, `mismatch = 0`,
dan `legacy retained` masih sama dengan jumlah baris bermedia.

## PHASE 8 — Selesai

Catat set backup terakhir dan commit yang berjalan. Byte legacy tetap tinggal.
Pemensiunan `bytea` adalah phase terpisah di masa depan, dan baru boleh
dipertimbangkan setelah backup media berjalan terjadwal.

## Smoke test media baru di produksi

Tujuan: membuktikan `unggah → berkas tercipta → kunci database terisi → route
menyajikan → bertahan restart`.

Gunakan **foto profil sebuah akun uji**, bukan branding sekolah, bukan logo,
bukan konten E-UKS. Foto profil hanya terlihat oleh pemilik akun, jadi kegagalan
tidak merusak tampilan publik. Jangan memakai app logo atau favicon sebagai
bahan uji: keduanya tampil di seluruh halaman.

1. Masuk sebagai akun uji, unggah gambar kecil di `/profil`.
2. Muat ulang halaman, pastikan gambar tampil (bukan ikon rusak).
3. Periksa bahwa kunci tersimpan dan penyimpanan terisi:
   ```bash
   npm run media:migrate:verify
   ```
4. Hapus foto lewat UI bila tidak diperlukan lagi. Berkas yatim yang tertinggal
   tidak berbahaya dan dibersihkan pada phase garbage collection.

## Rollback

### A. Deploy gagal sebelum migrasi Prisma

Tidak ada perubahan skema. Rollback aplikasi seperti biasa. Lock deployment
dilepas oleh alur `deploy:prod`; bila proses terbunuh paksa, hapus lock secara
manual sesuai [deployment.md](deployment.md).

### B. Migrasi aditif berhasil, aplikasi baru gagal

**Rollback kode, biarkan kolom tambahan di database.** Kolom baru nullable dan
kode lama tidak pernah menyebutnya, jadi kode lama berjalan normal di atas skema
baru. Jangan membuat migrasi balik yang menghapus kolom.

### C. Jalur unggah media baru gagal

Media legacy tetap bekerja lewat `bytea`. Hentikan rollout, **jangan** jalankan
PHASE 6. Rollback aplikasi bila perlu.

### D. Migrasi media legacy gagal sebagian

Migrasi idempoten dan dapat dilanjutkan:

- hentikan,
- selidiki,
- **jangan** hapus berkas yang sudah berhasil dipindahkan,
- **jangan** hapus `bytea`,
- jalankan ulang setelah perbaikan.

Aplikasi tetap melayani: penyimpanan bila kuncinya valid, `bytea` bila tidak.

### E. Volume media hilang setelah rollout

- Media legacy: masih ada di `bytea`, tetap tampil.
- Media yang diunggah **setelah** rollout: hanya ada di penyimpanan → pulihkan
  dari arsip media set backup terakhir. Ini satu-satunya kelas data yang tidak
  punya jaring pengaman kedua, dan alasan backup media harus terjadwal.

### Prinsip rollback database

**Jangan merancang rollback di sekitar restore database produksi.** Restore
database adalah pemulihan bencana, bukan rollback deployment. Produksi SISMEPDA
menerima data sekolah setiap hari (presensi, kunjungan UKS); restore dump lama
membuang data yang masuk sejak dump dibuat. Rollback normal untuk skema aditif
adalah **rollback kode, biarkan skema**.

## Runbook pemulihan dari backup

Jangan dijalankan terhadap produksi kecuali benar-benar bencana.

1. Identifikasi set backup: `ls /srv/backups/sismepda/sets/`.
2. Periksa `manifest.json` — `complete` harus `true`.
3. Verifikasi dump database: `pg_restore --list < database.dump`.
4. Verifikasi arsip media: `tar -tzf media.tar.gz | wc -l`, bandingkan dengan
   `media.fileCount` di manifest.
5. Bila ini pemulihan bencana sungguhan, hentikan penulisan aplikasi lebih dulu.
6. Restore database **hanya bila memang diperlukan**.
7. Restore media ke target bersih, bukan menimpa direktori yang sedang dipakai.
8. Pastikan kepemilikan berkas sesuai pengguna runtime container (`nextjs`,
   uid 1001). Jangan `chmod 777`; jangan menjalankan aplikasi sebagai root.
9. Verifikasi referensi media dengan `npm run media:migrate:verify`.
10. Jalankan aplikasi.
11. Verifikasi pascarestore: health check, gambar legacy, unggah baru.

**Kehilangan media saja tidak memerlukan restore database.** Pulihkan arsip
media sendiri.

## Retensi

Default: **7 harian + 4 mingguan**. Aturan pemilihannya murni dan teruji
(`lib/backup-set.ts`), tetapi **belum ada penghapusan otomatis**. Set backup
kedaluwarsa saat ini harus ditinjau dan dihapus manual oleh operator. Ini
disengaja: penghapusan otomatis tanpa uji coba nyata lebih berisiko daripada
disk yang terisi perlahan.

## Offsite

```text
BACKUP LOKAL DI VPS
melindungi dari:
- migrasi yang buruk
- kesalahan di level aplikasi

TIDAK melindungi dari:
- kehilangan VPS
- kegagalan disk
- kehilangan akses provider
```

Backup offsite adalah phase berikutnya dan belum dikerjakan. Lihat TD-016.

## Batas perintah

Tiga hal berikut tidak boleh dicampur:

| Kategori | Perintah | Sifat |
| --- | --- | --- |
| Deploy kode | `deploy:prod` | rutin, aman diulang |
| Migrasi media legacy | `media:migrate` | eksplisit, satu arah, idempoten |
| Pemulihan bencana | restore manual | terakhir, butuh keputusan manusia |

Tidak ada perintah deploy umum yang boleh melakukan pemulihan destruktif, dan
tidak ada perintah deploy yang menjalankan migrasi media legacy.
