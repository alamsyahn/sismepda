-- Logo institusi untuk overlay hero Halaman Utama E-UKS.
--
-- Aditif dan non-destruktif: satu tabel baru, tidak menyentuh tabel yang ada
-- dan tidak ada backfill. Sekolah mengisi logonya sendiri lewat Pengaturan.

CREATE TABLE "EuksHeroLogo" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "logoData" BYTEA,
  "logoMimeType" TEXT,
  "logoUpdatedAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EuksHeroLogo_pkey" PRIMARY KEY ("id")
);

-- Hero hanya pernah meminta logo aktif terurut; indeks ini melayani query itu
-- persis, sama seperti indeks pada EuksHeroImage.
CREATE INDEX "EuksHeroLogo_active_sortOrder_idx" ON "EuksHeroLogo"("active", "sortOrder");
