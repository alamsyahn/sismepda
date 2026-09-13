/**
 * Agregasi kesehatan satu kelas (halaman Pantauan Kesehatan Kelas).
 *
 * Yang dijaga di sini adalah hal-hal yang bisa rusak diam-diam tanpa membuat
 * halaman terlihat salah: cakupan kelas, "pengukuran terbaru" yang benar,
 * hitungan sakit/kunjungan yang mengikuti periode, alasan data tidak lengkap
 * yang tidak boleh dilebur jadi satu, dan `returnTo` yang tidak boleh bisa
 * menjadi open redirect.
 *
 * Ambang IMT/U-nya sendiri diuji di tests/bmi-for-age.test.ts; di sini status
 * gizi selalu diperoleh lewat resolver kanonik, bukan angka ajaib.
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { calculateBmi, nutritionStatus } from "../lib/euks"
import { isKnownPermission } from "../lib/rbac-permissions"
import { parseSchoolDate, type SchoolDate } from "../lib/school-date"
import {
  ATTENTION_SICK_STREAK,
  UNKNOWN_SLICE,
  buildStudentRow,
  completenessReasons,
  defaultClassTableFilters,
  filterAndSortRows,
  formatAge,
  genderShortLabel,
  longestSickStreakOf,
  nutritionDistribution,
  sickTrend,
  summarizeClassMonitoring,
  visitTrend,
  type ClassStudentInput,
} from "../lib/euks-class-monitoring"
import {
  classMonitoringLink,
  readClassMonitoringView,
  safeReturnPath,
  safeClassReturnPath,
  studentDetailHref,
  studentRowAnchor,
} from "../lib/euks-class-navigation"

const date = (value: string): SchoolDate => {
  const parsed = parseSchoolDate(value)
  assert.ok(parsed, `tanggal fixture tidak valid: ${value}`)
  return parsed
}

const TODAY = date("2026-03-15")

/**
 * Berat yang jatuh ke kategori tertentu dicari lewat resolver kanonik, bukan
 * ditulis sebagai angka tetap: kalau tabel rujukan berubah, fixture ikut
 * berubah dan test tetap menguji agregasi.
 */
function weightFor(
  category: string,
  input: { birthDate: string; gender: "LAKI_LAKI" | "PEREMPUAN"; measuredAt: string; heightCm: number },
): number {
  for (let weight = 15; weight <= 140; weight += 0.1) {
    const status = nutritionStatus({
      bmi: calculateBmi(input.heightCm, weight),
      measuredAt: input.measuredAt,
      birthDate: input.birthDate,
      gender: input.gender,
    })
    if (status.kind === "known" && status.category === category) return Number(weight.toFixed(1))
  }
  throw new Error(`tidak ada berat yang menghasilkan kategori ${category}`)
}

function student(overrides: Partial<ClassStudentInput> & { id: string; name: string }): ClassStudentInput {
  return {
    birthDate: "2012-05-10",
    gender: "LAKI_LAKI",
    latest: null,
    sickDates: [],
    visitDates: [],
    ...overrides,
  }
}

const measuredStudent = (
  id: string,
  name: string,
  category: string,
  extra: Partial<ClassStudentInput> = {},
): ClassStudentInput => {
  const base = { birthDate: "2012-05-10", gender: "LAKI_LAKI" as const, measuredAt: "2026-03-01", heightCm: 150 }
  return student({
    id,
    name,
    birthDate: base.birthDate,
    gender: base.gender,
    latest: {
      measuredAt: base.measuredAt,
      heightCm: base.heightCm,
      weightKg: weightFor(category, base),
    },
    ...extra,
  })
}

test("status gizi baris tabel memakai resolver IMT/U kanonik", () => {
  const input = measuredStudent("s1", "Ana", "gizi_baik")
  const row = buildStudentRow(input, { holidays: [], today: TODAY })
  assert.equal(row.category, "gizi_baik")
  assert.equal(row.unknownReason, null)
  assert.equal(row.bmi, calculateBmi(150, input.latest!.weightKg))
  assert.equal(row.measuredAt, "2026-03-01")
})

test("umur dihitung pada tanggal pengukuran, bukan hari ini", () => {
  const row = buildStudentRow(measuredStudent("s1", "Ana", "gizi_baik"), {
    holidays: [],
    today: TODAY,
  })
  // Lahir 2012-05-10, diukur 2026-03-01 => belum ulang tahun ke-14.
  assert.equal(row.ageYears, 13)
  assert.equal(formatAge(row.ageYears), "13 th")
})

test("siswa tanpa tanggal lahir tidak dilaporkan berumur nol", () => {
  const row = buildStudentRow(
    student({ id: "s1", name: "Budi", birthDate: null }),
    { holidays: [], today: TODAY },
  )
  assert.equal(row.ageYears, null)
  assert.equal(formatAge(row.ageYears), "–")
})

test("alasan data tidak lengkap dibedakan, bukan dilebur jadi satu", () => {
  const rows = [
    student({ id: "a", name: "A" }),
    student({ id: "b", name: "B", birthDate: null }),
    student({
      id: "c",
      name: "C",
      gender: null,
      latest: { measuredAt: "2026-03-01", heightCm: 150, weightKg: 45 },
    }),
  ].map((input) => buildStudentRow(input, { holidays: [], today: TODAY }))

  assert.equal(rows[0].unknownReason, "no_measurement")
  assert.equal(rows[1].unknownReason, "no_measurement")
  assert.equal(rows[2].unknownReason, "no_gender")

  const reasons = completenessReasons(rows)
  assert.deepEqual(
    reasons.map((item) => [item.reason, item.count]),
    [
      ["no_measurement", 2],
      ["no_gender", 1],
    ],
  )
})

test("rentetan sakit terpanjang memakai logika streak kanonik", () => {
  const dates = [date("2026-03-02"), date("2026-03-03"), date("2026-03-04")]
  assert.equal(longestSickStreakOf(dates, []), 3)
  assert.equal(longestSickStreakOf([], []), 0)
})

test("sakit berturut-turut mencapai ambang masuk daftar perlu perhatian", () => {
  const row = buildStudentRow(
    measuredStudent("s1", "Ana", "gizi_baik", {
      sickDates: [date("2026-03-02"), date("2026-03-03"), date("2026-03-04")],
    }),
    { holidays: [], today: TODAY },
  )
  assert.equal(row.longestSickStreak, ATTENTION_SICK_STREAK)
  const kinds = row.attentionReasons.map((reason) => reason.kind)
  assert.deepEqual(kinds, ["sick_streak"])
})

test("beberapa alasan perhatian ditampilkan seluruhnya", () => {
  const row = buildStudentRow(
    measuredStudent("s1", "Ana", "obesitas", {
      sickDates: [date("2026-03-02"), date("2026-03-03"), date("2026-03-04")],
    }),
    { holidays: [], today: TODAY },
  )
  assert.deepEqual(
    row.attentionReasons.map((reason) => reason.kind),
    ["nutrition", "sick_streak"],
  )
})

test("gizi baik tanpa sinyal lain tidak masuk daftar perhatian", () => {
  const row = buildStudentRow(measuredStudent("s1", "Ana", "gizi_baik"), {
    holidays: [],
    today: TODAY,
  })
  assert.deepEqual(row.attentionReasons, [])
})

test("distribusi memakai seluruh siswa sebagai pembagi dan menjumlah 100%", () => {
  const rows = [
    measuredStudent("a", "A", "gizi_baik"),
    measuredStudent("b", "B", "gizi_baik"),
    measuredStudent("c", "C", "obesitas"),
    student({ id: "d", name: "D" }),
  ].map((input) => buildStudentRow(input, { holidays: [], today: TODAY }))

  const distribution = nutritionDistribution(rows)
  const baik = distribution.find((slice) => slice.key === "gizi_baik")
  const unknown = distribution.find((slice) => slice.key === UNKNOWN_SLICE)
  assert.equal(baik?.count, 2)
  assert.equal(baik?.share, 50)
  assert.equal(unknown?.count, 1)
  assert.equal(unknown?.share, 25)
  const total = distribution.reduce((sum, slice) => sum + slice.share, 0)
  assert.ok(Math.abs(total - 100) < 1e-9)
})

test("kelas kosong tidak menghasilkan pembagian nol", () => {
  const distribution = nutritionDistribution([])
  assert.ok(distribution.every((slice) => slice.count === 0 && slice.share === 0))
})

test("tren sakit menghitung hari dan siswa unik, periode kosong tetap nol", () => {
  const buckets = sickTrend({
    students: [
      student({ id: "a", name: "A", sickDates: [date("2026-03-02"), date("2026-03-03")] }),
      student({ id: "b", name: "B", sickDates: [date("2026-03-02")] }),
    ],
    from: date("2026-03-01"),
    to: date("2026-03-31"),
    granularity: "bulanan",
  })
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].sickDays, 3)
  assert.equal(buckets[0].students, 2)

  const empty = sickTrend({
    students: [],
    from: date("2026-01-01"),
    to: date("2026-03-31"),
    granularity: "bulanan",
  })
  assert.equal(empty.length, 3)
  assert.ok(empty.every((bucket) => bucket.sickDays === 0 && bucket.students === 0))
})

test("tanggal di luar rentang tidak diselipkan ke bucket tepi", () => {
  const buckets = visitTrend({
    students: [student({ id: "a", name: "A", visitDates: [date("2025-12-31"), date("2026-02-10")] })],
    from: date("2026-01-01"),
    to: date("2026-03-31"),
    granularity: "bulanan",
  })
  assert.deepEqual(
    buckets.map((bucket) => bucket.visits),
    [0, 1, 0],
  )
})

test("ringkasan kelas menjumlah sakit dan kunjungan sesuai periode", () => {
  const summary = summarizeClassMonitoring({
    classId: "c1",
    className: "VII A",
    students: [
      measuredStudent("a", "Ana", "gizi_baik", {
        sickDates: [date("2026-03-02"), date("2026-03-05")],
        visitDates: [date("2026-03-02")],
      }),
      measuredStudent("b", "Budi", "gizi_kurang", { visitDates: [date("2026-03-04")] }),
      student({ id: "c", name: "Citra" }),
    ],
    complaints: ["Pusing", "pusing ", "Demam"],
    holidays: [],
    from: date("2026-03-01"),
    to: date("2026-03-31"),
    granularity: "bulanan",
    today: TODAY,
  })

  assert.equal(summary.totalStudents, 3)
  assert.equal(summary.totalSickDays, 2)
  assert.equal(summary.totalVisits, 2)
  assert.equal(summary.assessableStudents, 2)
  assert.ok(Math.abs(summary.completenessShare - (2 / 3) * 100) < 1e-9)
  // Ana gizi baik tanpa streak → aman; Budi gizi kurang; Citra belum diukur.
  assert.equal(summary.attentionCount, 2)
  assert.deepEqual(
    summary.rows.map((row) => row.name),
    ["Ana", "Budi", "Citra"],
  )
  // Normalisasi keluhan hanya menyamakan huruf besar-kecil dan spasi.
  assert.equal(summary.complaints[0].count, 2)
})

test("filter dan urutan tabel menaruh nilai tak diketahui di belakang", () => {
  const rows = [
    measuredStudent("a", "Ana", "gizi_baik", { visitDates: [date("2026-03-01")] }),
    student({ id: "b", name: "Budi" }),
    measuredStudent("c", "Citra", "obesitas"),
  ].map((input) => buildStudentRow(input, { holidays: [], today: TODAY }))

  const byBmi = filterAndSortRows(rows, { ...defaultClassTableFilters, sort: "imt" })
  assert.equal(byBmi[byBmi.length - 1].name, "Budi")

  const byBmiDesc = filterAndSortRows(rows, {
    ...defaultClassTableFilters,
    sort: "imt",
    descending: true,
  })
  assert.equal(byBmiDesc[byBmiDesc.length - 1].name, "Budi")

  const searched = filterAndSortRows(rows, { ...defaultClassTableFilters, search: "cit" })
  assert.deepEqual(searched.map((row) => row.name), ["Citra"])

  const unknownOnly = filterAndSortRows(rows, {
    ...defaultClassTableFilters,
    nutrition: UNKNOWN_SLICE,
  })
  assert.deepEqual(unknownOnly.map((row) => row.name), ["Budi"])

  const attention = filterAndSortRows(rows, { ...defaultClassTableFilters, attentionOnly: true })
  assert.deepEqual(attention.map((row) => row.name), ["Budi", "Citra"])
})

test("jenis kelamin kosong ditandai, bukan ditebak", () => {
  assert.equal(genderShortLabel("LAKI_LAKI"), "L")
  assert.equal(genderShortLabel("PEREMPUAN"), "P")
  assert.equal(genderShortLabel(null), "–")
})

test("tautan drill-down dari halaman utama memakai classId", () => {
  assert.equal(
    classMonitoringLink("cls123"),
    "/e-uks/pantauan-kesehatan-kelas?classId=cls123",
  )
})

test("URL langsung dengan classId memulihkan kelas dan filter", () => {
  const params = new URLSearchParams(
    "classId=cls123&periode=mingguan&q=ana&gizi=obesitas&jk=PEREMPUAN&perhatian=1&urut=sakit&desc=1",
  )
  const view = readClassMonitoringView(params)
  assert.equal(view.classId, "cls123")
  assert.equal(view.granularity, "mingguan")
  assert.equal(view.filters.search, "ana")
  assert.equal(view.filters.nutrition, "obesitas")
  assert.equal(view.filters.gender, "PEREMPUAN")
  assert.equal(view.filters.attentionOnly, true)
  assert.equal(view.filters.sort, "sakit")
  assert.equal(view.filters.descending, true)
})

test("periode dan urutan tak dikenal jatuh ke default, bukan galat", () => {
  const view = readClassMonitoringView(new URLSearchParams("periode=abad&urut=warna"))
  assert.equal(view.granularity, "bulanan")
  assert.equal(view.filters.sort, "nama")
  assert.equal(view.classId, "")
})

test("returnTo hanya menerima path internal", () => {
  assert.equal(safeReturnPath("/e-uks/pantauan-kesehatan-kelas?classId=x"), "/e-uks/pantauan-kesehatan-kelas?classId=x")
  for (const hostile of [
    "https://jahat.example",
    "//jahat.example",
    "javascript:alert(1)",
    "/\\jahat.example",
    "e-uks",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeReturnPath(hostile), null, `harus ditolak: ${String(hostile)}`)
  }
})

test("tombol kembali hanya menerima jalan pulang ke halaman kelas", () => {
  // Internal saja tidak cukup: tombol "Kembali ke VII A" tidak boleh bisa
  // dibelokkan ke halaman internal lain lewat URL yang dibuat-buat.
  assert.equal(
    safeClassReturnPath("/e-uks/pantauan-kesehatan-kelas?classId=x&urut=sakit"),
    "/e-uks/pantauan-kesehatan-kelas?classId=x&urut=sakit",
  )
  assert.equal(safeClassReturnPath("/dashboard"), null)
  assert.equal(safeClassReturnPath("/pengguna?hapus=1"), null)
  assert.equal(safeClassReturnPath("/e-uks/pantauan-kesehatan-kelas-palsu"), null)
  assert.equal(safeClassReturnPath("https://jahat.example"), null)
  assert.equal(safeClassReturnPath(null), null)
})

test("tautan detail siswa membawa jalan pulang internal saja", () => {
  const good = studentDetailHref({
    studentId: "s1",
    classId: "c1",
    returnTo: "/e-uks/pantauan-kesehatan-kelas?classId=c1&urut=sakit",
  })
  assert.ok(good.startsWith("/e-uks/pantauan-kesehatan?"))
  assert.ok(good.includes("studentId=s1"))
  assert.ok(good.includes("classId=c1"))
  assert.ok(good.includes("returnTo="))

  const hostile = studentDetailHref({
    studentId: "s1",
    classId: "c1",
    returnTo: "https://jahat.example",
  })
  assert.ok(!hostile.includes("returnTo"))
})

test("tren sakit mingguan menghasilkan dua belas bucket dengan nilai per kelas", () => {
  // 12 minggu yang berakhir pada 2026-09-13 — sama seperti rentang default
  // periode "mingguan" di halaman kelas.
  const buckets = sickTrend({
    students: [
      student({
        id: "a",
        name: "A",
        sickDates: [date("2026-08-17"), date("2026-08-18"), date("2026-09-01")],
      }),
      student({ id: "b", name: "B", sickDates: [date("2026-08-17")] }),
    ],
    from: date("2026-06-22"),
    to: date("2026-09-13"),
    granularity: "mingguan",
  })

  assert.equal(buckets.length, 12)
  const agustus17 = buckets.find((bucket) => bucket.tooltipLabel.includes("17"))
  assert.equal(agustus17?.sickDays, 3)
  assert.equal(agustus17?.students, 2)
  // Bucket tanpa absensi sakit tetap ada dan bernilai nol supaya sumbu waktu
  // tidak melompat.
  assert.ok(buckets.some((bucket) => bucket.sickDays === 0))
  assert.equal(
    buckets.reduce((sum, bucket) => sum + bucket.sickDays, 0),
    4,
  )
})

test("tren sakit hanya menghitung siswa kelas yang diberikan", () => {
  // Pemanggil hanya mengirim siswa satu kelas; siswa kelas lain tidak boleh
  // ikut karena bukan bagian dari input.
  const buckets = sickTrend({
    students: [student({ id: "kelas-ini", name: "A", sickDates: [date("2026-03-02")] })],
    from: date("2026-03-01"),
    to: date("2026-03-31"),
    granularity: "bulanan",
  })
  assert.equal(buckets[0].sickDays, 1)
  assert.equal(buckets[0].students, 1)
})

test("jangkar baris siswa memakai id stabil, bukan nama", () => {
  assert.equal(studentRowAnchor("s1"), "siswa-s1")
  const href = studentDetailHref({
    studentId: "s1",
    classId: "c1",
    returnTo: `/e-uks/pantauan-kesehatan-kelas?classId=c1#${studentRowAnchor("s1")}`,
  })
  assert.ok(decodeURIComponent(href).includes("#siswa-s1"))
})

test("halaman kelas dan modul agregasinya tidak memuat pemeriksaan peran keras", () => {
  for (const path of [
    "lib/euks-class-monitoring.ts",
    "lib/euks-class-navigation.ts",
    "app/e-uks/pantauan-kesehatan-kelas/page.tsx",
    "components/e-uks/euks-class-monitoring-dashboard.tsx",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    assert.ok(
      !/role\s*===\s*["']ADMIN["']/.test(source),
      `${path} tidak boleh memeriksa Role secara langsung`,
    )
  }
})

test("halaman kelas memakai permission E-UKS yang sudah terdaftar", () => {
  const source = readFileSync(
    new URL("../app/e-uks/pantauan-kesehatan-kelas/page.tsx", import.meta.url),
    "utf8",
  )
  const match = source.match(/requirePagePermission\("([^"]+)"\)/)
  assert.ok(match, "halaman harus memanggil requirePagePermission")
  assert.equal(match[1], "euks.monitoring.read")
  assert.ok(isKnownPermission(match[1]))
})
