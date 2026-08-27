# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Guru** menggunakan SISMEPDA setiap hari untuk menginput absensi dengan cepat, mengetahui siswa yang tidak hadir hari ini, melihat jadwal mengajarnya, serta mengetahui jadwal guru atau kelas lain.
- **Wali kelas** menggunakan SISMEPDA setiap hari untuk melihat siswa di kelasnya yang tidak hadir dan meninjau rekap ketidakhadiran.
- **Kepala sekolah dan kesiswaan** membutuhkan gambaran cepat tentang siswa dengan poin pelanggaran tertinggi dan siswa yang memerlukan perhatian.
- **Tenaga usaha (TU)** sewaktu-waktu perlu mencari, melihat, dan mengambil data guru maupun siswa untuk dipindahkan ke sistem eksternal.
- **Sarana dan prasarana** secara berkala perlu melihat kondisi aset sekolah serta kebutuhan perbaikan atau pengadaan.
- **Kurikulum** secara berkala perlu melihat kelengkapan buku kerja guru dan siapa yang belum melengkapinya.
- **Pengelola dana BOS** perlu melihat alokasi dan sisa dana.

## Product Purpose

SISMEPDA menyatukan informasi dan pekerjaan operasional sekolah agar setiap peran dapat menemukan informasi yang dibutuhkan dan menyelesaikan tugasnya dengan sedikit klik. Keberhasilan berarti informasi penting dapat terlihat dengan cepat, input rutin tidak membebani pengguna, dan pihak sekolah dapat segera mengetahui hal yang membutuhkan tindak lanjut.

## Positioning

SISMEPDA adalah sistem operasional sekolah all-in-one yang menghubungkan data lintas peran dalam satu tempat. Pembeda utamanya bukan hanya pencatatan absensi, tetapi kemampuan memberi jawaban langsung atas kebutuhan harian sekolah—dengan banyak informasi yang relevan dan sedikit langkah untuk menemukannya.

## Operating Context

- Absensi dan pemantauan ketidakhadiran adalah ritual harian yang harus selesai cepat.
- Pemantauan wali kelas dan jadwal mengajar juga bersifat harian.
- Pemeriksaan sarpras, buku kerja guru, dan dana BOS dilakukan secara berkala, bukan setiap hari.
- TU perlu mengekspor atau memindahkan data guru dan siswa ke sistem eksternal kapan pun dibutuhkan.
- Istilah yang dipakai mengikuti operasi sekolah Indonesia, termasuk guru, wali kelas, kesiswaan, sarpras, TU, kurikulum, dana BOS, jam pelajaran, dan poin pelanggaran.

## Capabilities and Constraints

### Tersedia saat ini

- Autentikasi dengan peran `ADMIN` dan `GURU`.
- Input, pemantauan, rekap, pelaporan, dan ekspor absensi siswa.
- Pengelolaan data siswa, guru, kelas, dan wali kelas sesuai hak akses.
- Profil siswa beserta riwayat absensi dan poin pelanggaran.
- Direktori dan profil guru, data kepegawaian, mata pelajaran, tugas tambahan, serta penugasan/jadwal mengajar.
- Pengaturan sekolah, hari libur, periode input absensi, dan batas akses guru.

### Belum diimplementasikan atau belum lengkap

- Inventaris sarana-prasarana, kondisi aset, kebutuhan perbaikan, dan pengadaan.
- Daftar buku kerja guru dengan pemeriksaan kelengkapan berbasis centang.
- Alokasi dan saldo dana BOS.
- Pengalaman jadwal operasional yang menjawab: jadwal guru hari ini, pelajaran saat ini, daftar siswa yang diajar hari ini, jadwal guru lain, guru yang seharusnya mengajar suatu kelas saat ini, dan penyesuaian jam pelajaran.

### Kendala produk

- Aplikasi harus mudah diakses dan tidak mengandalkan banyak langkah untuk menjawab kebutuhan utama.
- UI harus jelas dan mengutamakan keterlihatan informasi yang relevan bagi peran pengguna.
- Data dan tindakan yang dapat dilihat atau diubah harus tetap mengikuti hak akses pengguna.

## Brand Commitments

- Nama produk adalah **SISMEPDA**.
- Bahasa antarmuka utama adalah Bahasa Indonesia dan menggunakan istilah sekolah yang familier.
- Komunikasi produk harus jelas, langsung, dan berorientasi tugas; tidak mengaburkan informasi dengan istilah teknis yang tidak diperlukan.

## Evidence on Hand

- Implementasi aplikasi dan alur yang sudah berjalan berada di `app/`, `components/`, dan `lib/`.
- Model data dan aturan relasi berada di `prisma/schema.prisma`.
- Daftar kemampuan yang diekspos lewat navigasi berada di `lib/nav.ts`.
- Dokumentasi operasional dan deployment berada di `README.md`.
- Belum ada bukti berupa testimoni, studi kasus, tolok ukur hasil, atau klaim eksternal; pekerjaan mendatang tidak boleh mengarang bukti tersebut.
- Tidak ada aset logo resmi yang dikonfirmasi dalam sesi init ini.

## Product Principles

1. **Jawaban dulu, navigasi kemudian.** Informasi yang paling dibutuhkan suatu peran harus segera terlihat tanpa pencarian atau klik berulang.
2. **Tugas harian harus ringan.** Absensi, pemantauan siswa, dan pengecekan jadwal harus dapat diselesaikan cepat dan dengan beban input minimal.
3. **Satu sumber informasi lintas peran.** Data yang sama harus dapat melayani kebutuhan guru, wali kelas, pimpinan, TU, dan unit sekolah lain tanpa membentuk silo baru.
4. **Perhatian diarahkan ke pengecualian.** Sistem harus menonjolkan siswa, kelas, dokumen, aset, atau anggaran yang membutuhkan tindakan—bukan hanya menampilkan total.
5. **Kewenangan tetap tegas.** Kemudahan akses informasi tidak boleh mengaburkan batas antara melihat, menginput, dan mengelola data.

## Accessibility & Inclusion

- Informasi penting harus dapat dipahami dengan label dan struktur yang jelas, bukan hanya melalui warna.
- Alur utama harus tetap mudah digunakan pada ukuran layar dan perangkat yang berbeda.
- Bahasa dan istilah harus familier bagi pengguna sekolah dengan tingkat kenyamanan teknologi yang beragam.
