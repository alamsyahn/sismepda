-- Menyelaraskan katalog Permission dengan registry kode.
--
-- KENAPA MIGRASI INI PERLU
--
-- Katalog permission hidup di dua tempat: registry kode
-- (`lib/rbac-permissions.ts`) dan tabel `Permission`. Registry menentukan
-- permission mana yang DIKENAL evaluator; tabel menentukan permission mana yang
-- benar-benar dapat DITAUTKAN ke sebuah role (`RolePermission.permissionId`).
--
-- Penyelarasan itu selama ini hanya dikerjakan seed (`prisma/seed-rbac.ts`),
-- yang meng-upsert seluruh `PERMISSIONS`. Modul yang rilis tanpa seed dijalankan
-- ulang karena itu meninggalkan katalog yang tertinggal: key-nya dikenal kode,
-- tetapi barisnya tidak ada di database.
--
-- Akibatnya nyata dan membingungkan: editor role menampilkan checkbox-nya
-- (daftar berasal dari registry), validasi service meloloskannya (registry juga),
-- lalu `resolvePermissionIds` di `lib/rbac-stores.ts` gagal karena barisnya tidak
-- ada — seluruh penyimpanan role ditolak, termasuk permission kategori lain di
-- payload yang sama.
--
-- Migrasi ini memasukkan baris yang tertinggal supaya database tidak lagi
-- bergantung pada seed untuk menjadi benar.
--
-- SIFAT
--
--   * Idempoten: `ON CONFLICT DO NOTHING`.
--   * Aditif: tidak ada baris permission, role, RolePermission, atau UserRole
--     yang diubah maupun dihapus.
--   * Tidak memberi kewenangan kepada siapa pun. Menyediakan permission untuk
--     DAPAT dipilih bukan memberikannya; keanggotaan role sengaja tidak
--     disentuh, dan Admin Sistem tetap memperoleh haknya lewat bypass key
--     `system_admin`, bukan lewat baris di sini.

INSERT INTO "Permission" ("id","key","resource","action","scope","label","description","module","createdAt","updatedAt") VALUES
  (gen_random_uuid()::text,'school.upload_policy.read','school.upload_policy','read',NULL,'Lihat pengaturan unggah',NULL,'school',NOW(),NOW()),
  (gen_random_uuid()::text,'school.upload_policy.update','school.upload_policy','update',NULL,'Ubah batas ukuran unggah','Mengendalikan batas global per kategori dan override per slot unggah.','school',NOW(),NOW()),
  (gen_random_uuid()::text,'whatsapp.read','whatsapp','read',NULL,'Lihat status dan histori WhatsApp otomatis','Membuka halaman WhatsApp Otomatis: status koneksi, nomor terhubung, jadwal, dan histori pengiriman beserta pesannya. Tidak dapat menghubungkan, memutus, maupun mengirim.','whatsapp',NOW(),NOW()),
  (gen_random_uuid()::text,'whatsapp.connection.manage','whatsapp.connection','manage',NULL,'Kelola koneksi WhatsApp','Menghubungkan, memindai QR, menyambung ulang, dan keluar dari akun WhatsApp sekolah. Keluar akan menghapus sesi sehingga pairing harus diulang dari perangkat ponsel.','whatsapp',NOW(),NOW()),
  (gen_random_uuid()::text,'whatsapp.send','whatsapp','send',NULL,'Kirim pesan WhatsApp sekarang','Memicu pengiriman laporan absensi ke grup di luar jadwal ("Kirim sekarang"). Pesan benar-benar terkirim ke grup dan tidak dapat ditarik kembali.','whatsapp',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.own.read','schedule.own','read',NULL,'Lihat jadwal mengajar sendiri','Membuka menu Jadwal dan melihat jadwal mengajar milik akun sendiri beserta struktur waktu harian. Tidak menampilkan jadwal guru lain.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.classes.read','schedule.classes','read',NULL,'Lihat jadwal kelas','Melihat susunan pelajaran satu kelas pada hari tertentu, termasuk mata pelajaran, pengajar, jam, dan ruang.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.teachers.read','schedule.teachers','read',NULL,'Lihat jadwal guru lain','Memilih guru mana pun pada tab Jadwal Saya dan melihat jadwal mengajarnya. Tidak diperlukan untuk melihat jadwal sendiri.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.free_teachers.read','schedule.free_teachers','read',NULL,'Lihat jam kosong guru','Melihat daftar guru yang tidak memiliki jadwal mengajar pada satu hari dan jam pelajaran. Tidak berarti guru tersebut bebas tugas.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.entries.create','schedule.entries','create',NULL,'Tambah penempatan jadwal',NULL,'schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.entries.update','schedule.entries','update',NULL,'Ubah penempatan jadwal',NULL,'schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.entries.delete','schedule.entries','delete',NULL,'Hapus penempatan jadwal',NULL,'schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.time.manage','schedule.time','manage',NULL,'Kelola Waktu & Kegiatan','Menentukan jam mulai/selesai tiap jam pelajaran, istirahat, dan kegiatan. Perubahan ini menggeser tampilan jam seluruh sekolah karena jadwal hanya menyimpan nomor jam, bukan pukul.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.import','schedule','import',NULL,'Impor jadwal dari aSc TimeTables','Mengunggah berkas XML aSc, memetakan guru/kelas/mapel, dan menerapkan hasilnya sebagai jadwal aktif baru. Penerapan menimpa penyesuaian manual yang berbeda dari berkas.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.revisions.read','schedule.revisions','read',NULL,'Lihat riwayat versi jadwal',NULL,'schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'schedule.revisions.rollback','schedule.revisions','rollback',NULL,'Kembalikan jadwal ke versi sebelumnya','Menjadikan salah satu versi lama sebagai jadwal aktif. Versi baru dibuat dari salinan versi tersebut; tidak ada riwayat yang dihapus.','schedule',NOW(),NOW()),
  (gen_random_uuid()::text,'development.read','development','read',NULL,'Lihat dokumentasi CLI Development','Membuka halaman Development yang mendokumentasikan perintah CLI proyek, termasuk nama perintah deployment, backup, dan database. Halaman hanya menampilkan teks; tidak ada perintah yang dapat dijalankan dari peramban.','development',NOW(),NOW())
ON CONFLICT ("key") DO NOTHING;
