-- Konten Pengaturan E-UKS: identitas, pengurus, fasilitas, dan daftar
-- keluhan siap-pilih.
--
-- Aditif dan non-destruktif: hanya membuat tabel baru. Tidak ada tabel
-- existing yang diubah, tidak ada kolom yang dihapus, tidak ada backfill.
-- Satu-satunya sentuhan ke tabel lama adalah foreign key opsional dari
-- "EuksOfficer" ke "User", yang tidak mengubah baris User mana pun.

CREATE TABLE "EuksProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "description" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EuksProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EuksOfficer" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EuksOfficer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EuksOfficer_active_sortOrder_idx" ON "EuksOfficer"("active", "sortOrder");

-- SetNull: menonaktifkan/menghapus akun guru tidak boleh menghapus riwayat
-- kepengurusan; nama pengurus sudah tersimpan sebagai teks.
ALTER TABLE "EuksOfficer" ADD CONSTRAINT "EuksOfficer_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EuksFacility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "quantity" INTEGER,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EuksFacility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EuksFacility_slug_key" ON "EuksFacility"("slug");
CREATE INDEX "EuksFacility_active_sortOrder_idx" ON "EuksFacility"("active", "sortOrder");

CREATE TABLE "EuksComplaintOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EuksComplaintOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EuksComplaintOption_slug_key" ON "EuksComplaintOption"("slug");
CREATE INDEX "EuksComplaintOption_active_sortOrder_idx" ON "EuksComplaintOption"("active", "sortOrder");
