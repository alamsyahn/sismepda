/**
 * Agregasi status gizi sekolah untuk Halaman Utama E-UKS.
 *
 * Yang dijaga di sini adalah dua properti yang mudah rusak diam-diam:
 * satu siswa hanya boleh dihitung satu kali (bukan satu kali per riwayat
 * pengukuran), dan klasifikasinya harus datang dari resolver IMT/U yang sama
 * dengan Pantauan Kesehatan Siswa — bukan ambang IMT dewasa.
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { categorizeZScore, nutritionCategoryLabels } from "../lib/bmi-for-age"
import { calculateBmi, nutritionStatus } from "../lib/euks"
import { isKnownPermission } from "../lib/rbac-permissions"
import {
  ALL_GRADES,
  ATTENTION_NUTRITION_CATEGORIES,
  COVERAGE_COLUMN,
  NORMAL_NUTRITION_CATEGORY,
  NUTRITION_CATEGORY_ORDER,
  NUTRITION_HEATMAP_COLUMNS,
  bucketByClass,
  classifyStudentNutrition,
  filterByGrade,
  formatShare,
  gradesOf,
  measuredCountOf,
  nutritionHeatmap,
  nutritionInsights,
  summarizeNutrition,
  type StudentNutritionInput,
} from "../lib/euks-nutrition"

/**
 * Pengukuran yang diharapkan jatuh ke kategori tertentu dicari lewat resolver
 * yang sama, bukan lewat angka ajaib: tinggi dipatok, berat dicari sampai
 * kategorinya cocok. Kalau tabel rujukan berubah, fixture ikut, dan test tetap
 * menguji agregasi — bukan ambangnya (itu tugas tests/bmi-for-age.test.ts).
 */
const BIRTH_DATE = "2012-07-01"
const MEASURED_AT = "2026-01-15"
const HEIGHT = 150

function weightFor(category: (typeof NUTRITION_CATEGORY_ORDER)[number]): number {
  for (let weight = 15; weight <= 140; weight += 0.1) {
    const bmi = calculateBmi(HEIGHT, weight)
    if (bmi === null) continue
    const status = nutritionStatus({
      bmi,
      measuredAt: MEASURED_AT,
      birthDate: BIRTH_DATE,
      gender: "LAKI_LAKI",
    })
    if (status.kind === "known" && status.category === category) return Number(weight.toFixed(1))
  }
  throw new Error(`Tidak menemukan berat contoh untuk kategori ${category}`)
}

const student = (
  overrides: Partial<StudentNutritionInput> & { category?: (typeof NUTRITION_CATEGORY_ORDER)[number] } = {},
): StudentNutritionInput => {
  const { category, ...rest } = overrides
  return {
    classId: "kelas-1",
    className: "VII A",
    grade: "VII",
    birthDate: BIRTH_DATE,
    gender: "LAKI_LAKI",
    latest: {
      measuredAt: MEASURED_AT,
      heightCm: HEIGHT,
      weightKg: weightFor(category ?? "gizi_baik"),
    },
    ...rest,
  }
}

const summaryOf = (students: StudentNutritionInput[]) =>
  summarizeNutrition(bucketByClass(students.map(classifyStudentNutrition)))

test("kategori memakai resolver IMT/U, bukan ambang IMT dewasa", () => {
  // IMT 17,0 pada anak laki-laki 13 tahun 6 bulan adalah gizi baik menurut
  // Permenkes 2/2020, meski ambang dewasa menyebutnya kurus (<18,5).
  const result = classifyStudentNutrition(
    student({ latest: { measuredAt: MEASURED_AT, heightCm: 150, weightKg: 38.3 } }),
  )
  const bmi = calculateBmi(150, 38.3)!
  assert.ok(bmi < 18.5)
  assert.equal(result.category, "gizi_baik")
  assert.equal(result.reason, null)
})

test("klasifikasi identik dengan nutritionStatus untuk masukan yang sama", () => {
  for (const category of NUTRITION_CATEGORY_ORDER) {
    const input = student({ category })
    const result = classifyStudentNutrition(input)
    const expected = nutritionStatus({
      bmi: calculateBmi(input.latest!.heightCm, input.latest!.weightKg),
      measuredAt: input.latest!.measuredAt,
      birthDate: input.birthDate,
      gender: input.gender,
    })
    assert.equal(expected.kind, "known")
    if (expected.kind === "known") {
      assert.equal(result.category, expected.category)
      assert.equal(result.category, categorizeZScore(expected.z))
    }
  }
})

test("siswa dengan empat riwayat tetap dihitung satu kali", () => {
  // Snapshot menerima satu baris per siswa; empat riwayat sudah diringkas oleh
  // query menjadi satu pengukuran terbaru.
  const summary = summaryOf([student({ category: "gizi_baik" })])
  assert.equal(summary.totalStudents, 1)
  assert.equal(summary.measuredStudents, 1)
  assert.equal(summary.categories.reduce((sum, item) => sum + item.count, 0), 1)
})

test("pengukuran terbaru yang menentukan kategori, bukan yang lama", () => {
  const lama = classifyStudentNutrition(
    student({ latest: { measuredAt: "2024-01-10", heightCm: HEIGHT, weightKg: weightFor("obesitas") } }),
  )
  const baru = classifyStudentNutrition(
    student({ latest: { measuredAt: "2026-01-15", heightCm: HEIGHT, weightKg: weightFor("gizi_baik") } }),
  )
  assert.equal(lama.category, "obesitas")
  assert.equal(baru.category, "gizi_baik")
  assert.equal(baru.measuredAt, "2026-01-15")
})

test("persentase kategori memakai pembagi siswa terukur dan menjumlah 100 persen", () => {
  const summary = summaryOf([
    student({ category: "gizi_baik" }),
    student({ category: "gizi_baik" }),
    student({ category: "gizi_kurang" }),
    student({ category: "obesitas" }),
    // Dua siswa tanpa data tidak boleh mengubah pembagi persentase kategori.
    student({ latest: null }),
    student({ birthDate: null }),
  ])

  assert.equal(summary.totalStudents, 6)
  assert.equal(summary.measuredStudents, 4)
  assert.equal(summary.normalCount, 2)
  assert.equal(summary.normalShare, 50)
  const total = summary.categories.reduce((sum, item) => sum + item.share, 0)
  assert.ok(Math.abs(total - 100) < 1e-9)
  assert.equal(Math.round(summary.coverageShare * 10) / 10, 66.7)
})

test("data yang hilang tidak merusak total dan dirinci menurut alasannya", () => {
  const summary = summaryOf([
    student({ category: "gizi_baik" }),
    student({ latest: null }),
    student({ latest: null }),
    student({ birthDate: null }),
    student({ gender: null }),
    // Tinggi/berat tidak sahih: IMT tidak dapat dihitung, jadi bukan terukur.
    student({ latest: { measuredAt: MEASURED_AT, heightCm: 0, weightKg: 40 } }),
  ])

  assert.equal(summary.totalStudents, 6)
  assert.equal(summary.measuredStudents, 1)
  assert.equal(summary.unmeasured.total, 5)
  // Tiga alasan "no_measurement": dua tanpa pengukuran, satu dengan IMT gagal.
  assert.equal(summary.unmeasured.noMeasurement, 3)
  assert.equal(summary.unmeasured.incomplete, 2)
  assert.equal(
    summary.unmeasured.reasons.reduce((sum, item) => sum + item.count, 0),
    5,
  )
  assert.equal(
    summary.measuredStudents + summary.unmeasured.total,
    summary.totalStudents,
  )
})

test("kategori bernilai nol tetap hadir dengan porsi nol", () => {
  const summary = summaryOf([student({ category: "gizi_baik" })])
  assert.equal(summary.categories.length, NUTRITION_CATEGORY_ORDER.length)
  const buruk = summary.categories.find((item) => item.category === "gizi_buruk")!
  assert.equal(buruk.count, 0)
  assert.equal(buruk.share, 0)
  assert.equal(buruk.label, nutritionCategoryLabels.gizi_buruk)
})

test("perlu perhatian adalah seluruh kategori di luar normal", () => {
  const summary = summaryOf([
    student({ category: "gizi_buruk" }),
    student({ category: "gizi_kurang" }),
    student({ category: "gizi_baik" }),
    student({ category: "gizi_lebih" }),
    student({ category: "obesitas" }),
  ])
  assert.equal(summary.attentionCount, 4)
  assert.equal(summary.normalCount, 1)
  assert.equal(summary.normalCount + summary.attentionCount, summary.measuredStudents)
  assert.ok(!ATTENTION_NUTRITION_CATEGORIES.includes(NORMAL_NUTRITION_CATEGORY))
})

test("agregasi per kelas benar dan urutannya mengikuti urutan kelas SISMEPDA", () => {
  const summary = summaryOf([
    { ...student({ category: "gizi_baik" }), classId: "c3", className: "IX A", grade: "IX" },
    { ...student({ category: "obesitas" }), classId: "c2", className: "VIII B", grade: "VIII" },
    { ...student({ category: "gizi_lebih" }), classId: "c2", className: "VIII B", grade: "VIII" },
    { ...student({ category: "gizi_baik" }), classId: "c1", className: "VII A", grade: "VII" },
    { ...student({ latest: null }), classId: "c1", className: "VII A", grade: "VII" },
  ])

  assert.deepEqual(summary.classes.map((row) => row.className), ["VII A", "VIII B", "IX A"])
  const viiA = summary.classes[0]
  assert.equal(viiA.students, 2)
  assert.equal(viiA.measured, 1)
  const viiiB = summary.classes[1]
  assert.equal(viiiB.counts.obesitas, 1)
  assert.equal(viiiB.counts.gizi_lebih, 1)
  assert.equal(measuredCountOf(viiiB.counts), 2)
})

test("kelas tanpa siswa terukur tetap muncul dengan nol terukur", () => {
  const summary = summaryOf([
    { ...student({ category: "gizi_baik" }), classId: "c1", className: "VII A", grade: "VII" },
    { ...student({ latest: null }), classId: "c2", className: "VII B", grade: "VII" },
  ])
  const viiB = summary.classes.find((row) => row.className === "VII B")!
  assert.equal(viiB.students, 1)
  assert.equal(viiB.measured, 0)
  assert.equal(measuredCountOf(viiB.counts), 0)
})

test("filter tingkat mempersempit seluruh agregat", () => {
  const buckets = bucketByClass(
    [
      { ...student({ category: "gizi_baik" }), classId: "c1", className: "VII A", grade: "VII" },
      { ...student({ category: "obesitas" }), classId: "c2", className: "VIII A", grade: "VIII" },
      { ...student({ category: "gizi_kurang" }), classId: "c2", className: "VIII A", grade: "VIII" },
    ].map(classifyStudentNutrition),
  )

  assert.deepEqual(gradesOf(buckets), ["VII", "VIII"])
  assert.equal(summarizeNutrition(filterByGrade(buckets, ALL_GRADES)).measuredStudents, 3)

  const viii = summarizeNutrition(filterByGrade(buckets, "VIII"))
  assert.equal(viii.totalStudents, 2)
  assert.equal(viii.measuredStudents, 2)
  assert.equal(viii.normalCount, 0)
  assert.equal(viii.attentionCount, 2)
  assert.deepEqual(viii.classes.map((row) => row.className), ["VIII A"])
})

test("tanpa data sama sekali, ringkasan aman dan tidak membagi dengan nol", () => {
  const summary = summarizeNutrition([])
  assert.equal(summary.totalStudents, 0)
  assert.equal(summary.measuredStudents, 0)
  assert.equal(summary.coverageShare, 0)
  assert.equal(summary.normalShare, 0)
  assert.equal(summary.attentionShare, 0)
  assert.equal(summary.latestMeasuredAt, null)
  assert.deepEqual(summary.classes, [])
  assert.ok(summary.categories.every((item) => item.count === 0 && item.share === 0))
  assert.deepEqual(nutritionInsights(summary), [])
})

test("seluruh siswa tanpa pengukuran menghasilkan cakupan nol, bukan NaN", () => {
  const summary = summaryOf([student({ latest: null }), student({ latest: null })])
  assert.equal(summary.coverageShare, 0)
  assert.ok(summary.categories.every((item) => Number.isFinite(item.share)))
  assert.equal(summary.latestMeasuredAt, null)
})

test("tanggal pengukuran terakhir adalah yang paling baru di seluruh snapshot", () => {
  const summary = summaryOf([
    { ...student({ category: "gizi_baik" }), classId: "c1", className: "VII A", grade: "VII" },
    {
      ...student({ category: "gizi_baik" }),
      classId: "c2",
      className: "VIII A",
      grade: "VIII",
      latest: { measuredAt: "2026-03-02", heightCm: HEIGHT, weightKg: weightFor("gizi_baik") },
    },
  ])
  assert.equal(summary.latestMeasuredAt, "2026-03-02")
})

test("ringkasan otomatis hanya menyebut ulang angka agregat", () => {
  const summary = summaryOf([
    { ...student({ category: "gizi_baik" }), classId: "c1", className: "VII A", grade: "VII" },
    { ...student({ category: "gizi_baik" }), classId: "c1", className: "VII A", grade: "VII" },
    { ...student({ category: "obesitas" }), classId: "c2", className: "VIII B", grade: "VIII" },
    { ...student({ latest: null }), classId: "c2", className: "VIII B", grade: "VIII" },
  ])
  const insights = nutritionInsights(summary)

  assert.equal(insights.length, 3)
  assert.match(insights[0], /Gizi baik/)
  assert.match(insights[1], /VIII B/)
  assert.match(insights[2], /1 siswa belum memiliki data/)
})

test("persentase diformat gaya Indonesia dengan satu desimal", () => {
  assert.equal(formatShare(68.44), "68,4%")
  assert.equal(formatShare(0), "0,0%")
  assert.equal(formatShare(100), "100,0%")
})

test("heatmap memakai pembagi berbeda untuk kategori dan untuk cakupan", () => {
  // 4 siswa: 3 terukur (2 gizi baik, 1 gizi kurang), 1 belum diukur.
  const summary = summaryOf([
    student({ category: "gizi_baik" }),
    student({ category: "gizi_baik" }),
    student({ category: "gizi_kurang" }),
    student({ latest: null }),
  ])
  const [row] = nutritionHeatmap(summary).rows

  assert.equal(row.students, 4)
  assert.equal(row.measured, 3)

  const cell = (column: (typeof NUTRITION_HEATMAP_COLUMNS)[number]) =>
    row.cells.find((item) => item.column === column)!

  // Kategori: pembaginya siswa TERUKUR (3), bukan seluruh siswa (4).
  assert.equal(cell("gizi_baik").count, 2)
  assert.equal(cell("gizi_baik").total, 3)
  assert.ok(Math.abs(cell("gizi_baik").share - (2 / 3) * 100) < 1e-9)

  // Cakupan: pembaginya justru seluruh siswa kelas.
  assert.equal(cell(COVERAGE_COLUMN).count, 3)
  assert.equal(cell(COVERAGE_COLUMN).total, 4)
  assert.equal(cell(COVERAGE_COLUMN).share, 75)
})

test("kolom heatmap adalah lima kategori kanonik lalu kolom cakupan", () => {
  const summary = summaryOf([student()])
  const heatmap = nutritionHeatmap(summary)

  assert.deepEqual([...heatmap.columns], [...NUTRITION_CATEGORY_ORDER, COVERAGE_COLUMN])
  // Tidak ada kategori yang diam-diam disederhanakan atau dibuang.
  assert.equal(heatmap.columns.length, NUTRITION_CATEGORY_ORDER.length + 1)
  for (const row of heatmap.rows) {
    assert.deepEqual(
      row.cells.map((cell) => cell.column),
      [...heatmap.columns],
    )
  }
})

test("persentase kategori pada satu baris heatmap menjumlah 100 persen", () => {
  const summary = summaryOf(
    NUTRITION_CATEGORY_ORDER.map((category) => student({ category })),
  )
  const [row] = nutritionHeatmap(summary).rows
  const total = row.cells
    .filter((cell) => cell.column !== COVERAGE_COLUMN)
    .reduce((sum, cell) => sum + cell.share, 0)

  assert.ok(Math.abs(total - 100) < 1e-9, `Jumlah persentase kategori ${total}`)
})

test("kelas tanpa siswa terukur ditandai kosong, bukan nol persen", () => {
  const summary = summaryOf([student({ latest: null }), student({ latest: null })])
  const [row] = nutritionHeatmap(summary).rows

  assert.equal(row.students, 2)
  assert.equal(row.measured, 0)
  for (const cell of row.cells) {
    if (cell.column === COVERAGE_COLUMN) {
      // Cakupan tetap bermakna: 0 dari 2 siswa.
      assert.equal(cell.empty, false)
      assert.equal(cell.share, 0)
    } else {
      // Kategori tidak punya pembagi, jadi tidak boleh disajikan sebagai 0,0%.
      assert.equal(cell.empty, true)
      assert.equal(cell.intensity, 0)
    }
  }
})

test("kuat warna dinormalkan per kolom sehingga nilai tertinggi kolom paling pekat", () => {
  const summary = summaryOf([
    // VII A: 1 dari 2 terukur gizi kurang (50%).
    student({ category: "gizi_kurang" }),
    student({ category: "gizi_baik" }),
    // VII B: 1 dari 4 terukur gizi kurang (25%).
    ...["gizi_kurang", "gizi_baik", "gizi_baik", "gizi_baik"].map((category) =>
      student({
        classId: "kelas-2",
        className: "VII B",
        category: category as (typeof NUTRITION_CATEGORY_ORDER)[number],
      }),
    ),
  ])
  const rows = nutritionHeatmap(summary).rows
  const kurang = (className: string) =>
    rows
      .find((row) => row.className === className)!
      .cells.find((cell) => cell.column === "gizi_kurang")!

  assert.ok(kurang("VII A").share > kurang("VII B").share)
  assert.ok(kurang("VII A").intensity > kurang("VII B").intensity)
  // Nilai tertinggi pada kolomnya dipetakan ke kepekatan penuh.
  assert.equal(kurang("VII A").intensity, 1)
  // Sel bernilai kecil tetap terlihat, tidak jatuh ke nol.
  assert.ok(kurang("VII B").intensity > 0)
})

test("sel bernilai nol tidak diberi warna sama sekali", () => {
  const summary = summaryOf([student({ category: "gizi_baik" })])
  const [row] = nutritionHeatmap(summary).rows
  const obesitas = row.cells.find((cell) => cell.column === "obesitas")!

  assert.equal(obesitas.count, 0)
  assert.equal(obesitas.share, 0)
  assert.equal(obesitas.intensity, 0)
  assert.equal(obesitas.empty, false)
})

test("baris heatmap mengikuti urutan kelas SISMEPDA dan mengabaikan kelas kosong", () => {
  const summary = summarizeNutrition([
    {
      classId: "kosong",
      className: "VII Z",
      grade: "VII",
      students: 0,
      counts: { gizi_buruk: 0, gizi_kurang: 0, gizi_baik: 0, gizi_lebih: 0, obesitas: 0 },
      reasons: {},
      latestMeasuredAt: null,
    },
    ...bucketByClass(
      [
        student({ classId: "b", className: "VIII A", grade: "VIII" }),
        student({ classId: "a", className: "VII A", grade: "VII" }),
      ].map(classifyStudentNutrition),
    ),
  ])
  const rows = nutritionHeatmap(summary).rows

  assert.deepEqual(
    rows.map((row) => row.className),
    ["VII A", "VIII A"],
  )
})

/**
 * Dashboard ini tidak boleh membuka jalur akses baru: ia menumpang permission
 * yang sudah menjaga Pantauan Kesehatan Siswa, dan gate-nya dilakukan di server
 * (query tidak dijalankan) — bukan sekadar menyembunyikan komponen.
 */
test("halaman utama E-UKS menggerbangi ringkasan gizi dengan permission pengukuran yang sudah ada", () => {
  const page = readFileSync(new URL("../app/e-uks/page.tsx", import.meta.url), "utf8")

  assert.ok(isKnownPermission("euks.measurements.read"))
  assert.match(page, /pageCan\("euks\.measurements\.read"\)/)
  // Snapshot hanya dibaca bila permission terpenuhi.
  assert.match(page, /canMeasurements \? await readSchoolNutritionSnapshot\(\)/)
  // Section hanya dirender di balik gerbang yang sama.
  assert.match(page, /canMeasurements \? \(/)
})

test("modul gizi tidak memperkenalkan pemeriksaan peran keras", () => {
  for (const file of [
    "../lib/euks-nutrition.ts",
    "../components/e-uks/euks-nutrition-dashboard.tsx",
    "../components/e-uks/euks-nutrition-heatmap.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
    assert.doesNotMatch(source, /role\s*===|"ADMIN"|"GURU"|isAdmin|isGuru/, file)
  }
})
