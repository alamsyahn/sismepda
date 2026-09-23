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

Diverifikasi setelah migrasi media legacy selesai (commit `478fcc4`).
Produksi berada dalam **masa observasi pasca-migrasi**: jalur baca memakai
penyimpanan, byte legacy tetap menjadi fallback, dan tidak ada pembersihan
destruktif yang dijalankan.

| Aspek | Kondisi |
| --- | --- |
| SSH | `smpn2`, app di `/srv/apps/sismepda` |
| Compose | `deploy.yaml` di host, **tidak ada di Git**; digabung `compose.media.yaml` dari repo |
| Volume database | bind mount `/var/lib/sismepda/postgresql` (tidak berubah oleh rollout) |
| Volume media | **AKTIF** — named volume `sismepda_media_data` → `/app/media` |
| `MEDIA_STORAGE_ROOT` | **AKTIF** — `/app/media` di container yang berjalan |
| Runtime user app | `nextjs` (uid 1001), pemilik `/app/media` |
| Byte media legacy | ±7,1 MB di `bytea`, **dipertahankan** sebagai fallback (22 baris) |
| Kunci media kanonik | 40 baris — 18 dari unggahan normal, 22 dari migrasi legacy |
| Berkas volume | 43 (40 direferensikan + 3 yatim, lihat TD-020) |
| Migrasi belum diterapkan | tidak ada |

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
- **Kepemilikan direktori.** `Dockerfile` membuat `/app/media` **beserta setiap
  sub-direktori scope** lalu men-`chown -R` ke `nextjs:nodejs` sebelum
  `USER nextjs`, sehingga volume kosong yang di-mount mewarisi kepemilikan itu.
  Tidak diperlukan `chmod 777` maupun root saat runtime.
- **Migrator tidak boleh berjalan sebagai root.** Service `migrate` di
  `compose.media.yaml` memakai `user: "1001:1001"`. `storeMedia()` membuat
  direktori scope secara lazy lewat `mkdir -p`, jadi penulis pertama ke sebuah
  scope-lah yang menentukan kepemilikannya. Migrator root membuat scope
  `root:root`, dan aplikasi uid 1001 lalu gagal menulis unggahan baru ke scope
  itu dengan `EACCES` — akar `/app/media` yang sudah benar tidak menolong.

### Perbaikan kepemilikan direktori scope yang telanjur milik root

Berlaku untuk volume yang sudah pernah disentuh migrator root **sebelum**
perbaikan di atas. Image baru hanya mencegah kasus baru; direktori yang sudah
ada di dalam named volume tidak ikut berubah saat image di-build ulang, karena
isi volume menimpa isi image pada mount point.

Diagnosis (aman, hanya membaca):

```sh
docker exec sismepda-app-1 find /app/media -maxdepth 2 -type d -exec ls -ld {} \;
docker exec sismepda-app-1 sh -c 'touch /app/media/euks/hero-logo/.w && rm /app/media/euks/hero-logo/.w'
```

Direktori scope mana pun yang tampil `root root` akan menolak unggahan baru.
Perbaikannya memperbaiki metadata kepemilikan saja dan **tidak menyentuh satu
byte pun isi berkas**:

```sh
docker exec -u 0 sismepda-app-1 chown -R nextjs:nodejs /app/media
```

Jangan memakai `chmod 777`, jangan menghapus berkas, dan jangan membuat ulang
volume. Verifikasi ulang dengan perintah diagnosis di atas, lalu buktikan lewat
satu unggahan nyata.

### Jangan pernah menghapus volume media

`docker compose down -v`, `docker volume rm`, `docker volume prune`, dan
`--renew-anon-volumes` menghapus media produksi. Alur deploy tidak memakai satu
pun dari perintah tersebut, dan hal itu dikunci oleh test statis di
`tests/rollout-preparation.test.ts`. Aktivasi memakai `up -d`, yang membuat ulang
container tanpa menyentuh named volume.

### Backup

Backup set membaca akar media dari container (`printenv MEDIA_STORAGE_ROOT`),
bukan dari jalur yang ditulis ulang di skrip, sehingga backup selalu mengikuti
konfigurasi yang sama dengan aplikasi. Akar media tidak pernah ditebak.

Bila variabel itu tidak diset, arti keadaannya bergantung pada apakah media
storage pernah aktif — dan itu diputuskan dari beberapa fakta sekaligus
(env runtime, keberadaan mount, dan jumlah baris berkunci media di database),
bukan dari env saja. Pada produksi pre-media hasilnya adalah backup bootstrap
yang sah; pada produksi yang sudah memakai media hasilnya adalah `ABORT`.
Keadaan yang tidak dapat dipastikan selalu `ABORT`.

## Dua kasus yang tidak boleh dicampur

Runbook PHASE 0–8 di bawah menjelaskan **rollout media pertama**, yang hanya
terjadi sekali.

```text
ROLLOUT MEDIA PERTAMA (sekali seumur sistem)
  preflight → backup bootstrap (DB saja) → deploy kode media-capable
  → skema aditif → aktifkan volume → verifikasi media
  → BACKUP LENGKAP DB+media → verifikasi → BERHENTI
  → (jauh kemudian) pertimbangkan migrasi legacy
```

```text
DEPLOYMENT NORMAL (setelah media aktif)
  preflight → backup DB+media → verifikasi → deploy
```

Perbedaannya bukan gaya penulisan: pada kasus pertama dump database memang sudah
memuat seluruh media; pada kasus kedua tidak, dan backup tanpa arsip media
adalah backup yang tidak lengkap. Tooling menentukan sendiri kasus mana yang
berlaku dari keadaan produksi, dan menolak melanjutkan bila keadaan itu ambigu.

## PHASE 0 — Prasyarat

```bash
npm run deploy:preflight
```

Read-only terhadap produksi. Keluar non-nol dan mencetak `NOT READY` bila ada
blocker.

Pada rollout media **pertama**, `NOT READY` dengan blocker tunggal
`MEDIA_STORAGE_ROOT` adalah keadaan yang diharapkan, bukan penghalang: preflight
menilai produksi yang sedang berjalan, dan overlay media baru tiba di tengah
`deploy:prod`. `deploy:prod` menjalankan gerbangnya sendiri dan tidak membaca
hasil preflight ini. Untuk rollout berikutnya, `READY` tetap syarat.

**Working tree harus bersih, termasuk berkas untracked.** `deploy:prod` menolak
berjalan bila ada satu saja berkas untracked — termasuk `.backup-sets/` yang
baru saja dibuat PHASE 1. Direktori itu kini ter-ignore; bila muncul artefak
untracked lain, selesaikan dulu, jangan hapus dengan asumsi.

## PHASE 1 — Backup sebelum rollout (mode bootstrap)

```bash
npm run backup:production -- --dry-run   # tinjau rencana
npm run backup:production
```

**Pada rollout pertama set ini sengaja TIDAK memuat `media.tar.gz`,** dan itu
benar. Sebelum media storage aktif, seluruh media yang ada masih tersimpan
sebagai `bytea` di dalam database, sehingga dump database sudah memuat
semuanya. Manifest akan berbunyi:

```json
{ "backupMode": "pre-media-bootstrap", "complete": false, "media": null }
```

`complete: false` bukan peringatan bahwa backup gagal; itu pernyataan jujur
bahwa set ini bukan set DB+media. Set bootstrap **tidak** memenuhi syarat
migrasi media legacy (lihat PHASE 6).

Mode ini tidak dipilih operator dan tidak dapat dipaksakan lewat flag. Tooling
menyimpulkannya dari keadaan produksi yang terbaca saat itu juga; bila keadaan
itu ambigu, backup dibatalkan. Setelah media aktif, mode bootstrap tidak akan
pernah terpilih lagi.

Pada deployment normal (media sudah aktif) set yang sama menghasilkan
`database.dump`, `media.tar.gz`, dan `manifest.json` dengan
`"backupMode": "complete"`. Bila arsip media gagal dibuat pada keadaan itu,
backup **abort** dan deploy tidak boleh dilanjutkan.

Untuk set lengkap, urutannya **database dulu, media kemudian**. Alasannya: alur tulis media adalah
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

**Smoke test menuntut sesi login sungguhan.** Seluruh route media produksi
berada di balik autentikasi, dan tidak ada akun uji khusus di produksi. Yang
membuktikan jalur ini bukan probe tulis ke volume — volume writable sudah
terbukti terpisah — melainkan
`unggah nyata → storeMedia → kunci di database → berkas di volume → route menyajikannya`.
Bila tidak ada sesi sah, berhenti dan minta operator login; jangan menebak
kredensial, membuat akun produksi, atau menaruh berkas manual ke volume.

Flow berdampak terkecil: operator login → `/profil` → unggah foto profil kecil
(slot `profile.user.photo`, maks 1 MB, jpeg/png/webp). Jangan memakai logo
sekolah, favicon, atau foto UKS/Sarpras untuk uji.

Unggahan baru **bukan** dual-write: `PUT /api/profile/photo` menulis
`photoKey` + `photoSize` + `photoMimeType` dan menyetel `photoData` ke `NULL`.
Jadi keadaan yang benar setelah smoke test adalah kunci terisi dengan bytea
kosong pada baris itu saja; baris legacy lain tidak tersentuh.

**CHECKPOINT.** `deploy:prod` mencetak status aktivasi media di akhir. Bila
media baru saja aktif, keluarannya berbunyi:

```text
MEDIA STORAGE AKTIF
BACKUP LENGKAP PASCA-AKTIVASI WAJIB DIBUAT
MIGRASI MEDIA LEGACY BELUM DIIZINKAN
```

Sampai titik ini belum ada byte legacy yang dipindahkan. Berhenti di sini aman
dan boleh berlangsung berhari-hari — dengan satu syarat: PHASE 5 dijalankan
lebih dulu. Sejak media aktif, unggahan baru hanya ada di volume dan belum
tercakup backup mana pun.

## PHASE 5 — Backup lengkap pertama (WAJIB)

Begitu volume media aktif, PostgreSQL berhenti menjadi satu-satunya sumber
kebenaran: setiap unggahan baru sejak PHASE 4 hanya ada di volume. Set bootstrap
dari PHASE 1 tidak memuatnya. Karena itu langkah ini wajib, bukan verifikasi
formalitas.

```bash
npm run backup:production
```

Set backup baru harus memuat berkas yang lahir dari smoke test PHASE 4. Ini
membuktikan media baru benar-benar masuk cakupan backup.

Verifikasi ulang set yang sudah jadi memakai **direktori lokal**, bukan jalur
server:

```bash
scp smpn2:/srv/backups/sismepda/sets/<setId>/{database.dump,media.tar.gz,manifest.json} <dir-lokal>/
npm run backup:production:verify -- <dir-lokal>
```

`--verify` membaca manifest dari filesystem lokal. Salinan manifest di
`.backup-sets/<setId>/` tidak cukup: ia hanya memuat `manifest.json`, sehingga
verifikasi melaporkan `database.dump`/`media.tar.gz` tidak ada. Jangan pakai
`media:backup:verify` untuk `media.tar.gz` milik set ini — format arsipnya
berbeda (lihat [media-storage](../architecture/media-storage.md)).

Bila smoke test belum dijalankan, set lengkap tetap terbentuk dan terverifikasi,
tetapi arsip medianya kosong (0 berkas). Tooling menandainya `media-empty` dan
`authorizeLegacyMediaMigration` menolak set itu sebagai dasar migrasi legacy.
Itu bukan kegagalan backup — dump database tetap sah dan lengkap untuk seluruh
media yang ada — melainkan pernyataan jujur bahwa jalur tulis storage baru belum
pernah dibuktikan di produksi. Jalankan smoke test, lalu buat set lengkap baru.

## PHASE 6 — Migrasi media legacy

**Tidak dijalankan otomatis oleh perintah deploy mana pun.** Ini tindakan
eksplisit terpisah.

**Prasyarat keras:** harus ada set backup terverifikasi dengan
`"backupMode": "complete"` yang dibuat **setelah** media storage aktif (PHASE 5).
Set `pre-media-bootstrap` dari PHASE 1 **tidak sah** untuk keperluan ini, karena
dibuat sebelum volume ada dan tidak memuat satu pun berkas media.

Alasannya konkret: migrasi legacy menulis berkas ke volume lalu memperbarui
referensi database. Bila langkah itu gagal di tengah, pemulihan menuntut
snapshot dari kedua sisi pada titik waktu yang sama. Set bootstrap hanya
memulihkan sisi database, dan akan mengembalikannya ke keadaan di mana volume
belum pernah ada.

`npm run backup:production -- --verify <direktori set>` mencetak kelayakan ini
secara eksplisit dan menolak set bootstrap untuk tujuan migrasi.

```bash
npm run media:migrate:production -- --dry-run   # nol tulisan
# tinjau keluaran, lalu — hanya setelah backup lengkap yang baru:
npm run media:migrate:production -- --apply --backup-set <direktori set lokal>
```

Migrasi bersifat idempoten dan dapat diulang: baris yang sudah punya kunci
dilewati, dan `bytea` **dipertahankan**.

### Jalur eksekusi produksi

`npm run media:migrate:local` menjalankan skrip yang sama terhadap database
development lokal dan **tidak dapat menyentuh produksi**: targetnya dipatok
`scripts/with-db.ts` ke `sismepda_dev`, dan database produksi berada di jaringan
Docker `internal=true` tanpa port yang dipetakan ke host. Tidak ada varian tanpa
sufiks target: satu-satunya jalur produksi adalah `media:migrate:production`,
yang berjalan lewat container migrator.

Perintah produksi menempuh jalur berikut, seluruhnya dari mesin operator:

```text
npm run media:migrate:production -- --dry-run
  → ssh smpn2
    → docker compose -f deploy.yaml -f compose.media.yaml --env-file /etc/sismepda/sismepda.env
      → --profile migration run --rm migrate      (container sekali-jalan)
        → DATABASE_URL produksi lewat jaringan `database` (tetap internal=true)
        → volume sismepda_media_data ter-mount di /app/media
          → npx tsx scripts/migrate-media.ts --dry-run
```

Container `migrate` adalah satu-satunya tempat yang sah: runner aplikasi adalah
build standalone Next **tanpa `tsx`**, sedangkan image migrator memuat `tsx`,
`scripts/`, `lib/`, dan Prisma client hasil generate. Sejak overlay media
memasang volume yang sama ke service `migrate`, migrator menulis ke penyimpanan
kanonik yang sama dengan yang dibaca aplikasi — bukan ke writable layer
container yang lenyap saat `--rm`.

**Mode wajib disebutkan.** Tanpa flag, perintah membatalkan dan mencetak
pemakaian; tidak ada default yang menulis.

| Perintah | Menulis | Gate backup |
|---|---|---|
| `-- --dry-run` | tidak | tidak diperlukan |
| `-- --verify` | tidak | tidak diperlukan |
| `-- --apply --backup-set <dir>` | ya | wajib, `authorizeLegacyMediaMigration` |

Sebelum menjalankan skripnya, jalur remote membatalkan bila: overlay media tidak
ada, skrip tidak ada di dalam image, `npx` tidak tersedia, atau `/app/media`
ternyata bukan mount (dibandingkan lewat device id direktori dan induknya).

**Prasyarat backup harus BARU.** Set yang dibuat sebelum gelombang unggahan
terakhir tidak sah untuk migrasi meski berstatus `complete`: memulihkannya akan
mengembalikan volume ke keadaan lama sementara database menunjuk kunci yang
lebih baru. Buat set baru, verifikasi dengan
`npm run backup:production:verify -- <direktori set lokal>`, lalu pakai
direktori itu untuk `--backup-set`.

**Berhenti** bila: gate backup menolak, jumlah kandidat skrip berbeda dari
inventaris SQL read-only, atau dry-run melaporkan `invalid`/`errors` bukan nol.

### Menguji jalur eksekusinya

```bash
docker build --target migrator -t sismepda-migrator:itest .
bash scripts/media-migration-integration-test.sh
```

Membangun image migrator nyata, menjalankannya terhadap database sekali pakai
dan volume media sementara, lalu membuktikan: skrip + `tsx` + `lib` ada di dalam
image, `/app/media` adalah mount, dry-run tidak mengubah baris maupun berkas,
migrasi sungguhnya menulis kunci + berkas, byte legacy tetap utuh, dan eksekusi
kedua melewati baris yang sudah berkunci. Tidak pernah menyentuh produksi.

## PHASE 7 — Verifikasi migrasi

```bash
npm run media:migrate:production -- --verify   # produksi, lewat migrator
npm run media:migrate:verify:local             # database lokal
```

Read-only. Melaporkan `total / migrated / valid / missing / mismatch /
legacy retained`. Rollout dianggap sehat bila `missing = 0`, `mismatch = 0`,
dan `legacy retained` masih sama dengan jumlah baris bermedia.

## PHASE 8 — Selesai

Catat set backup terakhir dan commit yang berjalan. Byte legacy tetap tinggal.
Pemensiunan `bytea` adalah phase terpisah di masa depan, dan baru boleh
dipertimbangkan setelah backup media berjalan terjadwal.

### Masa observasi pasca-migrasi

Migrasi media legacy sudah dijalankan di produksi pada commit `478fcc4`:
22 kandidat dipindahkan, 0 gagal, checksum `bytea` legacy cocok dengan berkas
hasil migrasi pada seluruh 22 baris. Produksi kini berada dalam masa observasi
dengan kontrak berikut:

| Aspek | Keadaan selama observasi |
| --- | --- |
| Jalur baca | penyimpanan kanonik (`resolveMedia` mencoba kunci lebih dulu) |
| Byte legacy `bytea` | **dipertahankan** sebagai fallback bila berkas tidak terbaca |
| Backup | set lengkap = database + volume media, keduanya terverifikasi |
| Pembersihan destruktif | tidak ada — tanpa `bytea` cleanup, tanpa garbage collection |

Set backup yang mengapit migrasi:

| Peran | Set | Isi |
| --- | --- | --- |
| Sebelum migrasi | `backup-2026-09-15T063648Z` | 21 berkas media, 18 baris berkunci |
| Sesudah migrasi | `backup-2026-09-15T064116Z` | 43 berkas media, 40 baris berkunci |

Masa observasi tidak punya tanggal berakhir otomatis. Pemensiunan `bytea`
menuntut keputusan manusia yang terpisah, bukan jadwal.

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
   npm run media:migrate:verify:local
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

### F. Aktivasi gagal (build/migrasi lolos, container baru tidak sehat)

Urutan yang dimaksud: backup bootstrap sukses → `git merge` sukses → build
sukses → migrasi aditif sukses → aktivasi/health check gagal.

1. Rollback aplikasi ke image sebelumnya bila perlu.
2. **Biarkan skema aditif.** Kolom baru nullable; kode lama tidak menyebutnya.
3. Legacy `bytea` tetap utuh dan tetap melayani seluruh gambar.
4. Tidak ada migrasi media legacy yang berjalan — memang belum diizinkan.
5. **Tidak perlu restore database.** Kegagalan ini tidak mengubah data;
   restore destruktif justru menambah risiko tanpa manfaat.
6. Set backup bootstrap dari PHASE 1 tetap tersimpan sebagai jaring pengaman.

Keadaan akhir sama dengan sebelum rollout, kecuali kolom nullable tambahan.

### G. Aktivasi sukses, backup lengkap PHASE 5 gagal

Ini keadaan paling berbahaya dalam rollout, dan harus diperlakukan sebagai
**rollout degraded — belum selesai**, bukan sebagai kegagalan kecil.

Sebabnya: media storage sudah aktif, sehingga unggahan baru mendarat di volume
dan **tidak** tercakup set bootstrap PHASE 1. Untuk berkas-berkas itu, saat ini
tidak ada backup sama sekali.

Tindakan:

1. **Jangan** jalankan migrasi media legacy. Gerbang PHASE 6 memang menolaknya.
2. Perbaiki penyebab kegagalan backup, lalu ulangi PHASE 5 sampai berhasil.
3. Sampai backup lengkap berhasil, minimalkan unggahan baru. Lakukan rollout
   pada jam sepi (di luar jam sekolah) supaya jendela ini sependek mungkin.
4. Legacy `bytea` tetap menjadi jaring pengaman untuk seluruh media LAMA; yang
   belum terlindungi hanyalah unggahan setelah aktivasi.
5. Rollback aplikasi **tidak** memperbaiki keadaan ini dan dapat memperburuknya:
   berkas yang sudah telanjur ditulis ke volume akan menjadi tidak terjangkau
   oleh kode lama. Perbaiki backup, jangan mundur.

SISMEPDA tidak memiliki maintenance mode, dan rollout ini bukan alasan untuk
membuatnya. Pemilihan jam sepi sudah memadai untuk beban sekolah.

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
9. Verifikasi referensi media dengan `npm run media:migrate:verify:local`.
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
