CREATE TYPE "WorkbookItemStatus" AS ENUM ('UNREVIEWED', 'PRESENT', 'MISSING');

ALTER TABLE "User"
ADD COLUMN "canSuperviseWorkbooks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canViewWorkbookSupervision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "workbookSupervised" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Workbook" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 25,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Workbook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workbook_number_key" ON "Workbook"("number");

CREATE TABLE "WorkbookItem" (
    "id" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "WorkbookItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkbookItem_workbookId_sortOrder_key" ON "WorkbookItem"("workbookId", "sortOrder");

CREATE INDEX "WorkbookItem_workbookId_idx" ON "WorkbookItem"("workbookId");

CREATE TABLE "TeacherWorkbook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherWorkbook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherWorkbook_userId_workbookId_key" ON "TeacherWorkbook"("userId", "workbookId");

CREATE INDEX "TeacherWorkbook_workbookId_idx" ON "TeacherWorkbook"("workbookId");

CREATE TABLE "TeacherWorkbookItemStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workbookItemId" TEXT NOT NULL,
    "status" "WorkbookItemStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherWorkbookItemStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherWorkbookItemStatus_userId_workbookItemId_key" ON "TeacherWorkbookItemStatus"("userId", "workbookItemId");

CREATE INDEX "TeacherWorkbookItemStatus_userId_idx" ON "TeacherWorkbookItemStatus"("userId");

CREATE INDEX "TeacherWorkbookItemStatus_workbookItemId_idx" ON "TeacherWorkbookItemStatus"("workbookItemId");

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

CREATE INDEX "AuditLog_targetUserId_createdAt_idx" ON "AuditLog"("targetUserId", "createdAt");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

ALTER TABLE "WorkbookItem" ADD CONSTRAINT "WorkbookItem_workbookId_fkey"
FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherWorkbook" ADD CONSTRAINT "TeacherWorkbook_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherWorkbook" ADD CONSTRAINT "TeacherWorkbook_workbookId_fkey"
FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherWorkbookItemStatus" ADD CONSTRAINT "TeacherWorkbookItemStatus_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherWorkbookItemStatus" ADD CONSTRAINT "TeacherWorkbookItemStatus_workbookItemId_fkey"
FOREIGN KEY ("workbookItemId") REFERENCES "WorkbookItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherWorkbookItemStatus" ADD CONSTRAINT "TeacherWorkbookItemStatus_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
