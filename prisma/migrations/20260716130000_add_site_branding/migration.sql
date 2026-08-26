ALTER TABLE "SchoolSetting"
ADD COLUMN "websiteTitle" TEXT NOT NULL DEFAULT 'SISMEPDA — Dashboard Absensi Sekolah',
ADD COLUMN "faviconData" BYTEA,
ADD COLUMN "faviconMimeType" TEXT,
ADD COLUMN "faviconUpdatedAt" TIMESTAMP(3);

ALTER TABLE "SchoolSetting"
ADD CONSTRAINT "SchoolSetting_favicon_complete"
CHECK (
  ("faviconData" IS NULL AND "faviconMimeType" IS NULL AND "faviconUpdatedAt" IS NULL)
  OR
  ("faviconData" IS NOT NULL AND "faviconMimeType" IS NOT NULL AND "faviconUpdatedAt" IS NOT NULL)
);

ALTER TABLE "SchoolSetting"
ADD CONSTRAINT "SchoolSetting_favicon_size"
CHECK ("faviconData" IS NULL OR octet_length("faviconData") <= 524288);

ALTER TABLE "SchoolSetting"
ADD CONSTRAINT "SchoolSetting_favicon_type"
CHECK ("faviconMimeType" IS NULL OR "faviconMimeType" IN ('image/png', 'image/x-icon'));
