-- Notifikasi kunjungan UKS ke wali kelas.
--
-- SELURUHNYA ADITIF. Tidak ada kolom yang berubah tipe, tidak ada baris lama
-- yang ditulis ulang, dan tidak ada nilai yang di-backfill: kunjungan yang
-- tercatat sebelum fitur ini memang tidak pernah dinotifikasi, dan mengisinya
-- dengan status apa pun akan menjadi kebohongan pada riwayat.
--
-- Semua kolom nullable dengan alasan yang sama. `notifyStatus IS NULL` berarti
-- "belum pernah dicoba", keadaan yang berbeda dari FAILED dan menentukan tombol
-- mana yang ditawarkan kepada petugas.

CREATE TYPE "EuksNotifyStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "EuksVisit"
  ADD COLUMN "notifyStatus" "EuksNotifyStatus",
  ADD COLUMN "notifyAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "notifySentAt" TIMESTAMP(3),
  ADD COLUMN "notifyRecipientName" TEXT,
  ADD COLUMN "notifyRecipientPhone" TEXT,
  ADD COLUMN "notifyError" TEXT,
  ADD COLUMN "notifySendLogId" TEXT;

-- Jenis pesan WhatsApp baru untuk kartu notifikasi kunjungan.
--
-- Nilai enum ditambahkan, bukan menggantikan: dua jenis terjadwal yang sudah
-- berjalan tidak tersentuh, dan `WhatsAppSendLog.type` lama tetap sah.
ALTER TYPE "WhatsAppMessageType" ADD VALUE IF NOT EXISTS 'EUKS_VISIT_NOTIFICATION';

-- Permission baru agar dapat DITAUTKAN ke role.
--
-- Menyediakan permission bukan memberikannya: tidak ada baris RolePermission
-- atau UserRole yang disentuh. Admin Sistem tetap memperolehnya lewat bypass
-- `system_admin`, bukan lewat baris di sini.
INSERT INTO "Permission" ("id","key","resource","action","scope","label","description","module","createdAt","updatedAt") VALUES
  (gen_random_uuid()::text,'euks.visits.notify','euks.visits','notify',NULL,'Kirim notifikasi kunjungan UKS ke wali kelas','Mengirim pesan WhatsApp berisi keluhan dan tindakan seorang siswa ke nomor pribadi wali kelasnya. Pesan benar-benar terkirim dan tidak dapat ditarik kembali.','euks',NOW(),NOW())
ON CONFLICT ("key") DO NOTHING;
