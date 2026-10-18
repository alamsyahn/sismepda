# Kesiswaan

Modul berada di antara Data Master dan Kurikulum, dengan ikon GraduationCap.
Halaman: `/kesiswaan`, `/kesiswaan/ekstrakurikuler`, detail
`/kesiswaan/ekstrakurikuler/[id]`, `/kesiswaan/presensi`,
`/kesiswaan/prestasi`, dan `/kesiswaan/monitoring`.

## Mulai menggunakan

Admin Sistem dapat membuka modul langsung. Tambah periode dengan tahun ajaran,
semester dan batas tanggal; lalu tambah program, pembina dari guru aktif, serta
anggota dari Data Master. Tidak ada data contoh yang dimasukkan oleh migrasi.

Katalog izin ditambahkan oleh migrasi. Role template `pembina_ekstra` dan
`waka_kesiswaan` disediakan pada registry/seed; seed tidak mengubah role lama
atau memberikan role pada akun secara otomatis. Pada instalasi lama, admin
dapat mengatur role melalui Administrasi > Akses dengan izin berikut:

- Pengelola: `kesiswaan.read.all`, `kesiswaan.write.all`, `kesiswaan.manage`,
  `kesiswaan.verify`, `kesiswaan.export.all`.
- Pembina: `kesiswaan.read.own`, `kesiswaan.write.own`,
  `kesiswaan.export.own`, serta penugasan pada program terkait.
- Pembaca laporan sekolah: `kesiswaan.read.all`, `kesiswaan.export.all`.

`own` berarti ekstra dengan KsCoach.userId sesuai pengguna yang terautentikasi,
bukan cakupan wali kelas. Setiap API membaca grant database terkini. Akses
master untuk pilihan anggota/peserta dibatasi pada identitas dasar siswa aktif;
tidak mengikutsertakan data kesehatan. Tidak ada akses publik pada PDF/bukti.

## Input dan sejarah

Form tambah/edit terbuka pada konteks halaman, dengan Simpan/Batal. Konflik
versi mengembalikan HTTP 409 dan tidak menimpa data orang lain. Program yang
tidak dipakai diarsipkan. Masa keanggotaan siswa tidak boleh tumpang tindih;
kelas saat bergabung disimpan. Identitas/tanggal bergabung lama tidak dapat
diubah melalui editor; akhiri masa lama dan buat masa baru untuk rejoin.

Pertemuan membekukan roster dari keanggotaan yang berlaku pada tanggalnya,
termasuk nama dan kelas. Siswa yang baru bergabung tidak menambah slot pada
pertemuan lama. Perubahan tanggal pertemuan historis harus melalui pembatalan
dan pembuatan pertemuan baru. Pembina dapat mencatat draft sebagian; finalisasi
memerlukan seluruh slot H/S/I/A terisi dan tidak boleh untuk tanggal mendatang.
Pembukaan koreksi final memerlukan alasan. Setiap mutasi disimpan atomik dengan
KsHistory, termasuk nilai sebelum/sesudah, aktor dan alasan.

Presensi di detail dan halaman khusus menggunakan record dan komponen yang
sama. Draft belum tersimpan dipertahankan di memori selama berpindah dalam
modul; menutup/meninggalkan modul menampilkan peringatan. Reload bukan
penyimpanan offline: Simpan draft untuk mempertahankan data lintas reload.

Prestasi individu/tim disimpan sebagai satu perolehan dengan relasi peserta.
Prestasi dapat berdiri sendiri bagi pengelola sekolah; pembina hanya dapat
mencatat pada ekstra binaannya. Status DRAFT/SUBMITTED/VERIFIED/REVISION.
Perubahan pada prestasi terverifikasi melalui editor diajukan kembali.
Hanya izin verify yang dapat menetapkan VERIFIED/REVISION.

Bukti menerima tautan HTTPS dan/atau maksimal lima PDF/gambar per prestasi.
Slot `kesiswaan.achievement.evidence` memakai kebijakan unggah terpusat; format
ditentukan dari magic bytes. Berkas berada di media scope `kesiswaan/evidence`,
bukan direktori public. Unggah bukti ke prestasi VERIFIED mengembalikannya ke
SUBMITTED. Bukti lama tetap tersimpan; tidak ada penghapusan bukti otomatis.

Evaluasi memiliki rubrik keterampilan, kerja sama, kemandirian dan catatan
per bulan. Belum dinilai berbeda dari level terendah. Tindak lanjut mencatat
temuan, PIC, tenggat dan status terbuka/selesai. Deaktivasi siswa mempertahankan
sejarah; penghapusan permanen siswa dengan riwayat ekstra/prestasi ditolak.

## Angka dan cetak

Siswa aktif saat ini berasal dari master, bukan total historis periode lama.
Peserta ekstra dihitung unik antarprogram. Kehadiran adalah jumlah H dibagi
seluruh isian final H/S/I/A; bukan rerata persentase program. Draft tidak masuk
tingkat hadir, tetapi slot terisinya termasuk kelengkapan pencatatan. Pertemuan
batal dan pertemuan mendatang dikeluarkan dari ringkasan kehadiran. Data kosong
tidak menjadi nol persen atau alfa. Prestasi tim tidak menggandakan perolehan.

Cetak PDF menggunakan satu snapshot repeatable-read yang sama untuk seluruh
bagian laporan, dibatasi scope dan periode. Setiap halaman/tab memiliki cetak
sesuai konteks. Cetak daftar mengikuti pencarian/filter. Cetak semua mengabaikan
pencarian daftar tetapi tetap mempertahankan periode dan hak akses. Pilihan
rekap/lengkap serta lampiran anggota, presensi dan perkembangan tersedia.
Halaman presensi juga dapat menghasilkan formulir kosong.

PDFKit berjalan di Node, dengan font Lato tertanam beserta lisensi OFL, kop
sekolah/NPSN, tabel berulang, pembungkusan baris panjang, nomor X/Y, timestamp
zona waktu sekolah, dan bagian baru setiap program. Tidak memakai browser atau
screenshot. Berkas dibuat on-demand, tidak dipublikasikan dan tidak disimpan
permanen. Tanda tangan/nama pejabat tidak dikarang.

## Verifikasi dan operasi

Jalankan migration forward lewat pemilih target lokal:

```sh
npx tsx scripts/with-db.ts local -- prisma migrate deploy
npx prisma generate
npm test
npx tsc --noEmit --incremental false
npm run build
```

Pengujian integrasi eksplisit (fixture sementara dibersihkan pada finally):

```powershell
$env:KESISWAAN_DB_TESTS = '1'
npx tsx scripts/with-db.ts local -- tsx --test tests/kesiswaan.integration.test.ts
```

Suite biasa melewati pengujian database. Uji integrasi hanya menerima target
`sismepda_dev` melalui pemilih target. `KESISWAAN_PDF_QA_DIR` opsional menuliskan
PDF untuk pemeriksaan visual, termasuk presensi 65 siswa dengan catatan panjang.
Migrasi tidak dijalankan pada produksi dari workstation. Prodclone memerlukan
migration forward sendiri saat ingin digunakan; tidak direfresh otomatis.

File utama: `lib/kesiswaan*.ts`, `lib/server-kesiswaan.ts`,
`components/kesiswaan/`, `app/kesiswaan/`, `app/api/kesiswaan/`.
