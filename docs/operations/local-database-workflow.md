# Workflow database lokal

Cara memilih database yang dipakai SISMEPDA saat development, dan cara membuat
ulang clone lokal dari data produksi.

## Peran database

| Database | Lokasi | Sifat | Dipakai untuk |
|---|---|---|---|
| `sismepda` | Server produksi (`smpn2`), container `sismepda-db-1`, PostgreSQL 17 | **Read-only dari workstation** | Sumber dump. Tidak pernah menjadi target tulis apa pun. |
| `sismepda_dev` | PostgreSQL 15 lokal (Windows), port 5432, schema `sismepda_local` | **Persisten** | Development harian, data dummy, data uji E-UKS, akun lokal, eksperimen. |
| `sismepda_prodclone` | Container `sismepda-prodclone-db`, PostgreSQL 17, port 5434 | **Disposable** | Menguji aplikasi terbaru di atas data produksi nyata dan memverifikasi migrasi terhadap data legacy. |

Clone berjalan di container PostgreSQL 17 terpisah, bukan di server PostgreSQL
15 milik Windows, karena produksi memakai PostgreSQL 17: arsip custom-format
pg_dump 17 tidak dapat dibaca `pg_restore` 15, dan dump plain-nya memuat
direktif yang server 15 tolak. Menyamakan versi menghapus seluruh kelas masalah
itu sekaligus membuat clone benar-benar setara produksi.

## Cara menjalankan

```bash
npm run dev:local       # aplikasi di atas sismepda_dev
npm run dev:prodclone   # aplikasi di atas sismepda_prodclone
```

Kedua perintah mencetak target yang dipakai sebelum Next.js start, misalnya:

```text
[db:local] database development lokal → localhost:5432/sismepda_dev (schema sismepda_local)
```

`npm run dev` yang lama tetap ada dan tidak berubah perilakunya: ia membaca
`.env` langsung tanpa pembungkus, jadi ia selalu memakai `DATABASE_URL` apa pun
yang tertulis di sana. Gunakan `dev:local` bila ingin jaminan eksplisit.

Prisma Studio mengikuti pola sama: `npm run db:studio:local` dan
`npm run db:studio:prodclone`.

## Cara switching diimplementasikan

`scripts/with-db.ts` adalah pembungkus tipis di depan perintah apa pun:

```text
npm run dev:prodclone
  → tsx scripts/with-db.ts prodclone -- next dev
      → baca .env.prodclone
      → validasi DATABASE_URL lewat lib/database-target.ts
      → jalankan `next dev` dengan DATABASE_URL peran itu
```

File environment per peran adalah satu-satunya tempat kredensial berada:

| Peran | File | Wajib menunjuk |
|---|---|---|
| `local` | `.env` | `sismepda_dev` |
| `prodclone` | `.env.prodclone` (dibuat otomatis oleh refresh) | `sismepda_prodclone` |

File peran hanya memuat `DATABASE_URL`. Variabel lain (`AUTH_SECRET`,
`DEV_TEST_USER_*`, dan seterusnya) tetap dibaca dari `.env`, sehingga tidak ada
kredensial yang diduplikasi antar file. `DATABASE_URL` diteruskan ke proses anak
lewat environment, bukan lewat argumen baris perintah, karena argumen terlihat
di daftar proses.

Pembungkus juga menetapkan `EXPECTED_DEV_DATABASE_NAME` sesuai peran, sehingga
guard E-UKS yang sudah ada ikut terkunci ke database yang sama tanpa operator
perlu menyunting `.env`.

## Cara refresh clone produksi

```bash
npm run db:refresh-prodclone

# opsi
npm run db:refresh-prodclone -- --keep-dump    # pertahankan dump setelah selesai
npm run db:refresh-prodclone -- --reuse-dump   # pakai dump yang sudah ada, produksi tidak disentuh
```

## Apa yang terjadi saat refresh

```text
produksi
  → pg_dump (read-only, custom format)
  → dump lokal di .prodclone/
  → recreate HANYA database sismepda_prodclone
  → pg_restore
  → prisma migrate deploy (migrasi repo terbaru)
  → seed registry RBAC + backfill legacy + akun uji lokal
  → validasi jumlah baris
  → verifikasi produksi tidak berubah
  → hapus dump
```

Rincian tiap langkah:

1. **Prasyarat** — `ssh`, `docker`, dan daemon Docker harus siap.
2. **SSH** — koneksi ke `smpn2` diuji dengan `BatchMode` (menolak prompt password).
3. **Identifikasi produksi** — nama container dan database **tidak diasumsikan**.
   Container ditemukan dari daftar container PostgreSQL yang berjalan; nama
   database dan user dibaca dari environment container itu sendiri. Bila
   kandidatnya tidak tunggal, skrip berhenti alih-alih menebak.
4. **Baseline** — jumlah migrasi, tabel, user, dan siswa produksi dicatat untuk
   dibandingkan setelah selesai.
5. **Dump** — `pg_dump --format=custom --no-owner --no-privileges` dijalankan di
   dalam container produksi, dialirkan lewat SSH langsung ke file lokal. Tidak
   ada file sementara yang ditinggal di server.
6. **Container clone** — dibuat bila belum ada, dengan nama, port, dan volume
   yang berbeda dari container PostgreSQL lain di mesin.
7. **Recreate** — `DROP DATABASE` hanya setelah seluruh guard lolos.
8. **Restore** — jumlah tabel hasil restore dibandingkan dengan produksi.
9. **Migrasi** — `prisma migrate deploy`. Bukan `migrate dev`, bukan `db push`,
   tidak pernah `migrate reset`.
10. **Bootstrap lokal** — `prisma db seed` (registry RBAC), backfill legacy, lalu
    akun uji lokal lewat `scripts/ensure-local-test-user.ts` yang sudah ada.
11. **Validasi** — jumlah `Student` clone harus sama persis dengan produksi.
12. **Verifikasi produksi** — baseline dibandingkan ulang; selisih apa pun
    dianggap kegagalan serius.
13. **Bersih-bersih** — dump dihapus kecuali `--keep-dump`.

Data uji synthetic **tidak** dibuat oleh refresh. Clone merepresentasikan data
produksi + schema terbaru, titik. Bila memang perlu, jalankan
`npm run dev:euks-seed` secara eksplisit setelah refresh.

## Apa yang tidak disentuh

- **Produksi** — hanya `pg_dump` dan `SELECT`. Tidak ada migrasi, seed,
  backfill, akun uji, atau restart service.
- **`sismepda_dev`** — tidak dibaca, tidak ditulis, tidak dihapus oleh workflow
  refresh. Guard secara eksplisit menolak menjadikannya target destruktif.

## Guardrails

Aturan murni ada di `lib/database-target.ts` dan diuji di
`tests/database-target.test.ts`.

Setiap perintah peran memeriksa empat hal sebelum proses anak dijalankan:

1. `DATABASE_URL` dapat diparse sebagai URL PostgreSQL.
2. Host ada di allowlist mesin sendiri (`localhost`, `127.0.0.1`, `::1`).
   Nama service Docker dan host remote ditolak — seluruh deployment produksi
   memakai host service Docker, jadi menerimanya justru menghapus pembeda
   terpenting.
3. Nama database bukan nama database produksi, bahkan bila host terbaca lokal
   (SSH tunnel, port-forward, override `/etc/hosts`).
4. Nama database sama persis dengan yang dipatok untuk peran itu, sehingga
   `dev:prodclone` tidak mungkin berjalan di atas `sismepda_dev`.

Sebelum `DROP DATABASE`, tiga guard tambahan:

- target bukan database produksi;
- target bukan `sismepda_dev`;
- container clone hanya memuat database yang diharapkan — bila ada database tak
  dikenal di port itu, skrip menolak menghapus apa pun.

Setelah koneksi terbuka, nama database yang benar-benar dilayani server
diverifikasi ulang terhadap yang direncanakan.

Aturan lain:

- Produksi read-only; jangan pernah menjalankan migrasi dari workstation.
- Prodclone disposable; `sismepda_dev` tidak boleh dihapus tanpa permintaan eksplisit.
- Dump produksi tidak boleh masuk Git (`.prodclone/`, `*.dump` ter-ignore).
- `.env*` ter-ignore kecuali contoh; kredensial tidak pernah dicetak ke log.
  Ringkasan target hanya memuat host, port, nama database, dan schema.
- Password superuser clone dibuat acak sekali lalu disimpan di `.env.prodclone`.
  Clone memuat data siswa nyata: perlakukan kredensialnya seperti kredensial nyata.

## Status saat ini: migrasi prodclone terblokir

`npm run db:refresh-prodclone` berhasil sampai restore (27 tabel, 16 migrasi),
lalu **berhenti di langkah migrasi** — sesuai desain:

```text
Applying migration `20260909100000_use_date_for_business_dates`
ERROR: Date-only migration aborted: 151 non-midnight legacy value(s) require manual review
```

Audit di clone (bukan di produksi) menunjukkan:

- 151 baris `AttendanceDay` bernilai jam `17:00:00`, seluruhnya dalam rentang
  2026-09-06 sampai 2026-09-11. Tabel lain bersih.
- 22 pasangan `(classId, tanggal kalender)` akan bertabrakan bila dikonversi ke
  `DATE`, sehingga unique constraint gagal.

`17:00:00` adalah tengah malam WIB yang tersimpan sebagai UTC — penulis legacy
menyimpan proyeksi zona waktu, bukan tanggal kalender. Ini **drift data
produksi nyata**, bukan masalah workflow clone: migrasi yang sama akan gagal
dengan cara yang sama bila dijalankan terhadap produksi.

Sampai keputusan bisnisnya diambil, prodclone tetap berada pada schema produksi
(16 migrasi). Aplikasi tetap boot di atasnya, tetapi halaman yang membutuhkan
kolom baru akan gagal — misalnya `SchoolSetting.timeZone` belum ada.

Jangan menambal ini dengan `db push --force-reset` atau migrasi baru. Lihat
`docs/technical-debt/README.md`.

## Konsep future workflow: rebase `sismepda_dev` dari prodclone

Belum diimplementasikan, dan sengaja demikian: menghapus `sismepda_dev` berarti
kehilangan data dummy, akun lokal, dan fixture yang dibangun berhari-hari, dan
itu tidak dapat dipulihkan dari produksi.

Bila suatu saat dibutuhkan, bentuknya:

```text
prodclone terbaru
→ backup sismepda_dev ke file (wajib, diverifikasi dapat di-restore)
→ recreate sismepda_dev
→ restore/copy dari prodclone
→ bootstrap lokal (npm run dev:bootstrap)
→ akun uji lokal
→ fixture synthetic
```

Syarat bila dibuat: perintah terpisah, konfirmasi interaktif eksplisit, backup
wajib sebelum apa pun dihapus, tidak pernah dipanggil oleh refresh-prodclone,
dan tidak pernah menyentuh produksi.

## Troubleshooting

**SSH gagal**
`BatchMode` menolak prompt password. Pastikan alias `smpn2` ada di
`~/.ssh/config` dan kuncinya sudah dimuat. Uji manual: `ssh smpn2 echo ok`.

**Docker daemon tidak berjalan**
`ABORT: Docker daemon tidak berjalan.` Jalankan Docker Desktop, tunggu sampai
`docker info` berhasil, lalu ulangi.

**Versi pg_dump/pg_restore tidak cocok**
Tidak berlaku pada jalur ini: dump dibuat di dalam container produksi dan
direstorasi di dalam container clone, keduanya PostgreSQL 17. Bila mencoba
merestorasi dump produksi ke PostgreSQL 15 lokal, `pg_restore` akan menolak
arsip dengan versi lebih baru — jangan lakukan itu, gunakan container clone.

**PostgreSQL lokal tidak jalan**
`dev:local` memerlukan service PostgreSQL 15 Windows aktif di port 5432.
`dev:prodclone` memerlukan container `sismepda-prodclone-db` aktif:
`docker start sismepda-prodclone-db`.

**`.env.prodclone` tidak ditemukan**
Clone belum pernah dibuat. Jalankan `npm run db:refresh-prodclone`.

**Migrasi gagal**
Jangan reset. Baca pesan aslinya, audit datanya di clone, lalu laporkan. Lihat
bagian "Status saat ini" di atas.

**DATABASE_URL salah**
Pembungkus akan menolak dengan menyebut peran, file, dan nama database yang
ditemukan. Perbaiki file peran yang disebut, bukan guard-nya.

**Port bentrok**
Clone memakai 5434 karena 5432 milik PostgreSQL 15 Windows dan 5433 dipakai
container proyek lain. Aplikasi tetap di 3000; `dev:local` dan `dev:prodclone`
tidak dapat berjalan bersamaan pada port yang sama.
