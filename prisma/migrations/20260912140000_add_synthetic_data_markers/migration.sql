-- Penanda data uji (synthetic) khusus development E-UKS.
--
-- Aditif dan non-destruktif: hanya menambah kolom boolean NOT NULL dengan
-- DEFAULT false, sehingga setiap baris yang sudah ada otomatis bernilai false
-- dan tidak ada data yang diubah, dipindahkan, atau dihapus.
--
-- Kolom ini ada agar data uji dapat dihapus secara selektif tanpa pernah
-- menyentuh data nyata. Pada produksi nilainya selalu false karena hanya
-- generator development yang menulis true.
ALTER TABLE "EuksVisit" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StudentHealthMeasurement" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

-- Menandai siswa yang jenis kelamin/tanggal lahirnya diisi generator karena
-- masih NULL. Nilai asli tidak pernah ditimpa, dan pembersihan hanya mengosongkan
-- kolom pada baris bertanda ini.
ALTER TABLE "Student" ADD COLUMN "syntheticDemographics" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EuksVisit_isSynthetic_idx" ON "EuksVisit"("isSynthetic");

CREATE INDEX "StudentHealthMeasurement_isSynthetic_idx" ON "StudentHealthMeasurement"("isSynthetic");
