CREATE TYPE "FitnessStatus" AS ENUM ('TESTED', 'NOT_TESTED', 'ABSENT', 'INVALID');

CREATE TABLE "FitnessSession" (
  "id" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "testedAt" DATE NOT NULL,
  "testType" TEXT NOT NULL DEFAULT 'BEEP_TEST',
  "protocol" TEXT NOT NULL,
  "audioLabel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FitnessSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FitnessSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FitnessSession_classId_testedAt_testType_key" ON "FitnessSession"("classId", "testedAt", "testType");

CREATE TABLE "FitnessResult" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "status" "FitnessStatus" NOT NULL,
  "level" INTEGER,
  "shuttle" INTEGER,
  "note" TEXT,
  "genderAtTest" "Gender",
  "gradeAtTest" TEXT NOT NULL,
  "recordedById" TEXT,
  "recordedByName" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FitnessResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FitnessResult_score_check" CHECK (("status" = 'TESTED' AND "level" IS NOT NULL AND "level" BETWEEN 1 AND 21 AND "shuttle" IS NOT NULL AND "shuttle" BETWEEN 1 AND 30) OR ("status" <> 'TESTED' AND "level" IS NULL AND "shuttle" IS NULL)),
  CONSTRAINT "FitnessResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FitnessSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FitnessResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FitnessResult_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FitnessResult_sessionId_studentId_key" ON "FitnessResult"("sessionId", "studentId");
CREATE INDEX "FitnessResult_studentId_idx" ON "FitnessResult"("studentId");

-- Register catalog entries without assigning authority to existing roles.
INSERT INTO "Permission" ("id", "key", "resource", "action", "scope", "label", "description", "module", "createdAt", "updatedAt") VALUES
('perm:euks.fitness.read', 'euks.fitness.read', 'euks.fitness', 'read', NULL, 'Baca catatan kebugaran', NULL, 'euks', NOW(), NOW()),
('perm:euks.fitness.create', 'euks.fitness.create', 'euks.fitness', 'create', NULL, 'Catat hasil tes kebugaran', NULL, 'euks', NOW(), NOW()),
('perm:euks.fitness.update', 'euks.fitness.update', 'euks.fitness', 'update', NULL, 'Koreksi hasil tes kebugaran', NULL, 'euks', NOW(), NOW())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action", "module" = EXCLUDED."module", "updatedAt" = EXCLUDED."updatedAt";
