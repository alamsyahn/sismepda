# RBAC cutover runbook

Prosedur bergerbang untuk memindahkan produksi dari otorisasi flag legacy ke
RBAC. Setiap fase adalah gerbang keras: perintah yang sukses TIDAK mengizinkan
fase berikutnya sebelum hasilnya dibaca ulang dan cocok dengan target yang
diharapkan. Pada hasil database/migrasi/data/aplikasi yang tidak diharapkan:
berhenti, biarkan aplikasi lama dan database tetap hidup, laporkan bukti.

Migrasi rilis ini **sepenuhnya additive**. Tidak ada kolom otorisasi legacy yang
didrop; kontraksi adalah proyek terpisah (lihat `docs/architecture/rbac.md`).

## Prasyarat

- Repositori bersih pada commit yang telah direview.
- `.env.production` ada (mode `600`, tidak ter-track), dibuat dari
  `.env.production.example`.
- `AUTH_SECRET` adalah nilai deployment lama. Mengganti nilai ini membatalkan
  seluruh sesi aktif; lihat [Kontinuitas sesi](#kontinuitas-sesi).
- Backup terverifikasi dari fase 1 tersimpan di luar repositori.

Perintah produksi selalu menyertakan kedua berkas compose secara eksplisit agar
attachment edge tidak bergantung pada presedensi environment-file:

```bash
export COMPOSE="docker compose -f compose.yaml -f compose.edge.yaml --env-file .env.production"
```

## 1. Backup terverifikasi

Backup diambil langsung terhadap database target, bukan lewat UI aplikasi.
Arsip lewat UI bersifat data-only dan mengecualikan riwayat migrasi, sehingga
tidak cukup sebagai titik pemulihan cutover.

```bash
BACKUP="/var/backups/sismepda/pre-rbac-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --dbname "$DATABASE_URL" --format=custom --no-owner --no-privileges --file "$BACKUP"
test -s "$BACKUP"
pg_restore -l "$BACKUP" > /tmp/backup.toc && test -s /tmp/backup.toc
```

Ketiga pemeriksaan wajib lolos. Catat path dan ukuran arsip. Jangan menimpa
backup sebelumnya.

## 2. Maintenance: hentikan tulisan legacy

Hentikan rute tulisan ke aplikasi lama sebelum langkah berikutnya. Backfill
final pada fase 5 membaca kondisi database **final yang sudah dibekukan**;
selama aplikasi lama masih menerima tulisan, hasil backfill bisa kedaluwarsa
begitu selesai.

## 3. Migrasi additive

```bash
$COMPOSE build migrate app
$COMPOSE --profile migration run --rm -T migrate npx prisma migrate status
$COMPOSE --profile migration run --rm -T migrate npx prisma migrate deploy
```

`migrate status` dapat mengembalikan exit code nonzero semata-mata karena ada
migrasi pending; bedakan itu dari galat koneksi atau lineage.

Hanya `prisma migrate deploy` yang dipakai di produksi. **Jangan** gunakan
`prisma migrate dev`, `prisma db push`, atau `prisma migrate reset` — ketiganya
ada di `package.json` hanya untuk pengembangan lokal (`npm run db:migrate:local`,
`npm run db:setup:local`).

Karena migrasi bersifat additive, aplikasi lama tetap valid terhadap skema baru
pada titik ini.

## 4. Seed registry dan template

```bash
$COMPOSE --profile migration run --rm -T migrate npx prisma db seed
```

Seed bersifat idempoten dan upsert-only. Seed **tidak** menjalankan backfill
legacy dan **tidak** menulis marker readiness — keduanya dikunci oleh
`tests/deployment-contract.test.ts`. Karena itu start/deploy normal tidak pernah
memulihkan grant yang sudah sengaja dicabut admin.

## 5. Backfill legacy one-time

Dijalankan sekali, eksplisit, terhadap kondisi database final yang dibekukan.

Dry-run lebih dulu (default, tanpa tulisan):

```bash
$COMPOSE --profile migration run --rm -T migrate npx tsx prisma/rbac-backfill-legacy.ts
```

Terapkan hanya setelah keluaran dry-run dibaca dan nama database dikonfirmasi:

```bash
$COMPOSE --profile migration run --rm -T migrate \
  npx tsx prisma/rbac-backfill-legacy.ts --apply --database=sismepda
```

`--apply` menolak berjalan tanpa `--database=<nama>`, dan nama itu dicocokkan
dengan `current_database()`. `.env.production` yang salah target akan gagal
dengan `REFUSED`, bukan menulis ke database lain.

**Dry-run lama tidak boleh diasumsikan masih valid.** Bila skema additive sudah
terpasang sementara aplikasi lama masih menerima tulisan, jalankan ulang dry-run
terhadap kondisi final yang dibekukan sebelum `--apply`. Drift sejak rehearsal
membuat hasil sebelumnya tidak representatif.

## 6. Verifikasi parity

Sebelum menjalankan image baru, baca ulang hasilnya:

```bash
$COMPOSE --profile migration run --rm -T migrate npx prisma migrate status
```

Tuntut:

- setiap migrasi selesai, nol baris rolled-back;
- jumlah akun tidak berubah dibandingkan baseline fase 1;
- minimal satu pemegang `system_admin` aktif;
- pemegang role hasil backfill cocok dengan flag legacy sumbernya.

Bila parity berbeda tanpa penjelasan: berhenti, jangan jalankan aplikasi baru.

## 7. Readiness

Readiness bukan flag manual. `lib/rbac-readiness.ts` menurunkannya dari kondisi
database nyata:

| Kondisi | State |
| --- | --- |
| marker backfill `COMPLETED` | `ready` |
| tidak ada marker, nol akun (bootstrap segar) | `ready` — `fresh-database` |
| tidak ada marker, ada akun | `not-ready` — `backfill-missing` |
| marker `RUNNING`/`FAILED` | `not-ready` |
| marker dengan key tak dikenal | `error` (fail closed) |

Saat readiness belum terpenuhi, operasi terproteksi **gagal tertutup**. Tidak
ada fallback ke otorisasi legacy.

## 8. Jalankan image RBAC

```bash
$COMPOSE up -d app
$COMPOSE ps
$COMPOSE logs --tail=200 app
```

Jangan hentikan aplikasi lama. Aplikasi lama tetap jalur rollback hidup sampai
smoke test lolos.

## 9. Security smoke test

Gunakan alur autentikasi publik nyata; HTTP 200 anonim bukan uji autentikasi.
Verifikasi dengan akun nyata:

- login berhasil dan permission yang diresolusi sesuai harapan;
- halaman `/pengaturan/pengguna`, `/pengaturan/akses`, `/pengaturan/audit`
  dapat diakses pemegang hak dan menolak (HTTP 307) aktor tanpa hak;
- mutasi authority menolak request lintas-origin;
- tidak ada galat Prisma/database di log.

Utamakan pemeriksaan read-only. Jangan membuat atau menghapus record hanya untuk
membuktikan kesehatan deployment.

## 10. Buka kembali

Buka akses hanya setelah smoke test lolos. Pulihkan routing edge ke alias
`sismepda-new-app:3000` sesuai `docs/operations/deployment.md`.

## Rollback

Pernyataan "redeploy saja image lama" tidak berlaku di sini.

**Sebelum ada perubahan permission RBAC:** aplikasi lama masih valid terhadap
skema additive, asalkan parity dan integritas terverifikasi. Ini jalur rollback
paling murah dan alasan aplikasi lama dibiarkan hidup.

**Setelah ada perubahan permission RBAC:** aplikasi lama **tidak otomatis
aman**. Flag boolean legacy tidak dapat merepresentasikan kondisi yang kini
mungkin ada:

- akun tanpa role sama sekali (zero-role);
- akun dengan beberapa role sekaligus (multi-role);
- kewenangan RBAC yang sudah dicabut eksplisit.

Menjalankan aplikasi lama terhadap kondisi itu berarti aplikasi lama membaca
flag yang sudah tidak mewakili kebenaran otorisasi — berpotensi memulihkan akses
yang sengaja dicabut.

Rollback yang aman menuntut salah satu dari:

1. image aplikasi sebelumnya yang sudah kompatibel RBAC; **atau**
2. forward fix pada image baru; **atau**
3. maintenance eksplisit plus rekonsiliasi/restore snapshot, dengan pengakuan
   tertulis bahwa tulisan setelah titik backup akan hilang.

## Kontinuitas sesi

`AUTH_SECRET` menentukan kelangsungan sesi. Memakai kembali nilai lama membuat
sesi yang ada tetap valid melintasi rollout; menggantinya membatalkan semua sesi
dan memaksa seluruh pengguna login ulang.

Cookie ber-scope host tidak berpindah ke hostname baru meski `AUTH_SECRET`
dipakai ulang. Bila cutover juga mengganti hostname, pengguna harus login di
host baru.

Sesi yang valid membawa identitas, bukan permission: permission diresolusi per
request dari keanggotaan role, sehingga pencabutan hak berlaku tanpa menunggu
sesi kedaluwarsa.

## Restore dan akses

Memulihkan database berarti memulihkan juga state akses: keanggotaan role,
permission, dan kolom `active`. Restore dapat menghidupkan kembali akun yang
sudah dinonaktifkan dan memulihkan grant yang sudah dicabut.

Karena itu restore menuntut review keamanan sebelum akses dibuka kembali:

- daftar pemegang `system_admin` setelah restore;
- akun yang kembali `active` padahal sebelumnya dinonaktifkan;
- grant yang muncul kembali setelah sebelumnya dicabut.

Prosedur dan guard restore ada di `docs/operations/backup-restore.md`.
