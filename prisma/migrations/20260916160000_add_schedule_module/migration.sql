-- Modul Jadwal: struktur waktu, revisi jadwal, penempatan, pemetaan aSc, impor.
--
-- Migrasi ini MURNI ADITIF: hanya membuat enum, tabel, indeks, dan foreign key
-- baru. Tidak ada kolom, tabel, constraint, maupun baris lama yang diubah atau
-- dihapus, sehingga aman diterapkan pada database produksi yang sudah berisi
-- data tanpa backfill apa pun.
--
-- Tidak ada seeding jadwal di sini. Struktur waktu bawaan dibuat aplikasi saat
-- pertama kali modul dibuka (lihat ensureActiveTimeProfile di
-- lib/server-schedule.ts), dan tidak ada jadwal yang dikarang: seluruh isi
-- ScheduleEntry berasal dari impor aSc atau suntingan manual admin.
--
-- Keanggotaan role sengaja tidak disentuh. Permission schedule.* disemai
-- prisma/seed-rbac.ts ke template role, bukan lewat SQL.

-- CreateEnum
CREATE TYPE "ScheduleSlotKind" AS ENUM ('PELAJARAN', 'ISTIRAHAT', 'KEGIATAN');

-- CreateEnum
CREATE TYPE "ScheduleRevisionSource" AS ENUM ('ASC_IMPORT', 'MANUAL', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "ScheduleExternalSource" AS ENUM ('ASC_TIMETABLES');

-- CreateEnum
CREATE TYPE "ScheduleExternalEntity" AS ENUM ('TEACHER', 'CLASS', 'SUBJECT');

-- CreateEnum
CREATE TYPE "ScheduleImportStatus" AS ENUM ('PREVIEW', 'APPLIED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "ScheduleTimeProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTimeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTimeSlot" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "ScheduleSlotKind" NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "ascPeriod" INTEGER,

    CONSTRAINT "ScheduleTimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRevision" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "source" "ScheduleRevisionSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "summary" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEntry" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "room" TEXT,

    CONSTRAINT "ScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleExternalMapping" (
    "id" TEXT NOT NULL,
    "source" "ScheduleExternalSource" NOT NULL,
    "entityType" "ScheduleExternalEntity" NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "externalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleExternalMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "ScheduleImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "payload" JSONB NOT NULL,
    "summary" JSONB,
    "error" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "revisionId" TEXT,

    CONSTRAINT "ScheduleImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTimeProfile_key_key" ON "ScheduleTimeProfile"("key");

-- CreateIndex
CREATE INDEX "ScheduleTimeProfile_active_idx" ON "ScheduleTimeProfile"("active");

-- CreateIndex
CREATE INDEX "ScheduleTimeSlot_profileId_idx" ON "ScheduleTimeSlot"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTimeSlot_profileId_position_key" ON "ScheduleTimeSlot"("profileId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTimeSlot_profileId_ascPeriod_key" ON "ScheduleTimeSlot"("profileId", "ascPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRevision_number_key" ON "ScheduleRevision"("number");

-- CreateIndex
CREATE INDEX "ScheduleRevision_active_idx" ON "ScheduleRevision"("active");

-- CreateIndex
CREATE INDEX "ScheduleRevision_createdAt_idx" ON "ScheduleRevision"("createdAt");

-- CreateIndex
CREATE INDEX "ScheduleEntry_revisionId_teacherId_day_period_idx" ON "ScheduleEntry"("revisionId", "teacherId", "day", "period");

-- CreateIndex
CREATE INDEX "ScheduleEntry_revisionId_day_period_idx" ON "ScheduleEntry"("revisionId", "day", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEntry_revisionId_day_period_classId_key" ON "ScheduleEntry"("revisionId", "day", "period", "classId");

-- CreateIndex
CREATE INDEX "ScheduleExternalMapping_source_entityType_internalId_idx" ON "ScheduleExternalMapping"("source", "entityType", "internalId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleExternalMapping_source_entityType_externalId_key" ON "ScheduleExternalMapping"("source", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "ScheduleImport_status_createdAt_idx" ON "ScheduleImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduleImport_createdAt_idx" ON "ScheduleImport"("createdAt");

-- AddForeignKey
ALTER TABLE "ScheduleTimeSlot" ADD CONSTRAINT "ScheduleTimeSlot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScheduleTimeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRevision" ADD CONSTRAINT "ScheduleRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ScheduleRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleImport" ADD CONSTRAINT "ScheduleImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleImport" ADD CONSTRAINT "ScheduleImport_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ScheduleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

