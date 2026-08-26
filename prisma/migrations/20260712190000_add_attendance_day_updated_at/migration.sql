ALTER TABLE "AttendanceDay" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "AttendanceDay" SET "updatedAt" = "submittedAt";
