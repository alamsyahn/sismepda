BEGIN;

CREATE TYPE "WorshipAttendanceStatus" AS ENUM ('IKUT', 'DISPENSASI', 'BELUM');

CREATE TABLE "WorshipAttendance" (
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "classId" TEXT NOT NULL,
    "status" "WorshipAttendanceStatus" NOT NULL,
    "firstScannedAt" TIMESTAMP(3),
    "manualReason" TEXT,
    "manualByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "WorshipAttendance_pkey" PRIMARY KEY ("studentId", "date"),
    CONSTRAINT "WorshipAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WorshipAttendance_classId_date_idx" ON "WorshipAttendance"("classId", "date");

ALTER TABLE "ScanEvent"
    ADD COLUMN "worshipFirstSeenAt" TIMESTAMP(3),
    DROP CONSTRAINT "ScanEvent_mode_check",
    DROP CONSTRAINT "ScanEvent_outcome_check",
    ADD CONSTRAINT "ScanEvent_mode_check" CHECK ("mode" IN ('attendance', 'uks', 'worship')),
    ADD CONSTRAINT "ScanEvent_outcome_check" CHECK ("outcome" IN (
        'PRESENT', 'REPEAT', 'CONFLICT', 'UNKNOWN', 'HOLIDAY', 'OUTSIDE_WINDOW',
        'DRAFT', 'SAVED', 'CANCELLED', 'WORSHIP_PRESENT', 'WORSHIP_REPEAT'
    ));

COMMIT;
