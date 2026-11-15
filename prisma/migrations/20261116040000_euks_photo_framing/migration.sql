BEGIN;
ALTER TABLE "EuksOfficer" ADD COLUMN "photoFraming" JSONB;
ALTER TABLE "EuksFacility" ADD COLUMN "photoFraming" JSONB;
ALTER TABLE "EuksHeroImage" ADD COLUMN "photoFraming" JSONB;
COMMIT;
