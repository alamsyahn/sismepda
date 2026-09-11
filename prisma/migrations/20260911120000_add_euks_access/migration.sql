-- Modul E-UKS: hak akses terdelegasi, mengikuti pola Sarpras.
ALTER TABLE "User" ADD COLUMN "canViewEuks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canEditEuks" BOOLEAN NOT NULL DEFAULT false;
