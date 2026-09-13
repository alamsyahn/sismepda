/**
 * Agregasi status gizi tingkat sekolah untuk Halaman Utama E-UKS.
 *
 * Modul ini murni — tanpa Prisma — sehingga dipakai bersama oleh server
 * (membentuk snapshot) dan komponen klien (memfilter tingkat tanpa memuat ulang
 * halaman), dan tetap dapat diuji sebagai unit.
 *
 * **Satu siswa dihitung satu kali.** Dasar agregasi adalah *pengukuran valid
 * terbaru per siswa*, bukan seluruh baris riwayat. Siswa yang diukur empat kali
 * tidak boleh berbobot empat kali lipat terhadap siswa yang diukur sekali.
 *
 * **Klasifikasi tidak dihitung ulang di sini.** Kategori berasal dari
 * `nutritionStatus()` (IMT-menurut-umur, WHO 5-19 tahun + ambang Permenkes
 * 2/2020) di `lib/euks.ts`. Tidak ada ambang kedua di berkas ini, sehingga
 * kartu ringkasan sekolah dan kartu status gizi per siswa mustahil berbeda.
 *
 * **Yang menyeberang ke browser adalah keranjang per kelas, bukan baris per
 * siswa.** Halaman utama hanya menampilkan angka agregat; mengirim ~840 baris
 * siswa ke browser akan membocorkan data kesehatan per siswa tanpa alasan dan
 * memberatkan payload. Filter tingkat tetap bisa bekerja di klien karena satu
 * kelas selalu utuh milik satu tingkat.
 */

import {
  nutritionCategoryLabels,
  nutritionCategoryTone,
  type NutritionCategory,
} from "@/lib/bmi-for-age"
import { compareClassNames } from "@/lib/class-order"
import {
  calculateBmi,
  nutritionStatus,
  type NutritionUnknownReason,
} from "@/lib/euks"

/** Urutan tetap kategori: dari paling kurang ke paling lebih. */
export const NUTRITION_CATEGORY_ORDER: readonly NutritionCategory[] = [
  "gizi_buruk",
  "gizi_kurang",
  "gizi_baik",
  "gizi_lebih",
  "obesitas",
]

/** Kategori yang dianggap normal oleh Permenkes 2/2020: -2 SD s.d. +1 SD. */
export const NORMAL_NUTRITION_CATEGORY: NutritionCategory = "gizi_baik"

/**
 * Kategori "perlu perhatian" diturunkan dari `nutritionCategoryTone`, bukan
 * didaftar ulang. Kalau suatu saat kategori bertambah, satu-satunya tempat yang
 * perlu diubah tetap peta nada itu.
 */
export const ATTENTION_NUTRITION_CATEGORIES: readonly NutritionCategory[] =
  NUTRITION_CATEGORY_ORDER.filter((category) => nutritionCategoryTone[category] !== "ok")

/**
 * Warna kategori, dipakai sama persis oleh donat, batang per kelas dan legenda.
 *
 * Token `--gizi-*` (app/globals.css) dipakai, bukan `--chart-*`: skala
 * `--chart-*` sengaja menjadi abu-abu di mode gelap, yang akan membuat seluruh
 * kategori gizi tampak identik.
 */
export const nutritionCategoryColor: Record<NutritionCategory, string> = {
  gizi_buruk: "var(--gizi-buruk)",
  gizi_kurang: "var(--gizi-kurang)",
  gizi_baik: "var(--gizi-baik)",
  gizi_lebih: "var(--gizi-lebih)",
  obesitas: "var(--gizi-obesitas)",
}

export const unknownReasonSummaryLabels: Record<NutritionUnknownReason, string> = {
  no_measurement: "Belum pernah diukur",
  no_birth_date: "Tanggal lahir belum diisi",
  no_gender: "Jenis kelamin belum diisi",
  age_out_of_range: "Umur di luar rentang rujukan (5-19 tahun)",
}

/** Satu pengukuran terbaru milik satu siswa, sudah berupa angka biasa. */
export type LatestMeasurementInput = {
  measuredAt: string
  heightCm: number
  weightKg: number
}

/** Satu siswa aktif beserta pengukuran valid terbarunya (bila ada). */
export type StudentNutritionInput = {
  classId: string
  className: string
  grade: string
  birthDate: string | null
  gender: "LAKI_LAKI" | "PEREMPUAN" | null
  latest: LatestMeasurementInput | null
}

/** Satu siswa yang sudah terklasifikasi, sebelum dikelompokkan per kelas. */
export type StudentNutritionResult = {
  classId: string
  className: string
  grade: string
  /** Kategori Permenkes, atau null bila belum dapat dinilai. */
  category: NutritionCategory | null
  /** Alasan spesifik ketika `category` null. */
  reason: NutritionUnknownReason | null
  /** Tanggal pengukuran terbaru yang dipakai, null bila belum pernah diukur. */
  measuredAt: string | null
}

/**
 * Klasifikasi satu siswa dari pengukuran terbarunya.
 *
 * IMT diturunkan lewat `calculateBmi()` dan kategori lewat `nutritionStatus()`;
 * berkas ini tidak memiliki ambang sendiri. Tinggi/berat yang tidak masuk akal
 * membuat IMT null, sehingga siswa jatuh ke "data tidak lengkap" alih-alih
 * merusak agregat.
 */
export function classifyStudentNutrition(student: StudentNutritionInput): StudentNutritionResult {
  const base = {
    classId: student.classId,
    className: student.className,
    grade: student.grade,
    measuredAt: student.latest?.measuredAt ?? null,
  }

  const bmi = student.latest
    ? calculateBmi(student.latest.heightCm, student.latest.weightKg)
    : null
  const status = nutritionStatus({
    bmi,
    measuredAt: student.latest?.measuredAt ?? null,
    birthDate: student.birthDate,
    gender: student.gender,
  })

  return status.kind === "known"
    ? { ...base, category: status.category, reason: null }
    : { ...base, category: null, reason: status.reason }
}

/**
 * Keranjang satu kelas — satuan yang dikirim ke browser dan menjadi masukan
 * setiap ringkasan berikutnya.
 */
export type ClassNutritionBucket = {
  classId: string
  className: string
  grade: string
  /** Seluruh siswa aktif kelas ini, termasuk yang belum terukur. */
  students: number
  /** Selalu lengkap lima kategori, termasuk yang bernilai 0. */
  counts: Record<NutritionCategory, number>
  /** Jumlah siswa per alasan tak-terklasifikasi. */
  reasons: Partial<Record<NutritionUnknownReason, number>>
  /** Pengukuran terbaru yang terpakai di kelas ini. */
  latestMeasuredAt: string | null
}

function emptyCounts(): Record<NutritionCategory, number> {
  return { gizi_buruk: 0, gizi_kurang: 0, gizi_baik: 0, gizi_lebih: 0, obesitas: 0 }
}

/**
 * Kelompokkan hasil per siswa menjadi keranjang per kelas.
 *
 * Kelas diurutkan dengan `compareClassNames()` — aturan urutan kelas yang sudah
 * berlaku di SISMEPDA (VII → VIII → IX, lalu rombel), bukan alfabetis mentah
 * yang akan menaruh "VIII A" sebelum "VII A".
 */
export function bucketByClass(results: StudentNutritionResult[]): ClassNutritionBucket[] {
  const buckets = new Map<string, ClassNutritionBucket>()

  for (const result of results) {
    const bucket = buckets.get(result.classId) ?? {
      classId: result.classId,
      className: result.className,
      grade: result.grade,
      students: 0,
      counts: emptyCounts(),
      reasons: {},
      latestMeasuredAt: null,
    }
    bucket.students += 1
    if (result.category) bucket.counts[result.category] += 1
    else if (result.reason) bucket.reasons[result.reason] = (bucket.reasons[result.reason] ?? 0) + 1
    // Perbandingan leksikografis sah untuk tanggal ISO YYYY-MM-DD.
    if (result.measuredAt && (bucket.latestMeasuredAt === null || result.measuredAt > bucket.latestMeasuredAt)) {
      bucket.latestMeasuredAt = result.measuredAt
    }
    buckets.set(result.classId, bucket)
  }

  return [...buckets.values()].sort((a, b) => compareClassNames(a.className, b.className))
}

/** Nilai tingkat khusus "semua tingkat" pada filter. */
export const ALL_GRADES = "__semua__"

export function filterByGrade(
  buckets: ClassNutritionBucket[],
  grade: string,
): ClassNutritionBucket[] {
  if (!grade || grade === ALL_GRADES) return buckets
  return buckets.filter((bucket) => bucket.grade === grade)
}

/** Tingkat yang benar-benar ada pada data, diurutkan seperti urutan kelas. */
export function gradesOf(buckets: ClassNutritionBucket[]): string[] {
  const grades = [...new Set(buckets.map((bucket) => bucket.grade).filter((grade) => grade !== ""))]
  return grades.sort((a, b) => compareClassNames(a, b))
}

export type NutritionCategoryCount = {
  category: NutritionCategory
  label: string
  count: number
  /** Porsi terhadap siswa terukur, 0-100. */
  share: number
}

export type NutritionUnknownCount = {
  reason: NutritionUnknownReason
  label: string
  count: number
}

export type ClassNutritionRow = {
  classId: string
  className: string
  students: number
  /** Siswa kelas ini yang punya kategori. */
  measured: number
  counts: Record<NutritionCategory, number>
}

export type NutritionSummary = {
  /** Seluruh siswa aktif dalam lingkup filter. */
  totalStudents: number
  /** Siswa dengan kategori status gizi — dasar seluruh persentase kategori. */
  measuredStudents: number
  /** Porsi siswa terukur terhadap seluruh siswa, 0-100. */
  coverageShare: number
  /** Selalu lengkap lima kategori, termasuk yang bernilai 0. */
  categories: NutritionCategoryCount[]
  normalCount: number
  normalShare: number
  attentionCount: number
  attentionShare: number
  attentionCategories: readonly NutritionCategory[]
  unmeasured: {
    total: number
    /** Belum pernah diukur sama sekali. */
    noMeasurement: number
    /** Sudah diukur, tetapi data pendukung klasifikasi belum lengkap. */
    incomplete: number
    reasons: NutritionUnknownCount[]
  }
  /** Tanggal pengukuran terakhir yang dipakai snapshot ini. */
  latestMeasuredAt: string | null
  classes: ClassNutritionRow[]
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

/** Jumlah siswa "perlu perhatian" pada satu keranjang kategori. */
export function attentionCountOf(counts: Record<NutritionCategory, number>): number {
  return ATTENTION_NUTRITION_CATEGORIES.reduce((sum, category) => sum + counts[category], 0)
}

/** Jumlah siswa terukur pada satu keranjang kategori. */
export function measuredCountOf(counts: Record<NutritionCategory, number>): number {
  return NUTRITION_CATEGORY_ORDER.reduce((sum, category) => sum + counts[category], 0)
}

/**
 * Ringkasan sekolah dari keranjang kelas.
 *
 * Persentase kategori memakai pembagi "siswa terukur", bukan seluruh siswa,
 * supaya lima kategori selalu menjumlah 100% dan cakupan data dilaporkan
 * terpisah — angka 68% tidak boleh terbaca sebagai 68% dari seluruh sekolah
 * kalau baru sebagian siswa yang diukur.
 */
export function summarizeNutrition(buckets: ClassNutritionBucket[]): NutritionSummary {
  const counts = emptyCounts()
  const reasonCounts = new Map<NutritionUnknownReason, number>()
  const classes: ClassNutritionRow[] = []
  let totalStudents = 0
  let measured = 0
  let latestMeasuredAt: string | null = null

  for (const bucket of buckets) {
    totalStudents += bucket.students
    const bucketMeasured = measuredCountOf(bucket.counts)
    measured += bucketMeasured
    for (const category of NUTRITION_CATEGORY_ORDER) counts[category] += bucket.counts[category]
    for (const [reason, count] of Object.entries(bucket.reasons)) {
      const key = reason as NutritionUnknownReason
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + (count ?? 0))
    }
    if (
      bucket.latestMeasuredAt &&
      (latestMeasuredAt === null || bucket.latestMeasuredAt > latestMeasuredAt)
    ) {
      latestMeasuredAt = bucket.latestMeasuredAt
    }
    classes.push({
      classId: bucket.classId,
      className: bucket.className,
      students: bucket.students,
      measured: bucketMeasured,
      counts: { ...bucket.counts },
    })
  }

  const categories = NUTRITION_CATEGORY_ORDER.map((category) => ({
    category,
    label: nutritionCategoryLabels[category],
    count: counts[category],
    share: share(counts[category], measured),
  }))

  const normalCount = counts[NORMAL_NUTRITION_CATEGORY]
  const attentionCount = attentionCountOf(counts)
  const noMeasurement = reasonCounts.get("no_measurement") ?? 0
  const unmeasuredTotal = totalStudents - measured

  return {
    totalStudents,
    measuredStudents: measured,
    coverageShare: share(measured, totalStudents),
    categories,
    normalCount,
    normalShare: share(normalCount, measured),
    attentionCount,
    attentionShare: share(attentionCount, measured),
    attentionCategories: ATTENTION_NUTRITION_CATEGORIES,
    unmeasured: {
      total: unmeasuredTotal,
      noMeasurement,
      incomplete: unmeasuredTotal - noMeasurement,
      reasons: [...reasonCounts.entries()]
        .map(([reason, count]) => ({
          reason,
          label: unknownReasonSummaryLabels[reason],
          count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "id")),
    },
    latestMeasuredAt,
    classes,
  }
}

/**
 * Kalimat ringkasan deskriptif, seluruhnya diturunkan dari agregat yang sama.
 *
 * Sengaja deterministik dan tanpa interpretasi medis: hanya menyebut ulang
 * angka yang sudah tampil pada kartu dan grafik. Tidak ada penilaian, anjuran,
 * maupun diagnosis — itu kewenangan tenaga kesehatan.
 */
export function nutritionInsights(summary: NutritionSummary): string[] {
  const insights: string[] = []

  if (summary.measuredStudents > 0) {
    const dominant = [...summary.categories]
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "id"))[0]
    if (dominant) {
      insights.push(
        `Mayoritas siswa yang telah diukur berada pada kategori ${dominant.label} (${formatShare(dominant.share)}).`,
      )
    }

    // Kelas dengan porsi "perlu perhatian" tertinggi. Kelas tanpa siswa terukur
    // dilewati: porsi dari nol siswa bukan informasi.
    const ranked = summary.classes
      .filter((row) => row.measured > 0)
      .map((row) => ({
        className: row.className,
        measured: row.measured,
        attention: attentionCountOf(row.counts),
      }))
      .filter((row) => row.attention > 0)
      .map((row) => ({ ...row, share: share(row.attention, row.measured) }))
      .sort((a, b) => b.share - a.share || compareClassNames(a.className, b.className))
    if (ranked.length > 0) {
      const top = ranked[0]
      insights.push(
        `Kelas ${top.className} memiliki porsi status gizi di luar kategori normal tertinggi (${formatShare(top.share)} dari ${top.measured} siswa terukur).`,
      )
    }
  }

  if (summary.unmeasured.total > 0) {
    insights.push(
      `${summary.unmeasured.total} siswa belum memiliki data pengukuran yang dapat dianalisis.`,
    )
  }

  return insights
}

/** Persentase gaya Indonesia, satu desimal: 68,4%. */
export function formatShare(value: number): string {
  return `${value.toFixed(1).replace(".", ",")}%`
}

/** Kolom netral heatmap: cakupan pengukuran kelas. */
export const COVERAGE_COLUMN = "terukur"

/** Kolom heatmap, berurutan: lima kategori kanonik lalu kolom cakupan. */
export type NutritionHeatmapColumn = NutritionCategory | typeof COVERAGE_COLUMN

export const NUTRITION_HEATMAP_COLUMNS: readonly NutritionHeatmapColumn[] = [
  ...NUTRITION_CATEGORY_ORDER,
  COVERAGE_COLUMN,
]

export const nutritionHeatmapColumnLabels: Record<NutritionHeatmapColumn, string> = {
  ...nutritionCategoryLabels,
  [COVERAGE_COLUMN]: "Terukur",
}

/**
 * Warna kolom heatmap. Kolom cakupan sengaja memakai warna netral tema
 * (`--muted-foreground`) supaya tidak terbaca sebagai kategori status gizi
 * keenam — nilainya memang jenis ukuran yang berbeda.
 */
export const nutritionHeatmapColumnColor: Record<NutritionHeatmapColumn, string> = {
  ...nutritionCategoryColor,
  [COVERAGE_COLUMN]: "var(--muted-foreground)",
}

export type NutritionHeatmapCell = {
  column: NutritionHeatmapColumn
  /** Siswa pada kategori ini; untuk kolom cakupan: siswa terukur. */
  count: number
  /** Pembagi: siswa terukur untuk kategori, seluruh siswa untuk cakupan. */
  total: number
  /** count/total dalam 0-100. */
  share: number
  /** Kuat warna 0-1; 0 berarti sel kosong. */
  intensity: number
  /** Kelas tanpa siswa terukur: kategori tak punya pembagi, jadi tak bernilai. */
  empty: boolean
}

export type NutritionHeatmapRow = {
  classId: string
  className: string
  /** Seluruh siswa aktif kelas ini. */
  students: number
  /** Siswa kelas ini yang punya kategori status gizi. */
  measured: number
  cells: NutritionHeatmapCell[]
}

export type NutritionHeatmap = {
  columns: readonly NutritionHeatmapColumn[]
  rows: NutritionHeatmapRow[]
}

/**
 * Batas bawah kuat warna supaya sel bernilai kecil tetap terlihat sebagai
 * "ada isinya", bukan tampak kosong seperti sel bernilai 0.
 */
const MIN_CELL_INTENSITY = 0.12

/**
 * Susun matriks kelas × kolom untuk heatmap.
 *
 * Persentase kategori memakai pembagi **siswa terukur kelas itu**, bukan
 * seluruh siswa kelas — sama dengan aturan yang sudah dipakai ringkasan
 * sekolah, sehingga satu kelas tidak terlihat "sehat" hanya karena separuh
 * siswanya belum diukur. Kolom cakupan justru sebaliknya: pembaginya seluruh
 * siswa kelas, karena yang diukur memang kelengkapan datanya.
 *
 * Kuat warna dinormalkan **per kolom** terhadap nilai tertinggi kolom itu,
 * bukan terhadap 100%. Sebaran nyata membuat "Gizi baik" hampir selalu puluhan
 * persen sementara kategori lain satu digit; kalau dinormalkan ke 100% semua
 * kolom selain "Gizi baik" akan tampak seragam pucat dan pola antar kelas —
 * justru guna heatmap ini — tidak terbaca.
 */
export function nutritionHeatmap(summary: NutritionSummary): NutritionHeatmap {
  const rows = summary.classes.filter((row) => row.students > 0)

  const valueOf = (row: ClassNutritionRow, column: NutritionHeatmapColumn) =>
    column === COVERAGE_COLUMN
      ? { count: row.measured, total: row.students }
      : { count: row.counts[column], total: row.measured }

  const columnPeak = new Map<NutritionHeatmapColumn, number>()
  for (const column of NUTRITION_HEATMAP_COLUMNS) {
    const peak = rows.reduce((max, row) => {
      const { count, total } = valueOf(row, column)
      return Math.max(max, share(count, total))
    }, 0)
    columnPeak.set(column, peak)
  }

  return {
    columns: NUTRITION_HEATMAP_COLUMNS,
    rows: rows.map((row) => ({
      classId: row.classId,
      className: row.className,
      students: row.students,
      measured: row.measured,
      cells: NUTRITION_HEATMAP_COLUMNS.map((column) => {
        const { count, total } = valueOf(row, column)
        const value = share(count, total)
        const peak = columnPeak.get(column) ?? 0
        const ratio = peak > 0 ? value / peak : 0
        return {
          column,
          count,
          total,
          share: value,
          intensity: count === 0 ? 0 : MIN_CELL_INTENSITY + ratio * (1 - MIN_CELL_INTENSITY),
          empty: total === 0,
        }
      }),
    })),
  }
}
