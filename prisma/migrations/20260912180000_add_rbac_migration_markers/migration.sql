-- RBAC Phase 3: penanda migrasi/kesiapan.
--
-- Aditif. Tidak menyentuh User, enum "Role", maupun tabel RBAC Phase 2.
-- RbacMigration menyimpan status pekerjaan one-time (backfill akses legacy)
-- dan menjadi sumber status kesiapan RBAC. RbacMigrationItem mencatat akun
-- yang sudah tuntas agar percobaan ulang bersifat resumable.

-- CreateEnum
CREATE TYPE "RbacMigrationStatus" AS ENUM ('RUNNING', 'FAILED', 'COMPLETED');

-- CreateTable
CREATE TABLE "RbacMigration" (
    "key" TEXT NOT NULL,
    "status" "RbacMigrationStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "report" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RbacMigration_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RbacMigrationItem" (
    "migrationKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RbacMigrationItem_pkey" PRIMARY KEY ("migrationKey","userId")
);

-- CreateIndex
CREATE INDEX "RbacMigrationItem_userId_idx" ON "RbacMigrationItem"("userId");

-- AddForeignKey
ALTER TABLE "RbacMigrationItem" ADD CONSTRAINT "RbacMigrationItem_migrationKey_fkey" FOREIGN KEY ("migrationKey") REFERENCES "RbacMigration"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RbacMigrationItem" ADD CONSTRAINT "RbacMigrationItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
