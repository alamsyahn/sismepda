ALTER TABLE "User"
ADD COLUMN "photoData" BYTEA,
ADD COLUMN "photoMimeType" TEXT,
ADD COLUMN "photoUpdatedAt" TIMESTAMP(3),
ADD CONSTRAINT "User_photo_consistency_check" CHECK (
  ("photoData" IS NULL AND "photoMimeType" IS NULL AND "photoUpdatedAt" IS NULL)
  OR
  ("photoData" IS NOT NULL AND "photoMimeType" IS NOT NULL AND "photoUpdatedAt" IS NOT NULL)
),
ADD CONSTRAINT "User_photo_size_check" CHECK (
  "photoData" IS NULL OR octet_length("photoData") <= 1048576
),
ADD CONSTRAINT "User_photo_mime_check" CHECK (
  "photoMimeType" IS NULL OR "photoMimeType" IN ('image/jpeg', 'image/png', 'image/webp')
);

-- @unique milik Prisma tetap dipertahankan. Indeks ini menutup kemungkinan
-- dua email yang hanya berbeda kapitalisasi dan membuat login ambigu.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (LOWER("email")) WHERE "email" IS NOT NULL;
