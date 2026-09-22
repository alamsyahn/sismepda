-- Kartu pesan WhatsApp: satu tabel untuk pesan bawaan, pesan buatan admin, dan
-- kartu "Pesan manual".
--
-- MENGAPA TABEL BARU, BUKAN MENGUBAH WhatsAppConfiguration
--
-- Primary key `WhatsAppConfiguration.type` adalah enum `WhatsAppMessageType`,
-- dan `WhatsAppSendLog.type` adalah foreign key ke kolom itu. Menampung pesan
-- buatan admin di tabel lama berarti mengubah tipe primary key sekaligus tipe
-- kolom yang sedang di-FK pada tabel riwayat produksi — lima DDL destruktif
-- berurutan, table rewrite pada tabel riwayat, dan keadaan tanpa PK/FK bila
-- gagal di tengah. Seluruh migrasi ini sebaliknya bersifat aditif: tidak ada
-- kolom yang berubah tipe dan tidak ada baris lama yang ditulis ulang.
--
-- BACKFILL IDEMPOTEN. Bagian DDL di atas hanya dijalankan sekali oleh Prisma,
-- tetapi setiap INSERT kartu pesan di bawah memakai `WHERE NOT EXISTS` agar
-- pengulangan manual (mis. menjalankan berkas ini terhadap database yang sudah
-- berisi kartu) tidak menghasilkan kartu kedua. Ini penting karena baris hasil
-- backfill memegang jadwal yang benar-benar mengirim ke grup sekolah; kartu
-- ganda berarti pesan ganda.

CREATE TYPE "WhatsAppMessageKind" AS ENUM ('BUILTIN', 'CUSTOM', 'MANUAL');

CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "kind" "WhatsAppMessageKind" NOT NULL,
    "builtinType" "WhatsAppMessageType",
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requireAttendanceActivity" BOOLEAN NOT NULL DEFAULT false,
    "destinationMode" "WhatsAppDestinationMode" NOT NULL DEFAULT 'DEFAULT',
    "targetGroupJid" TEXT,
    "targetGroupName" TEXT,
    "targetResolvedAt" TIMESTAMP(3),
    "slots" TEXT[],
    "messageTemplates" JSONB,
    "selectedVariables" TEXT[],
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppMessage_builtinType_key" ON "WhatsAppMessage"("builtinType");
CREATE INDEX "WhatsAppMessage_sortOrder_idx" ON "WhatsAppMessage"("sortOrder");

-- Backfill kartu bawaan DARI konfigurasi yang sudah berjalan.
--
-- Nilainya disalin, bukan diisi ulang dengan nilai bawaan: sekolah yang sudah
-- mengatur jam, grup tujuan, dan template harus menemukan halamannya persis
-- seperti sebelum migrasi. Menyeragamkannya ke nilai bawaan akan mematikan
-- jadwal yang aktif atau mengarahkannya ke grup lain.
--
-- `id` deterministik (bukan cuid acak) supaya migrasi ini dapat diulang tanpa
-- menghasilkan kartu kedua untuk jenis yang sama, dan supaya dukungan teknis
-- dapat menyebut baris yang sama di lingkungan mana pun.
INSERT INTO "WhatsAppMessage" (
    "id", "kind", "builtinType", "title", "description", "sortOrder",
    "enabled", "requireAttendanceActivity", "destinationMode",
    "targetGroupJid", "targetGroupName", "targetResolvedAt",
    "slots", "messageTemplates", "selectedVariables", "lastSentAt", "updatedAt"
)
SELECT
    'wa-msg-attendance-missing',
    'BUILTIN',
    'ATTENDANCE_MISSING',
    'Kelas belum mengisi absensi',
    'Daftar kelas yang belum mengisi atau melengkapi absensi hari itu.',
    0,
    c."enabled",
    false,
    c."destinationMode",
    c."targetGroupJid",
    c."targetGroupName",
    c."targetResolvedAt",
    c."slots",
    c."messageTemplates",
    ARRAY[]::TEXT[],
    c."lastSentAt",
    CURRENT_TIMESTAMP
FROM "WhatsAppConfiguration" c
WHERE c."type" = 'ATTENDANCE_MISSING'
  AND NOT EXISTS (
    SELECT 1 FROM "WhatsAppMessage" m WHERE m."builtinType" = 'ATTENDANCE_MISSING'
  );

INSERT INTO "WhatsAppMessage" (
    "id", "kind", "builtinType", "title", "description", "sortOrder",
    "enabled", "requireAttendanceActivity", "destinationMode",
    "targetGroupJid", "targetGroupName", "targetResolvedAt",
    "slots", "messageTemplates", "selectedVariables", "lastSentAt", "updatedAt"
)
SELECT
    'wa-msg-attendance-absent',
    'BUILTIN',
    'ATTENDANCE_ABSENT',
    'Rekap siswa tidak hadir',
    'Rekap siswa yang tidak hadir hari itu beserta jumlah per status.',
    1,
    c."enabled",
    false,
    c."destinationMode",
    c."targetGroupJid",
    c."targetGroupName",
    c."targetResolvedAt",
    c."slots",
    c."messageTemplates",
    ARRAY[]::TEXT[],
    c."lastSentAt",
    CURRENT_TIMESTAMP
FROM "WhatsAppConfiguration" c
WHERE c."type" = 'ATTENDANCE_ABSENT'
  AND NOT EXISTS (
    SELECT 1 FROM "WhatsAppMessage" m WHERE m."builtinType" = 'ATTENDANCE_ABSENT'
  );

-- Instalasi yang belum pernah menyimpan konfigurasi tidak punya baris di
-- WhatsAppConfiguration sama sekali. Kartunya tetap harus ada — halaman tanpa
-- kartu bawaan akan tampak seperti fitur yang hilang — jadi dibuat dalam
-- keadaan nonaktif tanpa tujuan, yaitu keadaan yang sama dengan sebelum admin
-- menyentuh apa pun.
INSERT INTO "WhatsAppMessage" (
    "id", "kind", "builtinType", "title", "description", "sortOrder",
    "slots", "selectedVariables", "updatedAt"
)
SELECT 'wa-msg-attendance-missing', 'BUILTIN', 'ATTENDANCE_MISSING',
       'Kelas belum mengisi absensi',
       'Daftar kelas yang belum mengisi atau melengkapi absensi hari itu.',
       0, ARRAY['08:00', '10:00']::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "WhatsAppMessage" m WHERE m."builtinType" = 'ATTENDANCE_MISSING'
);

INSERT INTO "WhatsAppMessage" (
    "id", "kind", "builtinType", "title", "description", "sortOrder",
    "slots", "selectedVariables", "updatedAt"
)
SELECT 'wa-msg-attendance-absent', 'BUILTIN', 'ATTENDANCE_ABSENT',
       'Rekap siswa tidak hadir',
       'Rekap siswa yang tidak hadir hari itu beserta jumlah per status.',
       1, ARRAY['12:00']::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "WhatsAppMessage" m WHERE m."builtinType" = 'ATTENDANCE_ABSENT'
);

-- Kartu "Pesan manual". Tanpa jadwal dan tanpa template: `slots` kosong berarti
-- scheduler tidak akan pernah melihatnya, sehingga kartu ini tidak dapat
-- mengirim apa pun selain lewat tombol yang ditekan admin.
INSERT INTO "WhatsAppMessage" (
    "id", "kind", "builtinType", "title", "description", "sortOrder",
    "slots", "selectedVariables", "updatedAt"
)
SELECT 'wa-msg-manual', 'MANUAL', NULL,
       'Pesan manual',
       'Kirim pesan bebas ke grup WhatsApp tanpa template dan tanpa jadwal.',
       2, ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "WhatsAppMessage" m WHERE m."kind" = 'MANUAL'
);

-- Riwayat menunjuk ke kartu pesan.
--
-- NULLABLE, dan kolom `type` lama tidak dihapus: mengubah tabel riwayat menjadi
-- NOT NULL menuntut rewrite seluruh tabel dan membuat rollback aplikasi tidak
-- mungkin. Baris lama diisi lewat pemetaan `type` → kartu bawaan di bawah.
ALTER TABLE "WhatsAppSendLog" ADD COLUMN "messageId" TEXT;

ALTER TABLE "WhatsAppSendLog"
    ADD CONSTRAINT "WhatsAppSendLog_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WhatsAppSendLog_messageId_attemptedAt_idx"
    ON "WhatsAppSendLog"("messageId", "attemptedAt");

UPDATE "WhatsAppSendLog" l
SET "messageId" = m."id"
FROM "WhatsAppMessage" m
WHERE m."builtinType" = l."type"
  AND l."messageId" IS NULL;
