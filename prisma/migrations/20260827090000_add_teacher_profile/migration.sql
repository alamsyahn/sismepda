CREATE TYPE "EmploymentStatus" AS ENUM ('PNS', 'PPPK', 'HONORER');

ALTER TABLE "User"
ADD COLUMN "canManageTeacherProfiles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "employmentStatus" "EmploymentStatus",
ADD COLUMN "position" TEXT,
ADD COLUMN "teachingSince" TIMESTAMP(3),
ADD COLUMN "belajarId" TEXT;

CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");

CREATE TABLE "TeacherSubject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherSubject_userId_subjectId_key" ON "TeacherSubject"("userId", "subjectId");

CREATE TABLE "TeachingAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "periodStart" INTEGER NOT NULL,
    "periodEnd" INTEGER NOT NULL,

    CONSTRAINT "TeachingAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeachingAssignment_userId_day_periodStart_idx" ON "TeachingAssignment"("userId", "day", "periodStart");

CREATE TABLE "AdditionalDuty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "startDate" TIMESTAMP(3),

    CONSTRAINT "AdditionalDuty_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdditionalDuty_userId_idx" ON "AdditionalDuty"("userId");

ALTER TABLE "TeacherSubject" ADD CONSTRAINT "TeacherSubject_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherSubject" ADD CONSTRAINT "TeacherSubject_subjectId_fkey"
FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_classId_fkey"
FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_subjectId_fkey"
FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdditionalDuty" ADD CONSTRAINT "AdditionalDuty_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
