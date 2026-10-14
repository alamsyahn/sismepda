# Catatan Kebugaran

`/e-uks/kebugaran` mencatat Beep Test 20 m per kelas dan tanggal pelaksanaan.
Hasil juga tampil di kartu Catatan Kebugaran pada Pantauan Kesehatan Siswa.
Fitur ini menilai daya tahan aerobik, bukan kebugaran keseluruhan atau skor TKSI lengkap.

## Penggunaan

1. Buka E-UKS → Catatan Kebugaran, pilih kelas dan tanggal, lalu Tampilkan.
2. Pilih protokol dan isi identitas audio yang benar-benar digunakan. Protokol/audio
   dikunci setelah sesi pertama tersimpan. Satu kelas memiliki satu sesi Beep Test per tanggal.
3. Ubah status siswa menjadi Sudah tes, isi level dan balikan terakhir yang berhasil
   diselesaikan secara terpisah. Catatan opsional. Belum tes, Tidak ikut, dan Tes tidak
   valid tidak menyimpan skor; ketiganya tidak dihitung sebagai nol.
4. Simpan perubahan sekaligus. Pencarian/filter hanya menyaring tampilan; seluruh
   perubahan tetap disimpan. Jika terjadi konflik versi, seluruh batch dibatalkan dan
   isian di layar dipertahankan. Muat ulang setelah mencatat perubahan yang perlu disalin.

Pencatatan mendukung siswa perempuan dan laki-laki. Hasil historis tetap terjangkau
di sesi asal jika siswa berpindah kelas atau dinonaktifkan; siswa baru hanya dapat
ditambahkan melalui kelas aktifnya. Penghapusan siswa/kelas secara eksplisit menghapus
hasil terkait, mengikuti lifecycle pengukuran E-UKS yang sudah ada.

## Protokol dan kategori

- `TKSI_D_20M_2023`: norma Beep Test pada [panduan resmi TKSI Fase D](https://tksi.kemendikdasmen.go.id/home/fase/4/prosedur/59), tabel bertanggal 2023.
  Pilihan ini hanya untuk pelaksanaan dan audio yang sesuai panduan tersebut.
- `BEEP_20M_OTHER`: hasil mentah tanpa kategori; tidak menganggap semua audio 20 m setara.

Jenis kelamin dan tingkat kelas disimpan saat hasil pertama kali dibuat agar perubahan
profil tidak mengubah kategori historis. Kategori berlaku hanya pada kelas VII–IX / 7–9
dan jenis kelamin yang tersedia. Tabel sumber tidak menjelaskan seluruh pasangan level /
balikan; celah tidak diinterpolasi dan ditandai **Batas norma perlu verifikasi**.
Level/balikan dibatasi ke integer positif (maksimal 21/30 sebagai batas isian umum),
bukan bukti bahwa setiap pasangan valid untuk setiap audio. Penguji harus mencocokkan
pasangan dengan rekaman yang dipakai. VO₂max tidak dihitung.

Grafik mengelompokkan hasil berdasarkan protokol DAN identitas audio yang sama.
Sumbu vertikal level; balikan tersedia pada judul titik dan tabel. Hasil tidak ikut / tidak
valid tidak dimasukkan dalam garis dan tidak menjadi nol. Grafik muncul mulai dua hasil.

## Izin dan penyimpanan

- `euks.fitness.read`: halaman kelas, hasil individual, menu kebugaran.
- `euks.fitness.create`: membuat sesi dan hasil baru; membutuhkan read.
- `euks.fitness.update`: mengoreksi hasil yang sudah ada; membutuhkan read.

Admin Sistem mendapat izin dari evaluator yang sudah ada. Role PJOK/UKS lain perlu
diberi izin secara eksplisit melalui pengaturan Akses. Tidak mengubah grant role yang
sudah ada dan tidak membuka akses siswa pribadi secara otomatis.

`FitnessSession` menyimpan jenis tes, tanggal sekolah (`DATE`), kelas, protokol, audio.
`FitnessResult` menyimpan skor asli, status, catatan, pencatat, snapshot kategori,
versi, dan waktu pencatatan/perubahan. Audit umum hanya identitas sesi dan jumlah
perubahan, tidak memuat skor/nama/catatan. Save atomik memakai advisory lock per sesi,
unik siswa/sesi, dan pemeriksaan versi. Pengiriman ulang identik tidak membuat duplikasi.
Server memeriksa permission, akun aktif, keanggotaan siswa, tanggal dan nilai; mutasi
mewajibkan same-origin. Cetak kesehatan umum tidak otomatis memuat data kebugaran.

## Migrasi

Migrasi aditif `20261014160000_fitness_records` membuat dua tabel, enum status, constraint,
dan tiga permission katalog. Jalankan `prisma generate`, lalu `prisma migrate deploy`
melalui pemilih database lokal yang sesuai (`scripts/with-db.ts local` atau `prodclone`).
Jangan reset database atau menjalankan seed. Produksi hanya melalui workflow deployment.

Penambahan jenis tes lain dapat memakai `testType` dan protokol versi baru. UI/API saat
ini menerima Beep Test saja; tes berbeda perlu skema isian dan norma sendiri.
