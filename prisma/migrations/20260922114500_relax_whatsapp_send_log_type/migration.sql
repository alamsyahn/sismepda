-- Melonggarkan kolom legacy `WhatsAppSendLog.type`.
--
-- MENGAPA PERLU
--
-- Kartu "Pesan manual" dan kartu buatan admin tidak punya padanan di enum
-- `WhatsAppMessageType`. Selama `type` NOT NULL, setiap pengiriman dari kartu
-- semacam itu gagal di tingkat database — bukan karena aturan bisnis, tetapi
-- karena kolom peninggalan model lama.
--
-- KOLOM TIDAK DIHAPUS.
--
-- Riwayat pengiriman sebelum migrasi kartu pesan hanya punya `type` sebagai
-- penanda jenis, dan `docs/technical-debt/README.md` mencatat pemensiunannya
-- sebagai langkah terpisah setelah produksi terverifikasi. Yang dilakukan di
-- sini hanya melonggarkan: baris lama tetap utuh, baris baru boleh NULL.
--
-- FK IKUT DILONGGARKAN KE SET NULL.
--
-- Sebelumnya `ON DELETE CASCADE` ke `WhatsAppConfiguration`: menghapus satu
-- baris konfigurasi ikut menghapus BUKTI pengiriman. Riwayat pengiriman adalah
-- catatan bahwa sebuah pesan benar-benar sampai ke grup sekolah, dan tidak
-- boleh lenyap sebagai efek samping pembersihan konfigurasi.

ALTER TABLE "WhatsAppSendLog" ALTER COLUMN "type" DROP NOT NULL;

ALTER TABLE "WhatsAppSendLog" DROP CONSTRAINT IF EXISTS "WhatsAppSendLog_type_fkey";

ALTER TABLE "WhatsAppSendLog"
  ADD CONSTRAINT "WhatsAppSendLog_type_fkey"
  FOREIGN KEY ("type") REFERENCES "WhatsAppConfiguration"("type")
  ON DELETE SET NULL ON UPDATE CASCADE;
