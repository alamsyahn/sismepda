-- Identitas aplikasi (nama, subtitle, logo) dibuat configurable lewat halaman
-- Pengaturan. Logo disimpan sebagai BYTEA mengikuti pola favicon yang sudah
-- ada, sehingga deployment tidak memerlukan object storage tambahan.
ALTER TABLE "SchoolSetting"
ADD COLUMN "appName" TEXT NOT NULL DEFAULT 'SISMEPDA',
ADD COLUMN "appFullName" TEXT NOT NULL DEFAULT 'Sistem Informasi Sekolah',
ADD COLUMN "appLogoData" BYTEA,
ADD COLUMN "appLogoMimeType" TEXT,
ADD COLUMN "appLogoUpdatedAt" TIMESTAMP(3);
