-- Modul Sarpras: hak akses per-user, tree lokasi, master jenis barang,
-- item per lokasi, foto, dan riwayat perubahan kondisi.

ALTER TABLE "User"
ADD COLUMN "canViewSarpras" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canEditSarpras" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SarprasPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "SarprasLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SarprasLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SarprasLocation_parentId_slug_key" ON "SarprasLocation"("parentId", "slug");

-- Postgres menganggap NULL saling berbeda, sehingga unique index di atas tidak
-- menjaga lokasi root. Index parsial ini menutup celah tersebut.
CREATE UNIQUE INDEX "SarprasLocation_root_slug_key"
ON "SarprasLocation"("slug") WHERE "parentId" IS NULL;

CREATE INDEX "SarprasLocation_parentId_sortOrder_idx" ON "SarprasLocation"("parentId", "sortOrder");

CREATE TABLE "SarprasItemType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SarprasItemType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SarprasItemType_slug_key" ON "SarprasItemType"("slug");

CREATE TABLE "SarprasItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemTypeId" TEXT NOT NULL,
    "targetQuantity" INTEGER NOT NULL DEFAULT 0,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "goodQuantity" INTEGER NOT NULL DEFAULT 0,
    "moderateQuantity" INTEGER NOT NULL DEFAULT 0,
    "repairQuantity" INTEGER NOT NULL DEFAULT 0,
    "acquisitionDate" TIMESTAMP(3),
    "inventoryCode" TEXT,
    "description" TEXT,
    "priority" "SarprasPriority",
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SarprasItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SarprasItem_locationId_itemTypeId_key" ON "SarprasItem"("locationId", "itemTypeId");

CREATE INDEX "SarprasItem_locationId_idx" ON "SarprasItem"("locationId");

CREATE INDEX "SarprasItem_itemTypeId_idx" ON "SarprasItem"("itemTypeId");

-- Identitas akuntansi kondisi dijaga di level database, bukan hanya di aplikasi.
ALTER TABLE "SarprasItem" ADD CONSTRAINT "SarprasItem_quantities_check" CHECK (
    "targetQuantity" >= 0
    AND "availableQuantity" >= 0
    AND "goodQuantity" >= 0
    AND "moderateQuantity" >= 0
    AND "repairQuantity" >= 0
    AND "goodQuantity" + "moderateQuantity" + "repairQuantity" = "availableQuantity"
);

CREATE TABLE "SarprasPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SarprasPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SarprasPhoto_itemId_sortOrder_idx" ON "SarprasPhoto"("itemId", "sortOrder");

CREATE TABLE "SarprasHistory" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SarprasHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SarprasHistory_itemId_createdAt_idx" ON "SarprasHistory"("itemId", "createdAt");

-- Lokasi induk tidak boleh terhapus selama masih punya anak (RESTRICT).
ALTER TABLE "SarprasLocation" ADD CONSTRAINT "SarprasLocation_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "SarprasLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lokasi/jenis barang tidak boleh terhapus selama masih dipakai item (RESTRICT).
ALTER TABLE "SarprasItem" ADD CONSTRAINT "SarprasItem_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "SarprasLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SarprasItem" ADD CONSTRAINT "SarprasItem_itemTypeId_fkey"
FOREIGN KEY ("itemTypeId") REFERENCES "SarprasItemType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SarprasItem" ADD CONSTRAINT "SarprasItem_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SarprasItem" ADD CONSTRAINT "SarprasItem_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foto dan riwayat ikut terhapus bersama itemnya (CASCADE).
ALTER TABLE "SarprasPhoto" ADD CONSTRAINT "SarprasPhoto_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "SarprasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SarprasHistory" ADD CONSTRAINT "SarprasHistory_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "SarprasItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SarprasHistory" ADD CONSTRAINT "SarprasHistory_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
