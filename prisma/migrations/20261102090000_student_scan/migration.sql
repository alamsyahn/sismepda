-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StudentQrCredential" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "issuedById" TEXT NOT NULL,

    CONSTRAINT "StudentQrCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "studentId" TEXT,
    "classId" TEXT,
    "className" TEXT,
    "mode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schoolDate" DATE NOT NULL,
    "visitId" TEXT,
    "saveFingerprint" TEXT,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentQrCredential_tokenHash_key" ON "StudentQrCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "StudentQrCredential_studentId_revokedAt_idx" ON "StudentQrCredential"("studentId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanEvent_requestKey_key" ON "ScanEvent"("requestKey");

-- CreateIndex
CREATE INDEX "ScanEvent_schoolDate_mode_scannedAt_idx" ON "ScanEvent"("schoolDate", "mode", "scannedAt");

-- CreateIndex
CREATE INDEX "ScanEvent_studentId_mode_schoolDate_idx" ON "ScanEvent"("studentId", "mode", "schoolDate");

-- AddForeignKey
ALTER TABLE "StudentQrCredential" ADD CONSTRAINT "StudentQrCredential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "EuksVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only one current credential per student; history remains available after rotation.
CREATE UNIQUE INDEX "StudentQrCredential_one_active" ON "StudentQrCredential"("studentId") WHERE "revokedAt" IS NULL;
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_mode_check" CHECK ("mode" IN ('attendance', 'uks'));
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_source_check" CHECK ("source" IN ('CAMERA', 'USB', 'MANUAL'));
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_outcome_check" CHECK ("outcome" IN ('PRESENT', 'REPEAT', 'CONFLICT', 'UNKNOWN', 'HOLIDAY', 'OUTSIDE_WINDOW', 'DRAFT', 'SAVED', 'CANCELLED'));

-- Register code-owned keys, never assign or re-grant existing roles.
INSERT INTO "Permission" ("id", "key", "resource", "action", "scope", "label", "description", "module", "createdAt", "updatedAt") VALUES
 ('perm:scan.attendance.use', 'scan.attendance.use', 'scan.attendance', 'use', NULL, 'Scan kehadiran siswa', 'Tetap memerlukan attendance.write sesuai scope kelas.', 'attendance', NOW(), NOW()),
 ('perm:scan.uks.use', 'scan.uks.use', 'scan.uks', 'use', NULL, 'Scan kunjungan UKS', NULL, 'euks', NOW(), NOW()),
 ('perm:scan.history.read', 'scan.history.read', 'scan.history', 'read', NULL, 'Baca riwayat scan', 'Tetap memerlukan izin baca domain dan scope kelas.', 'attendance', NOW(), NOW()),
 ('perm:scan.cards.manage', 'scan.cards.manage', 'scan.cards', 'manage', NULL, 'Terbitkan dan ganti kartu QR siswa', NULL, 'students', NOW(), NOW())
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "description" = EXCLUDED."description", "updatedAt" = NOW();
