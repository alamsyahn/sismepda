-- CreateEnum
CREATE TYPE "MenstruationSource" AS ENUM ('STUDENT', 'UKS');

-- CreateEnum
CREATE TYPE "MenstruationKind" AS ENUM ('EPISODE', 'WEEKLY', 'PROFILE');

-- CreateEnum
CREATE TYPE "MenstruationStatus" AS ENUM ('HAD', 'NONE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "studentId" TEXT;

-- CreateTable
CREATE TABLE "MenstruationRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" "MenstruationKind" NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE,
    "endDate" DATE,
    "weekStart" DATE,
    "status" "MenstruationStatus",
    "episodeId" TEXT,
    "neverMenstruated" BOOLEAN,
    "complaint" TEXT,
    "source" "MenstruationSource" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenstruationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenstruationHistory" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recordId" TEXT,
    "action" TEXT NOT NULL,
    "source" "MenstruationSource" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenstruationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenstruationConflict" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "proposed" JSONB NOT NULL,
    "recordedById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenstruationConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenstruationRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenstruationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenstruationRecord_studentId_kind_startDate_idx" ON "MenstruationRecord"("studentId", "kind", "startDate");

-- CreateIndex
CREATE INDEX "MenstruationRecord_weekStart_kind_idx" ON "MenstruationRecord"("weekStart", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MenstruationRecord_studentId_kind_key_key" ON "MenstruationRecord"("studentId", "kind", "key");

-- CreateIndex
CREATE INDEX "MenstruationHistory_studentId_createdAt_idx" ON "MenstruationHistory"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "MenstruationConflict_studentId_resolvedAt_idx" ON "MenstruationConflict"("studentId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenstruationRequest_actorId_requestId_key" ON "MenstruationRequest"("actorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationRecord" ADD CONSTRAINT "MenstruationRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationRecord" ADD CONSTRAINT "MenstruationRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationHistory" ADD CONSTRAINT "MenstruationHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationHistory" ADD CONSTRAINT "MenstruationHistory_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationConflict" ADD CONSTRAINT "MenstruationConflict_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationConflict" ADD CONSTRAINT "MenstruationConflict_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenstruationRequest" ADD CONSTRAINT "MenstruationRequest_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
