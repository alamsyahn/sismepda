ALTER TABLE "User"
ADD COLUMN "canViewBos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canCreateBos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canEditBos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canManageBosCategories" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canManageBosAccess" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BosSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "initialBudget" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BosSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BosCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BosCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BosCategory_slug_key" ON "BosCategory"("slug");

CREATE TABLE "BosEntry" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BosEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BosEntry_categoryId_idx" ON "BosEntry"("categoryId");

CREATE INDEX "BosEntry_occurredAt_idx" ON "BosEntry"("occurredAt");

CREATE TABLE "BosDocument" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "label" TEXT,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BosDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BosDocument_entryId_idx" ON "BosDocument"("entryId");

ALTER TABLE "BosEntry" ADD CONSTRAINT "BosEntry_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "BosCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BosEntry" ADD CONSTRAINT "BosEntry_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BosEntry" ADD CONSTRAINT "BosEntry_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BosDocument" ADD CONSTRAINT "BosDocument_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "BosEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
