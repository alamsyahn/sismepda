# Penyimpanan Media

Dokumen kanonik untuk penyimpanan berkas biner milik pengguna: foto profil,
logo aplikasi, favicon, media E-UKS, dan foto Sarpras.

Kebijakan **ukuran dan tipe** unggahan tidak dibahas di sini — itu milik
[`uploads.md`](./uploads.md). Dokumen ini hanya menjawab: setelah sebuah berkas
lolos validasi, di mana byte-nya disimpan dan bagaimana ia dibaca kembali.

## Keadaan saat ini: dua sumber, satu jalur baca

Secara historis seluruh media SISMEPDA disimpan sebagai kolom `Bytes`
(PostgreSQL `bytea`) di dalam baris yang memilikinya. Pendekatan itu sederhana
dan tidak akan pernah kehilangan berkas, tetapi tidak berskala: setiap dump
database membawa seluruh gambar, dan `sismepda_prodclone` ikut membengkak
setiap kali di-refresh. Dengan rencana ratusan foto siswa, database akan
didominasi byte gambar yang tidak pernah di-query.

Sistem kini berada di fase **EXPAND**:

- Setiap model bermedia punya kolom kunci baru (`photoKey`, `logoKey`,
  `appLogoKey`, `faviconKey`, `mediaKey`) berdampingan dengan kolom bytea lama.
- Kolom bytea **masih ada dan masih terisi**. Tidak ada satu byte pun yang
  dihapus.
- Unggahan baru menulis ke penyimpanan berkas dan **tidak** menulis bytea.
- Pembacaan memakai satu helper yang memilih sumber secara otomatis.

Konsekuensinya sebuah baris bisa berada di salah satu dari tiga keadaan, dan
ketiganya sah:

| Keadaan | Kunci | Bytea | Sumber yang dipakai |
| --- | --- | --- | --- |
| Belum dimigrasikan | kosong | ada | bytea legacy |
| Sudah dimigrasikan | ada | ada | berkas |
| Unggahan baru | ada | kosong | berkas |

## Lapisan

```text
lib/media-keys.ts           kunci logis: pembuatan + validasi (murni, tanpa I/O)
lib/server-media-storage.ts backend penyimpanan (filesystem) + storeMedia()
lib/server-media.ts         resolveMedia(): pemilihan sumber + fallback legacy
```

`lib/media-keys.ts` tidak mengimpor `node:fs` maupun Prisma, sehingga aman
dipakai di mana saja. Kedua berkas `server-*` adalah server-only; komponen klien
hanya boleh mengimpor tipenya (`import type`) — lihat batasan bundle di
[`overview.md`](./overview.md).

### Kunci media

Database menyimpan **kunci logis**, bukan path filesystem:

```text
users/avatar/3f2a....jpg
branding/app-logo/9c81....png
euks/hero/1d4e....webp
sarpras/item/77ab....jpg
students/photo/....jpg        (dicadangkan; belum dipakai)
```

Kunci dibentuk sepenuhnya di server dari UUID acak plus ekstensi yang diturunkan
dari **MIME hasil deteksi**, bukan dari nama berkas kiriman. Nama asli tidak
pernah menyentuh filesystem, sehingga tidak ada jalur di mana input pengguna
dapat mengarahkan penulisan.

Validasi kunci menolak `..`, path absolut, backslash, NUL, scope tak dikenal,
dan panjang berlebih. Validasi dijalankan **sebelum** path diselesaikan, dan
hasil resolusi diperiksa ulang harus berada di bawah akar penyimpanan.

Menyimpan kunci logis (bukan path absolut) berarti memindahkan direktori media
atau berpindah ke object storage kelak tidak memerlukan penulisan ulang
database.

### Backend penyimpanan

`MediaStorage` adalah antarmuka dengan `put`/`get`/`exists`/`size`/`delete`.
Implementasi saat ini `FilesystemMediaStorage`. Seluruh operasi berkas aplikasi
melewati antarmuka ini — tidak ada route yang memanggil `node:fs` langsung.

Penulisan bersifat atomik (tulis `.tmp` → `rename`), sehingga pembaca tidak
pernah melihat berkas separuh tertulis walau proses mati di tengah jalan.

Object storage (S3/R2) **belum** diimplementasikan dan sengaja tidak
diimplementasikan sekarang. Antarmukanya dibuat async dan berbasis kunci agar
penambahan backend lain kelak tidak menyentuh route mana pun.

## MEDIA_STORAGE_ROOT

Akar penyimpanan ditentukan variabel lingkungan `MEDIA_STORAGE_ROOT`.

- **Development**: boleh dikosongkan. Bila kosong, akar dipilih dari peran
  database yang aktif (`SISMEPDA_DB_ROLE`, disuntikkan `scripts/with-db.ts`):

  | Perintah | Akar media |
  | --- | --- |
  | `npm run dev:local` | `.media/local/` |
  | `npm run dev:prodclone` | `.media/prodclone/` |
  | `npm run dev` (tanpa peran) | `.media/` |

  Pemisahan ini disengaja: media hasil sinkronisasi produksi tidak boleh
  bercampur dengan media uji lokal, karena setelah tercampur tidak ada cara
  memisahkannya lagi. Keputusannya ada di `lib/media-roots.ts` sebagai fungsi
  murni, bukan bergantung pada operator mengingat mengekspor variabel.

  Seluruh `.media/` masuk `.gitignore`; media runtime tidak pernah di-commit.
- **Test**: setiap test mengarahkan variabel ini ke direktori sementara. Test
  tidak boleh menulis ke `.media/` maupun direktori pengguna.
- **Produksi**: `/app/media`, dipasangkan ke volume Docker `media`.

Tidak ada path yang di-hardcode di business logic.

## Docker

`compose.yaml` (dipakai pengembangan/uji) mendeklarasikan volume bernama `media`
yang dipasang di `/app/media`. Ini **wajib**: tanpa volume, media hanya berada di
writable layer container dan akan hilang pada setiap `--force-recreate`.

Produksi tidak memakai `compose.yaml`. Ia menjalankan `deploy.yaml` milik host
(di luar Git) yang digabung dengan overlay `compose.media.yaml` dari repo:

```bash
docker compose -f deploy.yaml -f compose.media.yaml ...
```

Overlay itulah yang menetapkan `MEDIA_STORAGE_ROOT: /app/media` dan volume
bernama eksplisit `sismepda_media_data`. Nama eksplisit dipakai agar identitas
volume tidak ikut berubah saat nama project Compose atau path direktori berubah.
Rincian operasionalnya ada di
[runbook rollout media](../operations/media-rollout.md).

Dockerfile membuat `/app/media` dan meng-chown-nya ke `nextjs` sebelum `USER
nextjs`. Volume Docker yang masih kosong mewarisi kepemilikan dari direktori
mount point; tanpa langkah itu proses uid 1001 tidak dapat menulis unggahan.

Volume database tidak disentuh, tidak diganti nama, dan topologi PostgreSQL
tidak berubah.

## Alur unggah

1. Route memvalidasi berkas lewat kebijakan unggah yang sudah ada
   (Upload Slot + `assertDetectedType`). Tidak ada batas ukuran baru yang
   bersaing; storage layer tidak pernah melonggarkan validasi.
2. `storeMedia(scope, bytes, mimeType)` membuat kunci server-side, menulis
   berkas, lalu **memverifikasi ukuran hasil tulis**. Berkas yang tidak utuh
   dibersihkan dan operasi dianggap gagal.
3. Baru setelah berkas tertulis, database diperbarui dengan kunci + metadata.

Urutan ini tidak boleh dibalik. Menulis referensi database lebih dulu berarti
ada jendela waktu ketika database menunjuk berkas yang tidak ada.

### Mengganti media

Berkas lama **tidak** dihapus lebih dulu. Unggah baru → verifikasi → perbarui
referensi. Berkas lama menjadi orphan dan dibiarkan; ia tidak merugikan selain
memakai ruang, sedangkan menghapusnya lebih awal berisiko kehilangan data bila
langkah berikutnya gagal.

Pembersihan orphan adalah pekerjaan fase mendatang. Saat ini **tidak ada**
garbage collection otomatis, dan itu disengaja.

### Menghapus media

Referensi database diperbarui lebih dulu; kegagalan menghapus berkas tidak boleh
membatalkan perubahan database. Byte legacy tidak ikut dihapus.

## Fallback legacy

`resolveMedia()` memilih sumber dengan urutan:

1. Ada kunci dan berkasnya terbaca → pakai berkas.
2. Kunci kosong, atau berkas hilang/kunci tidak valid, tetapi bytea ada →
   pakai bytea.
3. Keduanya tidak ada → `null`, dan route berperilaku seperti sebelumnya
   (404 atau placeholder).

Poin 2 penting: berkas hilang **tidak** menghasilkan error. Selama byte legacy
masih ada, gambar tetap tersaji. Inilah yang membuat migrasi dapat dibatalkan.

Poin 3 adalah keadaan terburuk — kunci ada, berkas hilang, byte legacy tidak
ada. Perilakunya tetap terkendali: route mengembalikan 404 seperti record yang
memang belum bergambar, dan halaman tidak ikut gagal. Satu gambar hilang tidak
boleh menjatuhkan seluruh aplikasi.

Ketika berkas berkunci tidak terbaca, `resolveMedia()` menulis peringatan ke log
server yang menyebut apakah byte legacy menyelamatkannya. Yang dicatat hanya
**kunci logis**; jalur absolut penyimpanan tidak pernah masuk log dan tidak
pernah dikirim ke klien.

Kunci yang tidak valid tidak pernah menyentuh filesystem, sehingga media
endpoint tidak dapat dipakai membaca berkas sembarang di server.

Aplikasi **tidak** memerlukan migrasi data untuk berjalan. Produksi yang seluruh
medianya masih di bytea akan bekerja persis seperti sebelumnya.

## Prosedur migrasi

```bash
npm run media:migrate -- --dry-run   # inspeksi: kandidat, kategori, total byte
npm run media:migrate                # pindahkan (memakai DATABASE_URL saat ini)
npm run media:migrate:local          # eksplisit ke database development lokal
```

Sifat script (`scripts/migrate-media.ts`):

- **Tidak pernah menghapus byte legacy.** Hanya mengisi kolom kunci + ukuran.
- **Idempoten dan resumable**: record yang sudah punya kunci dilewati, jadi
  script boleh dijalankan berkali-kali dan boleh dihentikan di tengah.
- **Aman saat gagal**: berkas ditulis dan diverifikasi lebih dulu; kegagalan
  menulis tidak pernah mengubah database.
- **Toleran**: satu record rusak tidak menghentikan sisanya; kegagalan
  dilaporkan sebagai ringkasan dan kode keluar non-nol.
- Dry-run tidak menulis berkas maupun baris.

Urutan penerapan yang benar: jalankan migrasi Prisma (menambah kolom), deploy
aplikasi (kunci kosong → fallback bytea, semuanya tetap bekerja), baru jalankan
script migrasi data kapan pun setelahnya. Tidak ada langkah yang harus terjadi
dalam jendela pemeliharaan yang sama.

### Rollback

Karena byte legacy tetap utuh, rollback berarti mengosongkan kolom kunci — atau
sekadar men-deploy ulang versi aplikasi sebelumnya. Tidak ada data yang perlu
dipulihkan dari backup.

Kolom bytea **baru boleh** dihapus setelah: seluruh record produksi punya kunci,
backup media terverifikasi, aplikasi produksi stabil, dan persetujuan eksplisit
diberikan. Itu fase CONTRACT tersendiri.

## Backup

Arsitektur ini mengubah asumsi backup secara mendasar:

> Backup PostgreSQL saja **bukan lagi** backup aplikasi yang lengkap.

Backup SISMEPDA yang lengkap setelah pemisahan media adalah:

```text
backup PostgreSQL  +  backup media storage
```

Selama byte legacy masih ada, dump database masih memuat semua media lama,
sehingga belum ada risiko akut untuk media lama. Risiko itu nyata untuk media
yang diunggah **setelah** deploy — media tersebut hanya ada di volume.

### Perintah

```bash
npm run media:backup:create                  # arsip seluruh MEDIA_STORAGE_ROOT
npm run media:backup:verify -- <arsip>       # baca ulang + cocokkan checksum
npm run media:backup:restore-test -- <arsip> # restore ke direktori sementara
```

Arsip berformat `tar.gz` dan diberi nama `media_<YYYY-MM-DD_HH-MM-SS>.tar.gz`
(UTC). Default lokasinya `.media-backups/` — **di luar** pohon media, karena
arsip yang disimpan di dalam sumbernya akan membackup dirinya sendiri dan
tumbuh setiap kali dijalankan. Lokasi dapat diubah dengan `MEDIA_BACKUP_DIR`.

Backup bersifat baca-saja terhadap media: ia tidak pernah mengubah, memindahkan,
atau menghapus berkas sumber. Symlink dilewati, bukan diikuti, agar arsip tidak
dapat menyedot berkas arbitrer dari luar pohon media. **Tidak ada retensi
otomatis**: arsip lama tidak pernah dihapus sendiri: menghapus backup memerlukan
kebijakan retensi eksplisit, bukan efek samping.

### Manifest

Setiap arsip memuat `manifest.json` di puncaknya:

| Field | Isi |
| --- | --- |
| `version` | versi format manifest |
| `createdAt` | ISO-8601 UTC |
| `runId` | pengenal run, sama dengan stempel waktu pada nama arsip |
| `sourceId` | nama basis akar + hash pendek — **bukan** jalur absolut |
| `fileCount` / `totalBytes` | jumlah dan ukuran berkas |
| `files[]` | kunci media, ukuran, dan SHA-256 per berkas |

Manifest sengaja tidak memuat kredensial, variabel lingkungan, maupun jalur
absolut server.

### Verifikasi

`media:backup:verify` tidak berhenti pada "berkas ada". Ia membaca daftar isi
arsip, menolak entri berjalur tidak aman (absolut, `..`, backslash, di luar dua
puncak yang sah), mengekstrak seluruh isi ke direktori sementara, mengurai
manifest, lalu mencocokkan **jumlah berkas, ukuran, dan SHA-256 setiap berkas**.
Arsip yang rusak atau tanpa manifest gagal, bukan lolos diam-diam.

`media:backup:restore-test` menjalankan verifikasi yang sama ke direktori
sementara dan membuangnya setelah selesai. Ia tidak pernah menulis ke akar media
aktif — restore ke atas media hidup adalah operasi pemulihan bencana, bukan
bagian dari pengujian.

### Memasangkan backup database dan media

Keduanya adalah dua operasi terpisah, jadi keduanya **tidak** menghasilkan
snapshot atomik. Yang tersedia adalah stempel waktu: nama arsip media dan
`runId` di manifest memakai format waktu yang sama dengan penamaan backup
database, sehingga operator dapat memilih pasangan yang paling berdekatan
waktunya saat pemulihan.

Konsekuensi praktis yang perlu diketahui operator: bila media di-backup setelah
database, arsip media dapat memuat berkas yang belum punya baris di dump
database (media yatim — tidak berbahaya). Bila urutannya terbalik, dump dapat
memuat kunci media yang berkasnya belum masuk arsip — record itu akan jatuh ke
fallback legacy, atau tampil kosong bila byte legacy-nya sudah tidak ada.
Mendahulukan backup database lalu media adalah urutan yang lebih aman.

### Produksi

Cron backup produksi **belum diubah** oleh pekerjaan ini dan masih hanya
mengarsipkan dump PostgreSQL. Penjadwalan backup media di produksi adalah
langkah yang harus dilakukan **sebelum** migrasi media produksi dijalankan —
lihat TD-016.

## Prodclone

Database dan media prodclone adalah **dua lifecycle terpisah**:

```text
db:prodclone:refresh    refresh penuh snapshot database produksi
media:prodclone:sync    sinkronisasi media incremental, non-destruktif
prodclone:refresh       wrapper: jalankan keduanya, database lebih dulu
dev:prodclone           HANYA menjalankan aplikasi terhadap clone
```

`dev:prodclone` tidak pernah melakukan refresh apa pun secara diam-diam.
`db:prodclone:refresh` tidak menyentuh media sama sekali.

### Semantik sinkronisasi media

```text
MEDIA PRODUKSI  (read-only)
      ↓  salin yang hilang / berubah
MEDIA PRODCLONE LOKAL
```

Arahnya satu dan tidak dapat dibalik. Sumber selalu dibangun dari topologi
produksi di `lib/deployment.ts`, tujuan selalu dari akar media peran prodclone;
keduanya tidak diterima dari argumen baris perintah, sehingga tidak ada jalur
di mana operator dapat menukar sumber dan tujuan.

Jaminan yang ditegakkan `lib/media-sync.ts` dan diuji di
`tests/media-operations.test.ts`:

- **tanpa `--delete`** dan seluruh variannya — media lokal yang basi dibiarkan.
  Menyimpan berkas yang tidak terpakai jauh lebih aman daripada menghapus berkas
  lokal secara otomatis;
- tanpa `--remove-source-files` — produksi tidak pernah kehilangan berkas;
- tanpa mkdir, chmod, chown, atau sudo di sisi remote — produksi murni dibaca;
- tujuan yang ambigu ditolak (akar filesystem, akar drive, akar project, atau
  apa pun di luar `.media/`);
- peran selain `prodclone` ditolak, sehingga media produksi tidak dapat menimpa
  media pengembangan lokal.

Dry-run tersedia dan tidak mengunduh apa pun:

```bash
npm run media:prodclone:sync -- --dry-run
```

Setiap kali dijalankan, perintah mencetak remote, sumber, tujuan, mode, dan
status delete sebelum operasi dimulai.

### Wrapper

`prodclone:refresh` bersifat fail-fast: bila refresh database gagal,
sinkronisasi media **tidak** dijalankan. Bila database berhasil tetapi media
gagal, database **tidak** di-rollback dan perintah melaporkan kegagalan sebagian
secara eksplisit — mengklaim "prodclone refresh berhasil" dalam keadaan itu akan
membuat operator menguji aplikasi terhadap data yang tidak lengkap tanpa
menyadarinya. Logika pelaporannya ada di `lib/prodclone-refresh.ts`.

Alias lama `db:refresh-prodclone` tetap bekerja dan meneruskan ke
`db:prodclone:refresh`, sehingga automation yang sudah ada tidak patah.

## Aturan untuk fitur baru

**Fitur unggah baru wajib memakai lapisan penyimpanan media kanonik.**

Jangan menambahkan kolom `Bytes`/`bytea` baru untuk media pengguna yang jumlahnya
dapat bertumbuh. Kolom bytea yang ada hari ini adalah warisan yang sedang
dipensiunkan, bukan pola yang boleh ditiru. Pengecualian memerlukan tinjauan
arsitektur tersendiri.

Foto siswa khususnya **harus** memakai lapisan ini. Scope `students/photo` sudah
disiapkan. Jangan menambahkan `Student.photoData Bytes` — dengan ~840 siswa,
kolom itu akan menempatkan ratusan megabyte gambar ke dalam setiap dump
database dan setiap refresh prodclone. Fiturnya sendiri belum ada dan tidak
dibuat oleh pekerjaan ini.
