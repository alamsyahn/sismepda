-- Foto hero Halaman Utama E-UKS, jam layanan, dan kontak.
--
-- Aditif dan non-destruktif: satu tabel baru plus dua kolom nullable pada
-- EuksProfile yang sudah ada. Tidak ada backfill dan tidak ada seed — baris
-- profil yang sudah tersimpan tetap valid dengan NULL, dan Halaman Utama
-- menampilkan hero placeholder selama belum ada foto yang diunggah.
--
-- Byte foto disimpan langsung di PostgreSQL mengikuti pola yang sudah berlaku
-- (User.photoData, SarprasPhoto.data, EuksOfficer.photoData), sehingga tidak
-- ada volume atau storage baru yang harus disiapkan saat berjalan di VPS/Docker.

ALTER TABLE "EuksProfile"
    ADD COLUMN "serviceHours" TEXT,
    ADD COLUMN "contact" TEXT;

CREATE TABLE "EuksHeroImage" (
    "id" TEXT NOT NULL,
    "caption" TEXT,
    "photoData" BYTEA,
    "photoMimeType" TEXT,
    "photoUpdatedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EuksHeroImage_pkey" PRIMARY KEY ("id")
);

-- Halaman Utama selalu meminta foto aktif dalam urutan tampil; indeks ini
-- melayani kueri itu langsung tanpa sort tambahan.
CREATE INDEX "EuksHeroImage_active_sortOrder_idx" ON "EuksHeroImage"("active", "sortOrder");
