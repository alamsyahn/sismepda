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

## Arah sinkronisasi: prodclone ≠ production

`sismepda_prodclone` adalah salinan sekali jalan untuk rehearsal, bukan
lingkungan yang dapat dipromosikan. Arahnya selalu satu:

```text
production → dump → prodclone
```

Tidak ada perkakas di repositori ini yang mengirim `sismepda_dev` atau
`sismepda_prodclone` kembali ke produksi, dan tooling deployment
(`npm run deploy:check|prod|status`, lihat [deployment](deployment.md)) tidak
pernah membaca `.env.local` maupun konfigurasi clone. Produksi hanya berubah
melalui `prisma migrate deploy` atas commit yang sudah ada di
`origin/main`; `tests/deployment-orchestration.test.ts` mengunci pemisahan itu.

## Cara menjalankan

```bash
npm run dev:local            # aplikasi di atas sismepda_dev
npm run dev:prodclone        # aplikasi di atas sismepda_prodclone

npm run db:prodclone:refresh # buat ulang DATABASE clone dari produksi
npm run media:prodclone:sync # sinkronkan MEDIA dari produksi (incremental)
npm run prodclone:refresh    # wrapper: database lalu media
```

Database dan media adalah **dua lifecycle terpisah**. `db:prodclone:refresh`
tidak menyentuh media sama sekali, dan `dev:prodclone` tidak pernah melakukan
refresh diam-diam — ia hanya menjalankan aplikasi terhadap clone yang ada.
Semantik lengkap sinkronisasi media ada di
[`../architecture/media-storage.md`](../architecture/media-storage.md).

Kedua perintah mencetak target yang dipakai sebelum Next.js start, misalnya:

```text
[db:local] database development lokal → localhost:5432/sismepda_dev (schema sismepda_local)
```

## Permukaan perintah

Konvensi: `<domain>:<action>:<target>`. **Setiap perintah yang dapat membaca
atau menulis sebuah database menyebut targetnya pada namanya**, dan target itu
diselesaikan `scripts/with-db.ts` dari file environment peran — bukan dari
`.env` yang kebetulan aktif. Tidak ada perintah generik tanpa target, dan tidak
ada alias: satu fungsi punya tepat satu nama.

| Perintah | Target | Fungsi |
| --- | --- | --- |
| `dev:local` | `sismepda_dev` | Jalankan aplikasi |
| `dev:prodclone` | `sismepda_prodclone` | Jalankan aplikasi di atas clone |
| `db:migrate:local` | `sismepda_dev` | `prisma migrate dev` |
| `db:seed:local` | `sismepda_dev` | `prisma db seed` |
| `db:setup:local` | `sismepda_dev` | migrate lalu seed |
| `db:studio:local` | `sismepda_dev` | Prisma Studio |
| `db:studio:prodclone` | `sismepda_prodclone` | Prisma Studio |
| `db:ensure-test-user:local` | `sismepda_dev` | Akun uji development |
| `db:bootstrap:local` | `sismepda_dev` | Akun uji + data uji E-UKS |
| `db:prodclone:refresh` | `sismepda_prodclone` | Buat ulang database clone |
| `media:prodclone:sync` | clone lokal | Sinkronkan media dari produksi |
| `prodclone:refresh` | `sismepda_prodclone` | Orkestrasi database + media |
| `euks:seed:local` / `euks:clear:local` | `sismepda_dev` | Data uji E-UKS |
| `euks:seed:prodclone` / `euks:clear:prodclone` | `sismepda_prodclone` | Data uji E-UKS di clone |
| `media:migrate:local` | `sismepda_dev` | Migrasi bytea → media kanonik |
| `media:migrate:verify:local` | `sismepda_dev` | Verifikasi referensi media |
| `media:migrate:production` | produksi | Migrasi media lewat migrator produksi |
| `backup:production` / `backup:production:verify` | produksi | Backup lengkap & verifikasinya |
| `db:analyze-legacy-dates:prodclone` | `sismepda_prodclone` | Analisis tanggal legacy, read-only |
| `db:rbac-backfill` | ditentukan operator | Backfill RBAC; `--apply` wajib `--database=<nama>` |
| `deploy:check` / `preflight` / `prod` / `status` | produksi | Orkestrasi deployment |
| `build` / `start` / `lint` / `test` / `postinstall` | — | Standar Node |

Tiga catatan penamaan yang disengaja:

- **Tidak ada `npm run dev`.** Perintah itu dulu membaca `.env` langsung tanpa
  guard, sehingga perintah yang sama bisa menjalankan aplikasi di atas database
  mana pun tergantung isi file. Ketiadaan shortcut lebih baik daripada shortcut
  yang ambigu.
- **`db:rbac-backfill` tanpa sufiks target.** Perintah ini tidak memilih
  database dari file peran; operator mengetik sendiri `--database=<nama>` dan
  skrip menolak bila `current_database()` tidak sama persis. Targetnya adalah
  argumen, jadi menempelkan sufiks peran pada namanya justru berbohong.
- **`db:analyze-legacy-dates:prodclone` memakai sufiks** walau tidak lewat
  `with-db.ts`: ia membaca `.env.prodclone` sendiri dan menjalankan
  `assertDestroyableClone`, sehingga perannya tetap satu dan layak
  terlihat di nama perintah.

Tidak ada `db:migrate:production`, `db:seed:production`, atau
`db:studio:production`, dan tidak akan ditambahkan: perubahan schema produksi
hanya boleh lewat orkestrasi deployment. `tests/cli-surface.test.ts` mengunci
seluruh aturan di atas — perintah kanonik yang wajib ada, nama lama yang
dilarang muncul kembali, keharusan memakai `with-db.ts`, dan larangan jalur
pintas produksi.


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
npm run db:prodclone:refresh

# opsi
npm run db:prodclone:refresh -- --keep-dump    # pertahankan dump setelah selesai
npm run db:prodclone:refresh -- --reuse-dump   # pakai dump yang sudah ada, produksi tidak disentuh
```

## Apa yang terjadi saat refresh

```text
produksi
  → pg_dump (read-only, custom format)
  → dump lokal di .prodclone/
  → recreate HANYA database sismepda_prodclone
  → pg_restore
  → perbaikan data legacy tanggal bisnis (sebelum migrasi)
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
9. **Perbaikan data legacy** — status TD-014 ditentukan dari tipe kolom nyata
   di clone; `prisma/legacy-date-repair.sql` dijalankan **sebelum** migrasi
   hanya bila dump masih pra-migrasi. Invariant tanggal bisnis tetap
   diverifikasi read-only pada kedua jalur; lihat bagian di bawah.
10. **Migrasi** — `prisma migrate deploy`. Bukan `migrate dev`, bukan `db push`,
   tidak pernah `migrate reset`.
11. **Bootstrap lokal** — `prisma db seed` (registry RBAC) selalu; backfill
    legacy hanya bila marker `legacy-access-backfill-v1` belum COMPLETED;
    kesiapan RBAC diverifikasi; lalu akun uji lokal lewat
    `scripts/ensure-local-test-user.ts` yang sudah ada.
12. **Validasi** — jumlah `Student` clone harus sama persis dengan produksi.
13. **Verifikasi produksi** — baseline dibandingkan ulang; selisih apa pun
    dianggap kegagalan serius.
14. **Bersih-bersih** — dump dihapus kecuali `--keep-dump`.

Data uji synthetic **tidak** dibuat oleh refresh. Clone merepresentasikan data
produksi + schema terbaru, titik. Bila memang perlu, jalankan
`npm run euks:seed:prodclone` secara eksplisit setelah refresh.

## Perbaikan data legacy tanggal bisnis (TD-014 — selesai di sumber)

Data produksi lama menyimpan tanggal bisnis sebagai proyeksi timezone: midnight
WIB ditulis sebagai `17:00:00` UTC hari sebelumnya. Migrasi
`20260909100000_use_date_for_business_dates` mengubah kolom itu menjadi `DATE`
dan **sengaja abort** bila menemukan jam bukan midnight, karena `::date` polos
akan menggeser hari absensi ke tanggal yang salah tanpa suara.

`prisma/legacy-date-repair.sql` menyelesaikan itu sebelum migrasi berjalan.
Skrip ini idempoten, hanya menyentuh clone, dan berhenti sendiri bila menemukan
kondisi di luar yang sudah dianalisis.

Yang dikerjakan:

1. `17:00:00` dipetakan ke tanggal kalender WIB-nya (`+1 hari`), bukan `::date`.
2. 15 tabrakan `(kelas, tanggal bisnis)` pada 2026-09-07 direkonsiliasi: 11
   duplikat persis, 1 (IX D) beda redaksi note saja — note paling informatif
   yang dipertahankan, 3 konflik nyata memakai baris yang disubmit belakangan.
3. Baris `AttendanceDay` duplikat dihapus setelah `Attendance` anaknya
   dipindahkan, sehingga tidak ada absensi siswa yang hilang.

Ketiga konflik nyata diselesaikan **berdasarkan kebijakan pemilik data, bukan
bukti**. Forensik tidak menemukan jejak koreksi; lihat TD-015 di
[technical debt](../technical-debt/README.md) untuk rinciannya dan siapa yang
harus mengonfirmasi.

### Status: repair sudah permanen di produksi, jadi normalnya dilewati

Repair itu diterapkan ke produksi pada 2026-09-14, dan migrasi date-only kini
tercatat di riwayat produksi. Akibatnya **dump produksi hari ini sudah membawa
kolom bertipe `date`**, bukan `timestamp without time zone`.

Skrip repair hanya sah terhadap schema pra-migrasi: seluruh isinya —
`date::time`, `AT TIME ZONE`, penulisan balik sebagai `::timestamp` —
mengasumsikan kolom timestamp. Terhadap kolom `date`, PostgreSQL menolak
`date::time` (`cannot cast type date to time without time zone`).

Karena itu refresh **menentukan sendiri** apakah repair berlaku, dari tipe
kolom nyata di clone:

```text
information_schema.columns
  → tipe 7 kolom tanggal bisnis
  → lib/legacy-date-repair.ts (fungsi murni)
      semua `timestamp without time zone` → JALANKAN repair
      semua `date`                        → LEWATI, repair tidak berlaku
      campuran / tipe lain / kolom hilang → ABORT
```

Tujuh kolom itu persis yang dikonversi migrasi date-only: `AttendanceDay.date`,
`SchoolHoliday.date`, `User.teachingSince`, `AdditionalDuty.startDate`,
`StudentViolationPoint.occurredAt`, `BosEntry.occurredAt`, dan
`SarprasItem.acquisitionDate`.

Keputusannya diambil dari metadata schema, **bukan** dengan mencoba SQL lalu
menangkap error — try/catch akan menyamarkan kegagalan lain sebagai "tidak perlu
diperbaiki". Schema bercampur dianggap riwayat migrasi yang tidak konsisten dan
membatalkan refresh, bukan ditambal oleh skrip data.

Melewati repair **tidak** berarti melewati pemeriksaan. Pada kedua jalur, refresh
memverifikasi ulang invariant yang dijamin migrasi date-only secara read-only:
tidak boleh ada tabrakan `AttendanceDay(classId, date)` maupun
`SchoolHoliday(date)`. Pelanggaran membatalkan refresh di titik itu, bukan nanti
sebagai kegagalan unique constraint yang membingungkan.

Skrip repair dan `prisma/legacy-date-analysis.sql` **dipertahankan apa adanya**:
keduanya tetap satu-satunya jalur yang benar bila sebuah dump lama (pra-migrasi)
perlu direstorasi ulang. Aturannya diuji di `tests/legacy-date-repair.test.ts`.

Analisis read-only tanpa mengubah apa pun:

```bash
npm run db:analyze-legacy-dates:prodclone
```

Perintah itu memakai deteksi tipe yang sama: terhadap clone modern ia melaporkan
bahwa tidak ada yang perlu dianalisis alih-alih gagal dengan error cast.

## Bootstrap RBAC: backfill legacy juga sudah permanen di sumber

Pola yang sama berlaku untuk backfill akses legacy → RBAC. Dump produksi dulu
berasal dari schema pra-RBAC sehingga clone tiba tanpa keanggotaan sama sekali,
dan `prisma/rbac-backfill-legacy.ts --apply` adalah jalur forward-nya.

Sejak backfill diterapkan ke produksi, dump sudah membawa keanggotaan RBAC
beserta marker `RbacMigration[legacy-access-backfill-v1]` berstatus `COMPLETED`.
Apply ulang ditolak kontrak backfill sendiri — dan penolakan itu **benar**:
memulihkan grant yang sudah dicabut admin akan merusak kesetaraan clone dengan
produksi.

Refresh membaca status marker itu dan memutuskan secara eksplisit:

| Status marker di clone | Tindakan |
|---|---|
| `ABSENT` | Jalankan backfill: dump pra-RBAC, backfill adalah jalur forward |
| `RUNNING` / `FAILED` | Jalankan backfill: kontrak backfill memang resumable |
| `COMPLETED` | Lewati: keanggotaan sudah terbawa restore |
| nilai lain | Abort |

`prisma db seed` tetap selalu dijalankan pada kedua jalur — ia hanya menulis
katalog role/permission dan idempoten. Setelah itu refresh memverifikasi
kesiapan secara read-only: clone wajib benar-benar memiliki role **dan**
keanggotaan, apa pun jalurnya. Nol pada salah satunya membatalkan refresh,
karena aplikasi akan dapat login tetapi tanpa satu pun izin. Aturannya diuji di
`tests/prodclone-rbac-bootstrap.test.ts`.

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

## Status saat ini: refresh berjalan sampai selesai

`npm run db:prodclone:refresh` menyelesaikan seluruh tahapan. Hasil yang
diharapkan terhadap produksi hari ini:

```text
Restore selesai: 42 tabel, 37 migrasi tercatat.
TD-014       : dilewati (kolom sudah `date`), invariant diverifikasi
migrate deploy: 44 tabel, 38 migrasi
Backfill     : dilewati (marker COMPLETED), RBAC siap 22 role / 53 keanggotaan
Validasi     : Student clone == Student produksi (840)
Produksi     : identik sebelum & sesudah
```

Jumlah `User` clone sengaja satu lebih banyak dari produksi: akun uji lokal
ditambahkan oleh `scripts/ensure-local-test-user.ts`. Itu dilaporkan sebagai
catatan, bukan kegagalan.

Dua tahap yang dulu wajib — repair tanggal legacy dan backfill RBAC — kini
normalnya **dilewati** karena keduanya sudah permanen di produksi. Keduanya
tetap ada di repositori dan akan berjalan otomatis bila sebuah dump lama
memerlukannya; lihat dua bagian di atas.

Jangan menambal kegagalan migrasi dengan `db push --force-reset` atau migrasi
baru. Bila `migrate deploy` gagal, laporkan pesan aslinya — itu menandakan drift
atau migrasi hilang, bukan masalah clone.

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
→ bootstrap lokal (npm run db:bootstrap:local)
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
Clone belum pernah dibuat. Jalankan `npm run db:prodclone:refresh`.

**Migrasi gagal**
Jangan reset. Baca pesan aslinya, audit datanya di clone, lalu laporkan.

**`cannot cast type date to time without time zone`**
Gejala lama dari tahap TD-014 yang menjalankan skrip repair pra-migrasi terhadap
dump yang kolomnya sudah bertipe `date`. Sudah diperbaiki: status repair kini
ditentukan dari tipe kolom nyata. Bila pesan ini muncul lagi, berarti
`lib/legacy-date-repair.ts` membaca tipe yang berbeda dari yang dipakai skrip —
periksa itu, jangan meng-comment SQL-nya.

**`Backfill legacy-access-backfill-v1 sudah COMPLETED`**
Gejala lama dari tahap bootstrap yang selalu memaksa `--apply`. Sudah diperbaiki:
refresh membaca marker `RbacMigration` dan melewati backfill bila sudah
COMPLETED. Penolakan kontrak backfill itu sendiri benar dan tidak boleh
dilemahkan.

**DATABASE_URL salah**
Pembungkus akan menolak dengan menyebut peran, file, dan nama database yang
ditemukan. Perbaiki file peran yang disebut, bukan guard-nya.

**Port bentrok**
Clone memakai 5434 karena 5432 milik PostgreSQL 15 Windows dan 5433 dipakai
container proyek lain. Aplikasi tetap di 3000; `dev:local` dan `dev:prodclone`
tidak dapat berjalan bersamaan pada port yang sama.
