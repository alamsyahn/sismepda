-- Analisis read-only tanggal bisnis legacy pada AttendanceDay (TD-014).
--
-- Konteks historis: penulis lama menyimpan tengah malam Asia/Jakarta sebagai UTC,
-- sehingga `2026-09-06 17:00:00` berarti business date `2026-09-07`.
-- Aturan konversi: (nilai AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date.
-- Nilai yang sudah 00:00:00 dianggap sudah kanonik dan tidak digeser.
--
-- Skrip ini TIDAK menulis apa pun. Jalankan lewat `npm run db:analyze-legacy-dates`.

\set ON_ERROR_STOP on

-- Sebutan business date untuk tiap baris, dipakai ulang oleh semua bagian.
CREATE TEMP VIEW legacy_day AS
SELECT
  d.id,
  d."classId",
  d.date AS stored_value,
  d.date::time AS stored_time,
  CASE
    WHEN d.date::time = time '00:00:00' THEN d.date::date
    ELSE (d.date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date
  END AS business_date,
  d.date::time <> time '00:00:00' AS needs_shift
FROM "AttendanceDay" d;

\echo '== 1. Sebaran nilai jam yang tersimpan =='
SELECT
  stored_time AS jam_tersimpan,
  count(*) AS jumlah_baris,
  min(stored_value)::date AS dari,
  max(stored_value)::date AS sampai
FROM legacy_day
GROUP BY stored_time
ORDER BY jumlah_baris DESC;

\echo ''
\echo '== 2. Pergeseran tanggal yang akan diterapkan pada baris non-midnight =='
SELECT
  stored_value AS nilai_tersimpan,
  business_date AS business_date_hasil,
  count(*) AS jumlah_baris
FROM legacy_day
WHERE needs_shift
GROUP BY stored_value, business_date
ORDER BY stored_value;

\echo ''
\echo '== 3. Ringkasan collision (classId, business_date) =='
WITH collision AS (
  SELECT "classId", business_date
  FROM legacy_day
  GROUP BY "classId", business_date
  HAVING count(*) > 1
)
SELECT
  (SELECT count(*) FROM collision) AS pasangan_collision,
  (SELECT count(*) FROM legacy_day WHERE needs_shift) AS baris_digeser,
  (SELECT count(*) FROM legacy_day) AS total_baris;

\echo ''
\echo '== 4. Klasifikasi tiap collision =='
-- Untuk tiap pasangan bertabrakan dibandingkan seluruh child Attendance-nya
-- per studentId. Kolom `followUp` sengaja tidak dibandingkan: kolom tersebut
-- baru ditambahkan migrasi 20260911170000, jadi belum ada pada tahap repair ini.
WITH collision AS (
  SELECT "classId", business_date
  FROM legacy_day
  GROUP BY "classId", business_date
  HAVING count(*) > 1
),
member AS (
  SELECT l.*, c.business_date AS collision_date
  FROM legacy_day l
  JOIN collision c ON c."classId" = l."classId" AND c.business_date = l.business_date
),
-- Satu baris per (collision, siswa, isi absensi) untuk mendeteksi kesamaan isi.
per_student AS (
  SELECT
    m."classId",
    m.collision_date,
    a."studentId",
    count(*) AS kemunculan,
    count(DISTINCT (a.status::text, coalesce(a.note, '\x00'))) AS varian_isi
  FROM member m
  JOIN "Attendance" a ON a."attendanceDayId" = m.id
  GROUP BY m."classId", m.collision_date, a."studentId"
),
klasifikasi AS (
  SELECT
    "classId",
    collision_date,
    count(*) FILTER (WHERE kemunculan > 1) AS siswa_tumpang_tindih,
    count(*) FILTER (WHERE kemunculan > 1 AND varian_isi > 1) AS siswa_konflik
  FROM per_student
  GROUP BY "classId", collision_date
)
SELECT
  CASE
    WHEN siswa_tumpang_tindih = 0 THEN 'MERGE  (tidak tumpang tindih)'
    WHEN siswa_konflik = 0 THEN 'DEDUPE (tumpang tindih, isi identik)'
    ELSE 'KONFLIK (butuh keputusan manual)'
  END AS klasifikasi,
  count(*) AS jumlah_pasangan
FROM klasifikasi
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '== 5. Detail konflik nyata (jika ada) =='
WITH collision AS (
  SELECT "classId", business_date
  FROM legacy_day
  GROUP BY "classId", business_date
  HAVING count(*) > 1
),
member AS (
  SELECT l.*, c.business_date AS collision_date
  FROM legacy_day l
  JOIN collision c ON c."classId" = l."classId" AND c.business_date = l.business_date
),
konflik AS (
  SELECT
    m."classId",
    m.collision_date,
    a."studentId",
    count(DISTINCT (a.status::text, coalesce(a.note, '\x00'))) AS varian_isi
  FROM member m
  JOIN "Attendance" a ON a."attendanceDayId" = m.id
  GROUP BY m."classId", m.collision_date, a."studentId"
  HAVING count(*) > 1 AND count(DISTINCT (a.status::text, coalesce(a.note, '\x00'))) > 1
)
SELECT
  s.name AS siswa,
  c2.name AS kelas,
  k.collision_date AS business_date,
  m.stored_value AS baris_asal,
  a.status,
  coalesce(a.note, '(kosong)') AS note
FROM konflik k
JOIN member m ON m."classId" = k."classId" AND m.business_date = k.collision_date
JOIN "Attendance" a ON a."attendanceDayId" = m.id AND a."studentId" = k."studentId"
JOIN "Student" s ON s.id = k."studentId"
JOIN "SchoolClass" c2 ON c2.id = k."classId"
ORDER BY kelas, siswa, m.stored_value;

\echo ''
\echo '== 6. Jumlah Attendance yang terlibat (tidak boleh berubah setelah repair) =='
SELECT
  count(*) AS attendance_dalam_collision
FROM "Attendance" a
WHERE a."attendanceDayId" IN (
  SELECT l.id
  FROM legacy_day l
  JOIN (
    SELECT "classId", business_date
    FROM legacy_day
    GROUP BY "classId", business_date
    HAVING count(*) > 1
  ) c ON c."classId" = l."classId" AND c.business_date = l.business_date
);
