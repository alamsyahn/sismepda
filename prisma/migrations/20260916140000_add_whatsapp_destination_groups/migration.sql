-- Grup tujuan: setelan default lintas jenis + mode per jenis.
--
-- KOMPATIBILITAS MUNDUR
--
-- Sebelum migrasi ini, setiap baris WhatsAppConfiguration memegang JID-nya
-- sendiri dan tidak ada konsep "grup default". Memberi semua baris lama
-- destinationMode = DEFAULT akan membuat instalasi yang sudah berjalan
-- kehilangan tujuannya seketika: default masih kosong, sehingga jadwal yang
-- tadinya aktif berhenti mengirim tanpa ada yang mengubah apa pun.
--
-- Karena itu baris yang SUDAH punya JID ditandai OVERRIDE: tujuannya tetap
-- persis seperti sebelumnya. Baris yang belum punya JID boleh DEFAULT, karena
-- ia memang belum mengirim ke mana-mana.

CREATE TYPE "WhatsAppDestinationMode" AS ENUM ('DEFAULT', 'OVERRIDE');

CREATE TABLE "WhatsAppSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultGroupJid" TEXT,
    "defaultGroupName" TEXT,
    "defaultGroupResolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppSetting_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WhatsAppConfiguration"
    ADD COLUMN "destinationMode" "WhatsAppDestinationMode" NOT NULL DEFAULT 'DEFAULT';

-- Pertahankan tujuan instalasi lama.
UPDATE "WhatsAppConfiguration"
SET "destinationMode" = 'OVERRIDE'
WHERE "targetGroupJid" IS NOT NULL;
