-- Demografi siswa untuk klasifikasi IMT-menurut-umur (E-UKS).
-- Aditif dan non-destruktif: kedua kolom nullable, tidak ada backfill,
-- tidak ada data existing yang diubah atau dihapus.
CREATE TYPE "Gender" AS ENUM ('LAKI_LAKI', 'PEREMPUAN');

ALTER TABLE "Student" ADD COLUMN "birthDate" DATE;

ALTER TABLE "Student" ADD COLUMN "gender" "Gender";
