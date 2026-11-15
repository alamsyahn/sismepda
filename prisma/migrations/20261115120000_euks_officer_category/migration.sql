CREATE TYPE "EuksOfficerCategory" AS ENUM ('GURU', 'SISWA');

ALTER TABLE "EuksOfficer"
  ADD COLUMN "category" "EuksOfficerCategory" NOT NULL DEFAULT 'GURU',
  ADD CONSTRAINT "EuksOfficer_student_has_no_teacher_account"
    CHECK ("category" <> 'SISWA' OR "userId" IS NULL);
