-- Kebijakan unggah terpusat.
--
-- Dua kolom nullable pada SchoolSetting menyimpan default global per kategori.
-- NULL berarti "pakai bawaan kode", bukan tanpa batas; resolver di
-- lib/upload-policy.ts tidak pernah memperlakukan ketiadaan nilai sebagai izin.
-- Karena nullable dan tanpa backfill, baris pengaturan yang sudah ada tetap sah
-- dan perilaku unggah tidak berubah sampai admin menyetelnya.
ALTER TABLE "SchoolSetting" ADD COLUMN "uploadImageMaxBytes" INTEGER;
ALTER TABLE "SchoolSetting" ADD COLUMN "uploadDocumentMaxBytes" INTEGER;

-- Override per Upload Slot. Hanya penyimpangan yang disimpan; katalog slot
-- tetap di kode supaya tidak ada sumber kebenaran kedua. Tabel sengaja dibuat
-- kosong: berkas yang sudah tersimpan tidak divalidasi ulang oleh migrasi ini.
CREATE TABLE "UploadPolicyOverride" (
    "slotKey" TEXT NOT NULL,
    "maxBytes" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadPolicyOverride_pkey" PRIMARY KEY ("slotKey")
);
