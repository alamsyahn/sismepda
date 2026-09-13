-- Repair data legacy tanggal bisnis `AttendanceDay` sebelum migrasi date-only.
--
-- Dijalankan SEBELUM `20260909100000_use_date_for_business_dates`, dan tidak
-- pernah mengubah migrasi tersebut maupun guard-nya. Migrasi itu tetap menjadi
-- pemeriksa terakhir: kalau repair ini keliru, guard tetap membatalkan.
--
-- Konteks historis: penulis lama menyimpan tengah malam Asia/Jakarta sebagai
-- UTC, sehingga `2026-09-06 17:00:00` berarti business date `2026-09-07`.
--
-- Kebijakan penyelesaian tabrakan (keputusan pemilik data, bukan hasil
-- forensik): bila satu kelas punya dua baris untuk business date yang sama,
-- baris dengan `submittedAt` paling akhir yang dipertahankan. AuditLog tidak
-- memuat jejak absensi, sehingga tidak ada bukti sistem yang menyatakan salah
-- satu baris adalah koreksi atas baris lain.
--
-- Skrip ini idempoten: dijalankan ulang terhadap clone yang sudah diperbaiki
-- tidak mengubah apa pun.

\set ON_ERROR_STOP on

BEGIN;

-- Kunci yang sama dengan migrasi date-only: blokir tulisan legacy selama
-- klasifikasi dan perbaikan berlangsung dalam satu transaksi.
LOCK TABLE "AttendanceDay" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Attendance" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE legacy_day ON COMMIT DROP AS
SELECT
  id,
  "classId",
  date,
  "submittedAt",
  CASE
    WHEN date::time = time '00:00:00' THEN date::date
    ELSE (date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date
  END AS business_date
FROM "AttendanceDay";

CREATE TEMP TABLE collision_pair ON COMMIT DROP AS
SELECT "classId", business_date
FROM legacy_day
GROUP BY "classId", business_date
HAVING count(*) > 1;

-- Pemenang tiap tabrakan: `submittedAt` terakhir; `id` hanya pemutus seri agar
-- hasil deterministik saat diulang.
CREATE TEMP TABLE resolution ON COMMIT DROP AS
SELECT DISTINCT ON (l."classId", l.business_date)
  l."classId",
  l.business_date,
  l.id AS keep_id
FROM legacy_day l
JOIN collision_pair c ON c."classId" = l."classId" AND c.business_date = l.business_date
ORDER BY l."classId", l.business_date, l."submittedAt" DESC, l.id DESC;

CREATE TEMP TABLE discard ON COMMIT DROP AS
SELECT l.id AS discard_id, r.keep_id
FROM legacy_day l
JOIN resolution r ON r."classId" = l."classId" AND r.business_date = l.business_date
WHERE l.id <> r.keep_id;

\echo '-- Baris yang dipertahankan / dibuang --'
SELECT
  (SELECT count(*) FROM collision_pair) AS pasangan_tabrakan,
  (SELECT count(*) FROM discard) AS baris_dibuang,
  (SELECT count(*) FROM legacy_day WHERE date::time <> time '00:00:00') AS baris_digeser;

-- Siswa yang hanya tercatat pada baris yang dibuang dipindahkan, bukan dihapus.
-- Pada data saat ini jumlahnya nol, tetapi langkah ini membuat repair tetap aman
-- bila clone berikutnya memuat pasangan yang tidak sepenuhnya tumpang tindih.
WITH moved AS (
  UPDATE "Attendance" a
  SET "attendanceDayId" = d.keep_id
  FROM discard d
  WHERE a."attendanceDayId" = d.discard_id
    AND NOT EXISTS (
      SELECT 1 FROM "Attendance" k
      WHERE k."attendanceDayId" = d.keep_id AND k."studentId" = a."studentId"
    )
  RETURNING 1
)
SELECT count(*) AS attendance_dipindahkan FROM moved;

-- Bila status dua baris identik, pertahankan catatan yang paling informatif.
-- Catatan yang lebih panjang dianggap lebih informatif; status tidak pernah
-- diubah oleh langkah ini.
WITH enriched AS (
  UPDATE "Attendance" k
  SET note = a.note
  FROM discard d
  JOIN "Attendance" a ON a."attendanceDayId" = d.discard_id
  WHERE k."attendanceDayId" = d.keep_id
    AND k."studentId" = a."studentId"
    AND k.status = a.status
    AND coalesce(length(a.note), 0) > coalesce(length(k.note), 0)
  RETURNING 1
)
SELECT count(*) AS catatan_diperkaya FROM enriched;

DELETE FROM "AttendanceDay" WHERE id IN (SELECT discard_id FROM discard);

-- Setelah tabrakan bersih, geser nilai non-midnight ke business date-nya.
-- Kolom masih bertipe timestamp pada tahap ini, jadi nilai ditulis sebagai
-- tengah malam kanonik agar guard migrasi date-only menerimanya.
WITH shifted AS (
  UPDATE "AttendanceDay"
  SET date = (date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date::timestamp
  WHERE date::time <> time '00:00:00'
  RETURNING 1
)
SELECT count(*) AS tanggal_dikoreksi FROM shifted;

-- Pemeriksaan akhir di dalam transaksi yang sama: bila salah satu gagal,
-- seluruh repair dibatalkan dan database tetap seperti semula.
DO $$
DECLARE
  sisa_ambigu BIGINT;
  sisa_tabrakan BIGINT;
BEGIN
  SELECT count(*) INTO sisa_ambigu FROM "AttendanceDay" WHERE date::time <> time '00:00:00';
  IF sisa_ambigu > 0 THEN
    RAISE EXCEPTION 'Repair dibatalkan: masih ada % nilai non-midnight', sisa_ambigu;
  END IF;

  SELECT count(*) INTO sisa_tabrakan FROM (
    SELECT 1 FROM "AttendanceDay" GROUP BY "classId", date::date HAVING count(*) > 1
  ) s;
  IF sisa_tabrakan > 0 THEN
    RAISE EXCEPTION 'Repair dibatalkan: masih ada % tabrakan (classId, date)', sisa_tabrakan;
  END IF;
END $$;

COMMIT;
