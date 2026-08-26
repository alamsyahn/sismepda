ALTER TABLE "Student" ADD COLUMN "nis" TEXT;
ALTER TABLE "Student" ALTER COLUMN "nisn" DROP NOT NULL;

CREATE UNIQUE INDEX "Student_nis_key" ON "Student"("nis");

ALTER TABLE "Student"
ADD CONSTRAINT "Student_identifier_required"
CHECK ("nis" IS NOT NULL OR "nisn" IS NOT NULL);
