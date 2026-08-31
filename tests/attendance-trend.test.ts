import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  bucketKeys,
  bucketLabels,
  buildClassifiedBuckets,
  buildBuckets,
  comparisonChange,
  defaultRange,
  formatPercentage,
  isTrendGranularity,
  jakartaDate,
  jakartaDateValue,
  jakartaEndOfDay,
  missingPercentage,
  niceTrendMaximum,
  previousRange,
  semesterStartValue,
  selectedStatusTotal,
  stackSegmentOrder,
  startOfWeekValue,
  statusPercentage,
  tooltipPlacement,
  trendValue,
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

test("toggle status membatasi seri dan total tanpa mengubah data bucket", () => {
  const [first, second] = buildBuckets({
    granularity: "harian",
    bucketKeys: ["2026-08-30", "2026-08-31"],
    rows: [
      { bucket: "2026-08-30", status: "HADIR", total: 90 },
      { bucket: "2026-08-30", status: "SAKIT", total: 2 },
      { bucket: "2026-08-30", status: "ALFA", total: 8 },
      { bucket: "2026-08-31", status: "HADIR", total: 95 },
      { bucket: "2026-08-31", status: "IZIN", total: 3 },
      { bucket: "2026-08-31", status: "ALFA", total: 2 },
    ],
  })

  assert.equal(selectedStatusTotal([first, second], ["alfa"]), 10)
  assert.equal(selectedStatusTotal([first, second], ["sakit", "izin"]), 5)
  assert.equal(selectedStatusTotal([first, second], ["sakit", "izin", "alfa", "dispensasi"]), 15)
  assert.equal(trendValue(first, "alfa", "jumlah"), 8)
  assert.equal(formatPercentage(trendValue(first, "alfa", "persentase")), "8%")
  assert.deepEqual(first.counts, { sakit: 2, izin: 0, alfa: 8, dispensasi: 0 })
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

test("hari aktif parsial menghitung Belum diisi dari siswa aktif seluruh kelas terkait", () => {
  const [bucket] = buildClassifiedBuckets({
    granularity: "harian", from: "2026-08-31", to: "2026-08-31", today: "2026-08-31",
    expectedByClass: { "ix-a": 30, "ix-b": 28 },
    submittedDays: [{ date: "2026-08-31", classId: "ix-a" }],
    rows: [
      { date: "2026-08-31", classId: "ix-a", status: "HADIR", total: 27 },
      { date: "2026-08-31", classId: "ix-a", status: "SAKIT", total: 2 },
    ], holidays: [],
  })
  assert.equal(bucket.state, "active")
  assert.equal(bucket.validRecords, 29)
  assert.equal(bucket.expectedAttendance, 58)
  assert.equal(bucket.missingRecords, 29)
  assert.equal(formatPercentage(missingPercentage(bucket)), "50%")
  assert.equal(bucket.isCurrentDay, true)
})

test("hari lengkap menghasilkan nol Belum diisi yang diketahui", () => {
  const [bucket] = buildClassifiedBuckets({
    granularity: "harian", from: "2026-08-30", to: "2026-08-30", today: "2026-08-31",
    expectedByClass: { "ix-a": 30 }, submittedDays: [{ date: "2026-08-30", classId: "ix-a" }],
    rows: [{ date: "2026-08-30", classId: "ix-a", status: "HADIR", total: 30 }], holidays: [],
  })
  assert.equal(bucket.state, "active")
  assert.equal(bucket.missingRecords, 0)
  assert.equal(missingPercentage(bucket), 0)
})

test("tanggal tanpa pengiriman adalah Tidak ada data, bukan Belum diisi", () => {
  const [bucket] = buildClassifiedBuckets({
    granularity: "harian", from: "2026-08-29", to: "2026-08-29", today: "2026-08-31",
    expectedByClass: { "ix-a": 30 }, submittedDays: [], rows: [], holidays: [],
  })
  assert.equal(bucket.state, "no_data")
  assert.equal(bucket.expectedAttendance, 0)
  assert.equal(bucket.missingRecords, 0)
  assert.equal(missingPercentage(bucket), null)
})

test("SchoolHoliday menang atas record dan tidak masuk metrik", () => {
  const [bucket] = buildClassifiedBuckets({
    granularity: "harian", from: "2026-08-17", to: "2026-08-17", today: "2026-08-31",
    expectedByClass: { "ix-a": 30 }, submittedDays: [{ date: "2026-08-17", classId: "ix-a" }],
    rows: [{ date: "2026-08-17", classId: "ix-a", status: "ALFA", total: 30 }],
    holidays: [{ date: "2026-08-17", name: "Hari Kemerdekaan" }],
  })
  assert.equal(bucket.state, "holiday")
  assert.deepEqual(bucket.holidayNames, ["Hari Kemerdekaan"])
  assert.equal(bucket.validRecords, 0)
  assert.equal(bucket.counts.alfa, 0)
})

test("tanggal masa depan tidak diklasifikasikan tanpa libur eksplisit", () => {
  const [future, holiday] = buildClassifiedBuckets({
    granularity: "harian", from: "2026-09-01", to: "2026-09-02", today: "2026-08-31",
    expectedByClass: { "ix-a": 30 }, submittedDays: [], rows: [],
    holidays: [{ date: "2026-09-02", name: "Libur Sekolah" }],
  })
  assert.equal(future.state, "future")
  assert.equal(holiday.state, "holiday")
})

test("bucket bulanan menjumlahkan hari aktif dan menyimpan hari tidak pasti/libur", () => {
  const [bucket] = buildClassifiedBuckets({
    granularity: "bulanan", from: "2026-08-01", to: "2026-08-03", today: "2026-08-31",
    expectedByClass: { "ix-a": 10 }, submittedDays: [{ date: "2026-08-01", classId: "ix-a" }],
    rows: [{ date: "2026-08-01", classId: "ix-a", status: "HADIR", total: 9 }],
    holidays: [{ date: "2026-08-02", name: "Libur Sekolah" }],
  })
  assert.equal(bucket.state, "active")
  assert.equal(bucket.activeDays, 1)
  assert.equal(bucket.holidayDays, 1)
  assert.equal(bucket.noDataDays, 1)
  assert.equal(bucket.missingRecords, 1)
})

test("rentang pembanding tepat sebelum rentang kini dengan panjang sama", () => {
  assert.deepEqual(previousRange("2026-08-01", "2026-08-31"), { from: "2026-07-01", to: "2026-07-31" })
  assert.deepEqual(previousRange("2026-08-24", "2026-08-30"), { from: "2026-08-17", to: "2026-08-23" })
})

test("perbandingan jumlah memakai selisih dan perubahan relatif", () => {
  assert.deepEqual(comparisonChange(256, 238, "jumlah"), { direction: "up", difference: 18, relativePercent: 7.563025210084033 })
  assert.equal(comparisonChange(214, 238, "jumlah")?.direction, "down")
  assert.deepEqual(comparisonChange(238, 238, "jumlah"), { direction: "equal", difference: 0, relativePercent: 0 })
  assert.equal(comparisonChange(10, 0, "jumlah")?.relativePercent, null)
})

test("perbandingan persentase memakai poin persentase", () => {
  assert.deepEqual(comparisonChange(2.8, 2, "persentase"), { direction: "up", difference: 0.7999999999999998, relativePercent: null })
  assert.equal(comparisonChange(2, 2.8, "persentase")?.direction, "down")
})

test("skala persentase memakai batas dinamis dan tidak melebihi 100", () => {
  assert.equal(niceTrendMaximum(3.7, "persentase"), 5)
  assert.equal(niceTrendMaximum(8.4, "persentase"), 10)
  assert.equal(niceTrendMaximum(99, "persentase"), 100)
})

test("urutan segmen stack terbaca sama dengan legend dari atas ke bawah", () => {
  // Legend/tooltip membaca Sakit lebih dulu, sehingga Sakit harus digambar
  // paling atas. SVG menumpuk dari dasar, jadi urutan gambar dibalik.
  assert.deepEqual(stackSegmentOrder(["sakit", "izin", "alfa", "dispensasi"]), ["dispensasi", "alfa", "izin", "sakit"])
  // Saat sebagian status dimatikan, urutan relatif tetap konsisten.
  assert.deepEqual(stackSegmentOrder(["sakit", "alfa"]), ["alfa", "sakit"])
  assert.deepEqual(stackSegmentOrder([]), [])
})

test("tooltip diposisikan dekat batang tanpa menutupinya", () => {
  const chart = { width: 800, height: 400 }
  const size = { width: 240, height: 160 }
  // Batang di tengah: prioritas pertama adalah kanan-atas dengan jarak dari batang.
  const middle = tooltipPlacement({ barX: 400, barWidth: 20, barTop: 200, chart, tooltip: size })
  assert.equal(middle.side, "right")
  assert.equal(middle.x, 432)
  assert.ok(middle.y >= 8)

  // Batang paling kanan tidak muat di kanan, harus membalik ke kiri batang.
  const right = tooltipPlacement({ barX: 780, barWidth: 20, barTop: 200, chart, tooltip: size })
  assert.equal(right.side, "left")
  assert.equal(right.x, 528)
  assert.ok(right.x + size.width <= chart.width)

  // Batang paling kiri tetap di kanan dan tidak keluar container.
  const left = tooltipPlacement({ barX: 4, barWidth: 20, barTop: 200, chart, tooltip: size })
  assert.equal(left.side, "right")
  assert.ok(left.x >= 8)
})

test("tooltip tetap di dalam container untuk stack tinggi dan chart sempit", () => {
  const size = { width: 240, height: 160 }
  // Stack sangat tinggi: tooltip digeser ke bawah, tidak terpotong sisi atas.
  const tall = tooltipPlacement({ barX: 300, barWidth: 20, barTop: 4, chart: { width: 800, height: 400 }, tooltip: size })
  assert.ok(tall.y >= 8)
  assert.ok(tall.y + size.height <= 400)

  // Chart lebih sempit dari tooltip tetap menghasilkan koordinat dalam batas.
  const narrow = tooltipPlacement({ barX: 100, barWidth: 20, barTop: 100, chart: { width: 200, height: 300 }, tooltip: size })
  assert.ok(narrow.x >= 0)
  assert.ok(narrow.y >= 0)
  assert.ok(narrow.y + size.height <= 300)
})
