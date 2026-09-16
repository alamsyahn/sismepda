-- Jadwal yang dapat diubah admin + status klaim untuk idempotensi.
--
-- MENGAPA MIGRASI INI ADA
--
-- 1. Jam 08:00/10:00/12:00 sebelumnya hidup sebagai konstanta di source code,
--    sehingga mengubah jadwal sekolah menuntut rilis baru.
-- 2. `WhatsAppSendStatus` belum punya status "sedang dikerjakan", sehingga
--    pengiriman hanya dapat dicatat SETELAH terkirim — terlalu terlambat untuk
--    mencegah kiriman kedua.
--
-- KOMPATIBILITAS MUNDUR
--
-- Kolom `slots` diberi default array kosong lalu DIISI dengan jam yang selama
-- ini berlaku untuk masing-masing jenis. Tanpa backfill ini, setiap jadwal yang
-- sedang aktif akan berhenti mengirim begitu migrasi dijalankan — jam yang
-- dahulu tersirat di kode akan lenyap tanpa ada yang mengubah pengaturan.
--
-- Tidak ada data yang dihapus dan tidak ada kolom yang di-drop.

ALTER TYPE "WhatsAppSendStatus" ADD VALUE IF NOT EXISTS 'PROCESSING' BEFORE 'SENT';

ALTER TABLE "WhatsAppConfiguration"
  ADD COLUMN IF NOT EXISTS "slots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Jam yang sebelumnya tertanam di lib/whatsapp-schedule.ts. Hanya menyentuh
-- baris yang belum punya jadwal, sehingga migrasi ini aman diulang dan tidak
-- pernah menimpa jadwal yang sudah disunting admin.
UPDATE "WhatsAppConfiguration"
  SET "slots" = ARRAY['08:00', '10:00']
  WHERE "type" = 'ATTENDANCE_MISSING' AND cardinality("slots") = 0;

UPDATE "WhatsAppConfiguration"
  SET "slots" = ARRAY['12:00']
  WHERE "type" = 'ATTENDANCE_ABSENT' AND cardinality("slots") = 0;
