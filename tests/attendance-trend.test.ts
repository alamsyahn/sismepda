import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  bucketKeys,
  bucketLabels,
  buildBuckets,
  defaultRange,
  formatPercentage,
  isTrendGranularity,
  jakartaDate,
  jakartaDateValue,
  jakartaEndOfDay,
  semesterStartValue,
  startOfWeekValue,
  statusPercentage,
  weekRangeLabel,
} from "../lib/attendance-trend"

test("tanggal diurai sebagai tengah malam waktu Jakarta", () => {
  const date = jakartaDate("2026-08-31")
  assert.ok(date)
  // 00:00 Jakarta = 17:00 UTC hari sebelumnya.
  assert.equal(date.toISOString(), "2026-08-30T17:00:00.000Z")
  // Bolak-balik harus stabil, bukan bergeser satu hari.
  assert.equal(jakartaDateValue(date), "2026-08-31")
})

test("akhir hari Jakarta menutup rentang secara inklusif", () => {
  const end = jakartaEndOfDay("2026-08-31")
  assert.ok(end)
  assert.equal(end.toISOString(), "2026-08-31T16:59:59.999Z")
  // Absensi yang disimpan pada tanggal itu tetap masuk rentang.
  assert.ok(jakartaDate("2026-08-31")! <= end)
})

test("tanggal tidak valid ditolak", () => {
  assert.equal(jakartaDate("2026-02-30"), null)
  assert.equal(jakartaDate("31-08-2026"), null)
  assert.equal(jakartaDate(""), null)
})

test("awal semester diturunkan dari pengaturan tahun ajaran yang sudah ada", () => {
  assert.equal(semesterStartValue({ academicYear: "2025/2026", semester: "Ganjil" }), "2025-07-01")
  assert.equal(semesterStartValue({ academicYear: "2025/2026", semester: "Genap" }), "2026-01-01")
  assert.equal(semesterStartValue({ academicYear: "2025 / 2026", semester: "genap" }), "2026-01-01")
  assert.equal(semesterStartValue({ academicYear: "2026", semester: "Ganjil" }), "2026-07-01")
})

test("tahun ajaran tak terbaca tidak di-hardcode menjadi tanggal karangan", () => {
  assert.equal(semesterStartValue({ academicYear: "belum diisi", semester: "Ganjil" }), null)
})

test("awal minggu adalah hari Senin", () => {
  // 2026-08-31 adalah Senin.
  assert.equal(startOfWeekValue("2026-08-31"), "2026-08-31")
  // 2026-09-06 adalah Minggu -> masih milik minggu yang dimulai 31 Agustus.
  assert.equal(startOfWeekValue("2026-09-06"), "2026-08-31")
  assert.equal(startOfWeekValue("2026-09-07"), "2026-09-07")
})

test("label minggu menampilkan tanggal nyata, bukan 'Minggu 1'", () => {
  assert.equal(weekRangeLabel("2026-08-24"), "24–30 Agustus 2026")
  // Minggu yang melewati batas bulan menyebut kedua bulan.
  assert.equal(weekRangeLabel("2026-08-31"), "31 Agustus–6 September 2026")
})

test("label bucket memakai format tanggal Indonesia", () => {
  assert.equal(bucketLabels("harian", "2026-08-31").tooltipLabel, "Senin, 31 Agustus 2026")
  assert.equal(bucketLabels("bulanan", "2026-08-01").tooltipLabel, "Agustus 2026")
  assert.equal(bucketLabels("mingguan", "2026-08-24").tooltipLabel, "24–30 Agustus 2026")
})

test("persentase dihitung terhadap seluruh record absensi valid", () => {
  // 12 sakit dari 850 record valid (termasuk Hadir) = 1.41%.
  assert.equal(statusPercentage(12, 850)?.toFixed(4), "1.4118")
  assert.equal(formatPercentage(statusPercentage(12, 850)), "1,4%")
})

test("bucket tanpa data valid menghasilkan null, bukan NaN atau Infinity", () => {
  assert.equal(statusPercentage(0, 0), null)
  assert.equal(statusPercentage(5, 0), null)
  assert.equal(formatPercentage(null), "–")
})

test("HADIR menambah penyebut tetapi bukan seri grafik", () => {
  const [bucket] = buildBuckets({
    granularity: "harian",
    bucketKeys: ["2026-08-31"],
    rows: [
      { bucket: "2026-08-31", status: "HADIR", total: 800 },
      { bucket: "2026-08-31", status: "SAKIT", total: 12 },
      { bucket: "2026-08-31", status: "IZIN", total: 7 },
      { bucket: "2026-08-31", status: "ALFA", total: 3 },
      { bucket: "2026-08-31", status: "DISPENSASI", total: 2 },
    ],
  })
  assert.deepEqual(bucket.counts, { sakit: 12, izin: 7, alfa: 3, dispensasi: 2 })
  // Penyebut = seluruh record valid, bukan hanya ketidakhadiran.
  assert.equal(bucket.validRecords, 824)
  // Alfa 3/824 = 0.36%, bukan 3/24 = 12.5% (komposisi absensi).
  assert.equal(formatPercentage(statusPercentage(bucket.counts.alfa, bucket.validRecords)), "0,4%")
})

test("bucket tanpa record sama sekali tetap muncul dengan nilai nol", () => {
  const buckets = buildBuckets({
    granularity: "harian",
    bucketKeys: ["2026-08-31", "2026-09-01", "2026-09-02"],
    rows: [{ bucket: "2026-09-01", status: "SAKIT", total: 4 }],
  })
  assert.equal(buckets.length, 3)
  // "Belum diisi" tidak punya record, jadi hari itu bernilai nol valid records
  // dan tidak boleh memperbaiki persentase secara semu.
  assert.equal(buckets[0].validRecords, 0)
  assert.deepEqual(buckets[0].counts, { sakit: 0, izin: 0, alfa: 0, dispensasi: 0 })
  assert.equal(statusPercentage(buckets[0].counts.alfa, buckets[0].validRecords), null)
  assert.equal(buckets[1].counts.sakit, 4)
})

test("deret bucket harian menutupi seluruh rentang", () => {
  const keys = bucketKeys("harian", "2026-08-30", "2026-09-02")
  assert.deepEqual(keys, ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"])
})

test("deret bucket mingguan dimulai dari hari Senin", () => {
  const keys = bucketKeys("mingguan", "2026-08-26", "2026-09-10")
  assert.deepEqual(keys, ["2026-08-24", "2026-08-31", "2026-09-07"])
})

test("deret bucket bulanan melintasi pergantian tahun", () => {
  assert.deepEqual(bucketKeys("bulanan", "2026-11-15", "2027-02-03"), [
    "2026-11-01",
    "2026-12-01",
    "2027-01-01",
    "2027-02-01",
  ])
})

test("sejak awal semester dikelompokkan per bulan", () => {
  const keys = bucketKeys("semester", "2026-07-01", "2026-09-15")
  assert.deepEqual(keys, ["2026-07-01", "2026-08-01", "2026-09-01"])
})

test("rentang default tidak membuat grafik terlalu padat", () => {
  assert.deepEqual(defaultRange("harian", "2026-08-31", null), { from: "2026-08-01", to: "2026-08-31" })
  assert.deepEqual(defaultRange("mingguan", "2026-08-31", null), { from: "2026-06-15", to: "2026-08-31" })
  assert.deepEqual(defaultRange("bulanan", "2026-08-31", null), { from: "2025-09-01", to: "2026-08-31" })
})

test("rentang sejak awal semester memakai awal semester aktif", () => {
  assert.deepEqual(defaultRange("semester", "2026-09-15", "2026-07-01"), {
    from: "2026-07-01",
    to: "2026-09-15",
  })
})

test("granularity dari query string divalidasi", () => {
  assert.ok(isTrendGranularity("mingguan"))
  assert.ok(!isTrendGranularity("tahunan"))
  assert.ok(!isTrendGranularity(undefined))
})
