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

- **Development**: boleh dikosongkan. Default `.media/` di dalam project, sudah
  masuk `.gitignore`. Media runtime tidak pernah di-commit.
- **Test**: setiap test mengarahkan variabel ini ke direktori sementara. Test
  tidak boleh menulis ke `.media/` maupun direktori pengguna.
- **Produksi**: `/app/media`, dipasangkan ke volume Docker `media`.

Tidak ada path yang di-hardcode di business logic.

## Docker

`compose.yaml` mendeklarasikan volume bernama `media` yang dipasang di
`/app/media`. Ini **wajib**: tanpa volume, media hanya berada di writable layer
container dan akan hilang pada setiap `--force-recreate`.

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

Setelah media dipindahkan, pemulihan penuh membutuhkan **dua** hal:

1. dump PostgreSQL, dan
2. isi volume media.

Selama byte legacy masih ada, dump database masih memuat semua media lama,
sehingga belum ada risiko akut. Risiko itu muncul pada media yang diunggah
**setelah** deploy — media tersebut hanya ada di volume.

TODO konkret (belum dikerjakan, di luar cakupan fase ini): tambahkan arsip
volume media ke rutinitas backup produksi berdampingan dengan dump PostgreSQL,
dan verifikasi keterbacaan arsipnya seperti dump database diverifikasi hari ini.
Cron backup produksi tidak diubah oleh pekerjaan ini.

## Prodclone

`npm run db:refresh-prodclone` menyalin **database saja** dan tidak menyentuh
media. Perilakunya tidak berubah.

Akibatnya, pada clone: record yang masih punya byte legacy tetap bergambar,
sedangkan record yang medianya hanya ada sebagai berkas akan tampil tanpa gambar
karena berkasnya tidak ada di mesin lokal. Ini tidak merusak apa pun — hanya
gambar yang kosong.

Sinkronisasi media adalah perintah terpisah (`media:sync-prodclone`) yang
**belum diimplementasikan**. Memisahkan keduanya disengaja: database perlu
disalin utuh setiap refresh, sedangkan media hanya perlu ditambal secara
incremental. Bila kelak diimplementasikan, ia harus incremental, non-destruktif,
dan tidak boleh menghapus media lokal.

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
