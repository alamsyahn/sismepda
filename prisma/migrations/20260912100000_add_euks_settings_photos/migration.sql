-- Foto pengurus dan fasilitas UKS.
--
-- Aditif dan non-destruktif: hanya menambah kolom nullable pada dua tabel yang
-- sudah ada. Baris lama tetap valid tanpa backfill — tanpa foto berarti NULL
-- dan antarmuka menampilkan placeholder.
--
-- Bytes disimpan langsung di PostgreSQL mengikuti pola yang sudah berlaku di
-- aplikasi ini (User.photoData, SarprasPhoto.data), sehingga tidak ada volume
-- atau storage baru yang harus disiapkan saat berjalan di VPS/Docker.

ALTER TABLE "EuksOfficer"
    ADD COLUMN "photoData" BYTEA,
    ADD COLUMN "photoMimeType" TEXT,
    ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);

ALTER TABLE "EuksFacility"
    ADD COLUMN "photoData" BYTEA,
    ADD COLUMN "photoMimeType" TEXT,
    ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
