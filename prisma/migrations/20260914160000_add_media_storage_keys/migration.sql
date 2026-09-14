-- Penyimpanan media kanonik: fase EXPAND.
--
-- Migrasi ini SEPENUHNYA ADITIF dan aman dijalankan pada produksi yang seluruh
-- medianya masih berada di kolom bytea. Tidak ada DROP COLUMN, tidak ada DROP
-- TABLE, tidak ada UPDATE terhadap data yang sudah ada.
--
-- Kolom biner legacy (photoData/logoData/faviconData/appLogoData/data) SENGAJA
-- DIPERTAHANKAN sebagai fallback baca dan jalur rollback. Penghapusannya adalah
-- fase CONTRACT terpisah, hanya setelah migrasi media produksi selesai,
-- diverifikasi, dan disetujui secara eksplisit.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "photoSize" INTEGER;

-- AlterTable
ALTER TABLE "EuksHeroImage" ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "photoSize" INTEGER;

-- AlterTable
ALTER TABLE "EuksHeroLogo" ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "logoSize" INTEGER;

-- AlterTable
ALTER TABLE "EuksOfficer" ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "photoSize" INTEGER;

-- AlterTable
ALTER TABLE "EuksFacility" ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "photoSize" INTEGER;

-- AlterTable
ALTER TABLE "SchoolSetting" ADD COLUMN     "appLogoKey" TEXT,
ADD COLUMN     "appLogoSize" INTEGER,
ADD COLUMN     "faviconKey" TEXT,
ADD COLUMN     "faviconSize" INTEGER;

-- AlterTable
-- `data` dilonggarkan menjadi nullable agar unggahan Sarpras baru tidak lagi
-- wajib menulis bytea. Melonggarkan NOT NULL tidak menyentuh baris mana pun
-- yang sudah ada dan tidak menghapus satu byte pun.
ALTER TABLE "SarprasPhoto" ADD COLUMN     "mediaKey" TEXT,
ADD COLUMN     "mediaSize" INTEGER,
ALTER COLUMN "data" DROP NOT NULL;
