-- Struktur waktu per HARI + template waktu yang dapat dipakai ulang.
--
-- KENAPA MIGRASI INI PERLU
--
-- Sampai sekarang sebuah profil waktu ("Reguler") hanya punya SATU struktur
-- generik: `ScheduleTimeSlot` menempel langsung pada profil, dan nomor period
-- aSc unik per profil. Akibatnya Jumat tidak dapat memiliki jam ke-1 yang lebih
-- pendek daripada Senin — padahal itu keadaan normal di sekolah.
--
-- Setelah migrasi ini, struktur waktu dimiliki sebuah HARI:
--
--   ScheduleTimeProfile → ScheduleProfileDay → ScheduleTimeSlot
--
-- Hari disimpan sebagai BARIS, bukan enam kolom, sehingga menambah atau
-- menghapus hari aktif tidak pernah membutuhkan migrasi baru.
--
-- STRATEGI: EXPAND → BACKFILL → SWITCH. Tidak ada kolom maupun baris lama yang
-- dibuang selama masih dibutuhkan, dan tidak ada satu pun slot existing yang
-- hilang: struktur generik yang ada SEKARANG disalin utuh ke Senin–Sabtu,
-- sehingga perilaku aplikasi sesudah migrasi identik dengan sebelumnya —
-- period 4 pada hari apa pun tetap menunjuk jam dinding yang sama.
--
-- DETERMINISTIK: id baris baru diturunkan dari md5(id sumber + hari), bukan
-- dari nilai acak, sehingga menjalankan migrasi pada salinan database yang sama
-- selalu menghasilkan id yang sama.

-- ---------------------------------------------------------------------------
-- 1. EXPAND — tabel dan kolom baru
-- ---------------------------------------------------------------------------

CREATE TABLE "ScheduleProfileDay" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleProfileDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduleProfileDay_profileId_day_key" ON "ScheduleProfileDay"("profileId", "day");
CREATE INDEX "ScheduleProfileDay_profileId_idx" ON "ScheduleProfileDay"("profileId");

ALTER TABLE "ScheduleProfileDay"
    ADD CONSTRAINT "ScheduleProfileDay_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "ScheduleTimeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScheduleTimeTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTimeTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduleTimeTemplate_name_key" ON "ScheduleTimeTemplate"("name");
CREATE INDEX "ScheduleTimeTemplate_updatedAt_idx" ON "ScheduleTimeTemplate"("updatedAt");

CREATE TABLE "ScheduleTimeTemplateSlot" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "ScheduleSlotKind" NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "ascPeriod" INTEGER,

    CONSTRAINT "ScheduleTimeTemplateSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduleTimeTemplateSlot_templateId_position_key" ON "ScheduleTimeTemplateSlot"("templateId", "position");
CREATE UNIQUE INDEX "ScheduleTimeTemplateSlot_templateId_ascPeriod_key" ON "ScheduleTimeTemplateSlot"("templateId", "ascPeriod");
CREATE INDEX "ScheduleTimeTemplateSlot_templateId_idx" ON "ScheduleTimeTemplateSlot"("templateId");

ALTER TABLE "ScheduleTimeTemplateSlot"
    ADD CONSTRAINT "ScheduleTimeTemplateSlot_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ScheduleTimeTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kolom penghubung dibuat NULLABLE dulu supaya baris existing tetap sah selama
-- backfill berjalan.
ALTER TABLE "ScheduleTimeSlot" ADD COLUMN "dayId" TEXT;

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — hari bawaan Senin–Sabtu untuk setiap profil
-- ---------------------------------------------------------------------------

-- Senin (1) sampai Sabtu (6): hari sekolah yang berlaku saat migrasi ini
-- ditulis. Ini hanya NILAI AWAL — setelahnya hari dikelola dari aplikasi.
INSERT INTO "ScheduleProfileDay" ("id", "profileId", "day", "position", "createdAt", "updatedAt")
SELECT
    'spd_' || substr(md5(p."id" || '|' || d."day"::text), 1, 21),
    p."id",
    d."day",
    d."day",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ScheduleTimeProfile" p
CROSS JOIN (SELECT generate_series(1, 6) AS "day") d;

-- Senin memakai baris slot yang SUDAH ADA (tidak ada data yang dipindahkan
-- maupun dibuat ulang), sehingga id slot lama tetap hidup.
UPDATE "ScheduleTimeSlot" s
SET "dayId" = d."id"
FROM "ScheduleProfileDay" d
WHERE d."profileId" = s."profileId"
  AND d."day" = 1;

-- Keunikan lama dilingkupi PROFIL: (profileId, position) dan (profileId,
-- ascPeriod). Begitu satu profil memiliki enam hari, lingkup itu justru salah —
-- Senin dan Selasa memang HARUS sama-sama punya position 1 dan period 1. Index
-- lama karena itu dibuang SEBELUM penyalinan, lalu dibangun kembali dengan
-- lingkup hari pada langkah 3.
DROP INDEX IF EXISTS "ScheduleTimeSlot_profileId_position_key";
DROP INDEX IF EXISTS "ScheduleTimeSlot_profileId_ascPeriod_key";

-- Selasa–Sabtu memperoleh SALINAN independen dari struktur generik lama.
INSERT INTO "ScheduleTimeSlot" ("id", "profileId", "dayId", "position", "kind", "name", "startMinute", "endMinute", "ascPeriod")
SELECT
    'sts_' || substr(md5(s."id" || '|' || d."day"::text), 1, 21),
    s."profileId",
    d."id",
    s."position",
    s."kind",
    s."name",
    s."startMinute",
    s."endMinute",
    s."ascPeriod"
FROM "ScheduleTimeSlot" s
JOIN "ScheduleProfileDay" d ON d."profileId" = s."profileId" AND d."day" BETWEEN 2 AND 6
WHERE s."dayId" IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM "ScheduleProfileDay" own
      WHERE own."id" = s."dayId" AND own."day" = 1
  );

-- ---------------------------------------------------------------------------
-- 3. SWITCH — keunikan pindah dari profil ke hari
-- ---------------------------------------------------------------------------

-- Slot yatim tidak mungkin ada di sini: setiap slot punya profil, dan setiap
-- profil baru saja kebagian enam hari. Kalau ternyata ada, itu tanda asumsi
-- kita tentang data produksi salah — maka migrasi DIBATALKAN, bukan menghapus
-- struktur waktu yang tidak kita mengerti. Seluruh migrasi berjalan dalam satu
-- transaksi, sehingga pembatalan di sini mengembalikan database seperti semula.
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT count(*) INTO orphan_count FROM "ScheduleTimeSlot" WHERE "dayId" IS NULL;
    IF orphan_count > 0 THEN
        RAISE EXCEPTION
            'Migrasi dibatalkan: % baris ScheduleTimeSlot tidak terhubung ke hari mana pun. Periksa data profil waktu sebelum mengulang migrasi.',
            orphan_count;
    END IF;
END $$;

ALTER TABLE "ScheduleTimeSlot" ALTER COLUMN "dayId" SET NOT NULL;

CREATE UNIQUE INDEX "ScheduleTimeSlot_dayId_position_key" ON "ScheduleTimeSlot"("dayId", "position");
CREATE UNIQUE INDEX "ScheduleTimeSlot_dayId_ascPeriod_key" ON "ScheduleTimeSlot"("dayId", "ascPeriod");
CREATE INDEX "ScheduleTimeSlot_dayId_idx" ON "ScheduleTimeSlot"("dayId");

ALTER TABLE "ScheduleTimeSlot"
    ADD CONSTRAINT "ScheduleTimeSlot_dayId_fkey"
    FOREIGN KEY ("dayId") REFERENCES "ScheduleProfileDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
