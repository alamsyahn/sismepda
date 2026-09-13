/**
 * Agregasi kesehatan satu kelas untuk halaman Pantauan Kesehatan Kelas.
 *
 * Modul ini murni — tanpa Prisma dan tanpa React — sehingga dipakai bersama
 * oleh server (menyusun ringkasan dari hasil query) dan komponen klien
 * (memfilter/mengurutkan tabel tanpa memuat ulang halaman), dan tetap dapat
 * diuji sebagai unit.
 *
 * **Tidak ada formula kesehatan baru di sini.** IMT tetap dari
 * `calculateBmi()`, status gizi tetap dari `nutritionStatus()` (IMT/U, WHO
 * 5-19 tahun + ambang Permenkes 2/2020), rentetan sakit tetap dari
 * `sickStreakLengths()`, dan peringkat keluhan tetap dari `rankTerms()`.
 * Berkas ini hanya menyusun ulang angka yang sudah ada menjadi bentuk satu
 * kelas.
 *
 * **Tidak ada skor risiko buatan.** "Perlu perhatian" adalah gabungan sinyal
 * yang masing-masing punya dasar data di aplikasi, dan setiap alasannya selalu
 * ikut ditampilkan — bukan satu angka buram.
 */

import { nutritionCategoryLabels, type NutritionCategory } from "@/lib/bmi-for-age"
import {
  ageInYears,
  calculateBmi,
  nutritionStatus,
  type NutritionUnknownReason,
} from "@/lib/euks"
import { NUTRITION_CATEGORY_ORDER, nutritionCategoryColor } from "@/lib/euks-nutrition"
import { rankTerms, type TrendCount } from "@/lib/euks-trends"
import { bucketGranularity, bucketKeys, bucketLabels, type TrendGranularity } from "@/lib/attendance-trend"
import { sickStreakLengths } from "@/lib/sick-streak"
import type { SchoolDate } from "@/lib/school-date"

/** Berapa keluhan teratas yang ditampilkan sebelum baris "Lainnya". */
export const TOP_CLASS_COMPLAINTS = 8

/**
 * Ambang "sakit berturut-turut" yang dianggap perlu perhatian.
 *
 * Sama dengan ambang merah `streakTone()` pada tabel absensi sakit per siswa,
 * jadi satu siswa tidak bisa tampak merah di satu halaman dan aman di halaman
 * lain. Angkanya diambil dari perilaku yang sudah berjalan, bukan ditetapkan
 * baru di sini.
 */
export const ATTENTION_SICK_STREAK = 3

/** Satu siswa aktif beserta bahan mentah yang sudah discope ke kelas ini. */
export type ClassStudentInput = {
  id: string
  name: string
  birthDate: string | null
  gender: "LAKI_LAKI" | "PEREMPUAN" | null
  /** Pengukuran valid TERBARU siswa ini; null bila belum pernah diukur. */
  latest: { measuredAt: string; heightCm: number; weightKg: number } | null
  /** Tanggal sakit dalam periode terpilih. */
  sickDates: SchoolDate[]
  /** Tanggal kunjungan UKS dalam periode terpilih. */
  visitDates: SchoolDate[]
}

export type ClassMonitoringInput = {
  classId: string
  className: string
  students: ClassStudentInput[]
  /** Keluhan setiap kunjungan dalam periode, sudah discope ke kelas ini. */
  complaints: string[]
  /** Hari libur dalam periode; dipakai penomoran rentetan sakit. */
  holidays: SchoolDate[]
  from: SchoolDate
  to: SchoolDate
  granularity: TrendGranularity
  /** Tanggal hari ini di zona waktu sekolah; dipakai menghitung umur. */
  today: SchoolDate
}

/** Alasan seorang siswa masuk daftar "perlu perhatian". */
export type AttentionReason =
  | { kind: "nutrition"; category: NutritionCategory; label: string }
  | { kind: "sick_streak"; days: number; label: string }
  | { kind: "incomplete"; reason: NutritionUnknownReason; label: string }

export const incompleteReasonLabels: Record<NutritionUnknownReason, string> = {
  no_measurement: "Belum ada pengukuran",
  no_birth_date: "Tanggal lahir belum tersedia",
  no_gender: "Jenis kelamin belum tersedia",
  age_out_of_range: "Umur di luar rentang rujukan (5-19 tahun)",
}

/** Satu baris tabel Data Kesehatan Siswa. */
export type ClassStudentHealthRow = {
  studentId: string
  name: string
  gender: "LAKI_LAKI" | "PEREMPUAN" | null
  /** Umur dalam tahun penuh; null bila tanggal lahir belum diisi. */
  ageYears: number | null
  /** Hari sakit dalam periode terpilih. */
  sickDays: number
  /** Rentetan sakit terpanjang dalam periode terpilih. */
  longestSickStreak: number
  /** Kunjungan UKS dalam periode terpilih. */
  visits: number
  heightCm: number | null
  weightKg: number | null
  bmi: number | null
  category: NutritionCategory | null
  /** Alasan spesifik ketika `category` null — tidak pernah disatukan jadi "-". */
  unknownReason: NutritionUnknownReason | null
  /** Tanggal pengukuran yang dipakai baris ini. */
  measuredAt: string | null
  attentionReasons: AttentionReason[]
}

export type NutritionDistributionSlice = {
  /** Kategori kanonik, atau "unknown" untuk "Belum dapat dinilai". */
  key: NutritionCategory | typeof UNKNOWN_SLICE
  label: string
  color: string
  count: number
  /** Porsi terhadap SELURUH siswa kelas, 0-100 — bar ini menjumlah 100%. */
  share: number
}

/** Kunci irisan "Belum dapat dinilai" pada bar distribusi. */
export const UNKNOWN_SLICE = "belum_dinilai"

export type ClassSickTrendBucket = {
  key: string
  label: string
  tooltipLabel: string
  /** Total hari sakit pada bucket ini. */
  sickDays: number
  /** Siswa berbeda yang sakit pada bucket ini. */
  students: number
}

export type ClassVisitTrendBucket = {
  key: string
  label: string
  tooltipLabel: string
  visits: number
}

export type DataCompletenessReason = {
  reason: NutritionUnknownReason
  label: string
  count: number
}

export type ClassMonitoringSummary = {
  classId: string
  className: string
  totalStudents: number
  /** Siswa yang status gizinya dapat dinilai. */
  assessableStudents: number
  /** Porsi siswa yang dapat dinilai terhadap seluruh siswa, 0-100. */
  completenessShare: number
  totalSickDays: number
  totalVisits: number
  attentionCount: number
  distribution: NutritionDistributionSlice[]
  sickTrend: ClassSickTrendBucket[]
  visitTrend: ClassVisitTrendBucket[]
  complaints: TrendCount[]
  completenessReasons: DataCompletenessReason[]
  rows: ClassStudentHealthRow[]
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

/**
 * Rentetan sakit terpanjang seorang siswa dalam periode.
 *
 * `sickStreakLengths()` menomori tiap tanggal dengan posisinya di dalam
 * rentetannya, jadi nilai terbesar adalah panjang rentetan terpanjang. Hari
 * libur diperlakukan sama seperti pada tabel absensi sakit per siswa — aturan
 * liburnya tidak ditulis ulang di sini.
 */
export function longestSickStreakOf(dates: SchoolDate[], holidays: SchoolDate[]): number {
  if (dates.length === 0) return 0
  return Math.max(...sickStreakLengths(dates.map((date) => ({ date })), holidays))
}

/**
 * Susun satu baris siswa.
 *
 * Umur dihitung pada tanggal pengukuran terakhir bila ada — umur itulah yang
 * dipakai klasifikasi IMT/U, sehingga baris tabel dan status gizinya tidak
 * bisa bercerita berbeda. Siswa yang belum pernah diukur memakai tanggal hari
 * ini, karena umurnya tetap fakta yang diketahui meski pengukurannya belum ada.
 */
export function buildStudentRow(
  student: ClassStudentInput,
  options: { holidays: SchoolDate[]; today: SchoolDate },
): ClassStudentHealthRow {
  const bmi = student.latest ? calculateBmi(student.latest.heightCm, student.latest.weightKg) : null
  const status = nutritionStatus({
    bmi,
    measuredAt: student.latest?.measuredAt ?? null,
    birthDate: student.birthDate,
    gender: student.gender,
  })

  const ageReference = student.latest?.measuredAt ?? options.today
  const ageYears = student.birthDate ? ageInYears(student.birthDate, ageReference) : null
  const longestSickStreak = longestSickStreakOf(student.sickDates, options.holidays)

  const attentionReasons: AttentionReason[] = []
  if (status.kind === "known") {
    if (status.category !== "gizi_baik") {
      attentionReasons.push({
        kind: "nutrition",
        category: status.category,
        label: nutritionCategoryLabels[status.category],
      })
    }
  } else {
    attentionReasons.push({
      kind: "incomplete",
      reason: status.reason,
      label: incompleteReasonLabels[status.reason],
    })
  }
  if (longestSickStreak >= ATTENTION_SICK_STREAK) {
    attentionReasons.push({
      kind: "sick_streak",
      days: longestSickStreak,
      label: `Sakit ${longestSickStreak} hari berturut-turut`,
    })
  }

  return {
    studentId: student.id,
    name: student.name,
    gender: student.gender,
    ageYears,
    sickDays: student.sickDates.length,
    longestSickStreak,
    visits: student.visitDates.length,
    heightCm: student.latest?.heightCm ?? null,
    weightKg: student.latest?.weightKg ?? null,
    bmi,
    category: status.kind === "known" ? status.category : null,
    unknownReason: status.kind === "known" ? null : status.reason,
    measuredAt: student.latest?.measuredAt ?? null,
    attentionReasons,
  }
}

/**
 * Distribusi status gizi sebagai bar bertumpuk 100%.
 *
 * Pembaginya SELURUH siswa kelas, bukan hanya yang terukur, karena irisan
 * "Belum dapat dinilai" ikut digambar — bar ini menjawab "seluruh kelas
 * terdiri dari apa", sementara heatmap Halaman Utama menjawab "dari yang sudah
 * terukur, sebarannya bagaimana". Keduanya sengaja berbeda pembagi dan
 * masing-masing menyebutkannya sendiri.
 */
export function nutritionDistribution(rows: ClassStudentHealthRow[]): NutritionDistributionSlice[] {
  const total = rows.length
  const slices: NutritionDistributionSlice[] = NUTRITION_CATEGORY_ORDER.map((category) => {
    const count = rows.filter((row) => row.category === category).length
    return {
      key: category,
      label: nutritionCategoryLabels[category],
      color: nutritionCategoryColor[category],
      count,
      share: share(count, total),
    }
  })

  const unknown = rows.filter((row) => row.category === null).length
  slices.push({
    key: UNKNOWN_SLICE,
    label: "Belum dapat dinilai",
    color: "var(--muted-foreground)",
    count: unknown,
    share: share(unknown, total),
  })

  return slices
}

/**
 * Tren hari sakit per bucket waktu.
 *
 * Bucket dibentuk `bucketKeys()`/`bucketLabels()` dari modul tren absensi yang
 * sudah ada, sehingga periode kosong tetap muncul bernilai nol — sama seperti
 * grafik tren yang sudah berjalan — dan penamaan bucketnya identik.
 */
export function sickTrend(input: {
  students: ClassStudentInput[]
  from: SchoolDate
  to: SchoolDate
  granularity: TrendGranularity
}): ClassSickTrendBucket[] {
  const keys = bucketKeys(input.granularity, input.from, input.to)
  const days = new Map<string, number>()
  const students = new Map<string, Set<string>>()

  for (const student of input.students) {
    for (const date of student.sickDates) {
      const key = bucketKeyOf(date, input.granularity, keys)
      if (key === null) continue
      days.set(key, (days.get(key) ?? 0) + 1)
      const set = students.get(key) ?? new Set<string>()
      set.add(student.id)
      students.set(key, set)
    }
  }

  return keys.map((key) => ({
    key,
    ...bucketLabels(input.granularity, key),
    sickDays: days.get(key) ?? 0,
    students: students.get(key)?.size ?? 0,
  }))
}

/** Tren kunjungan UKS per bucket waktu; periode kosong tetap bernilai nol. */
export function visitTrend(input: {
  students: ClassStudentInput[]
  from: SchoolDate
  to: SchoolDate
  granularity: TrendGranularity
}): ClassVisitTrendBucket[] {
  const keys = bucketKeys(input.granularity, input.from, input.to)
  const counts = new Map<string, number>()

  for (const student of input.students) {
    for (const date of student.visitDates) {
      const key = bucketKeyOf(date, input.granularity, keys)
      if (key === null) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return keys.map((key) => ({
    key,
    ...bucketLabels(input.granularity, key),
    visits: counts.get(key) ?? 0,
  }))
}

/**
 * Bucket yang memuat sebuah tanggal.
 *
 * Kunci bucket dicari dari deret `keys` yang sudah dibentuk, bukan dihitung
 * ulang dengan aturan minggu/bulan sendiri: tanggal di luar rentang jatuh ke
 * `null` dan tidak diam-diam masuk ke bucket tepi.
 */
function bucketKeyOf(date: string, granularity: TrendGranularity, keys: string[]): string | null {
  if (keys.length === 0 || date < keys[0]) return null
  const mode = bucketGranularity(granularity)
  if (mode === "harian") return keys.includes(date) ? date : null
  // Bucket terakhir yang awalnya tidak melewati tanggal ini.
  let found: string | null = null
  for (const key of keys) {
    if (key <= date) found = key
    else break
  }
  return found
}

/** Kelengkapan data: hitungan per alasan kanonik, terbanyak dulu. */
export function completenessReasons(rows: ClassStudentHealthRow[]): DataCompletenessReason[] {
  const counts = new Map<NutritionUnknownReason, number>()
  for (const row of rows) {
    if (!row.unknownReason) continue
    counts.set(row.unknownReason, (counts.get(row.unknownReason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: incompleteReasonLabels[reason], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "id"))
}

/** Ringkasan lengkap satu kelas, satu-satunya sumber angka halaman ini. */
export function summarizeClassMonitoring(input: ClassMonitoringInput): ClassMonitoringSummary {
  const rows = input.students
    .map((student) => buildStudentRow(student, { holidays: input.holidays, today: input.today }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"))

  const assessable = rows.filter((row) => row.category !== null).length

  return {
    classId: input.classId,
    className: input.className,
    totalStudents: rows.length,
    assessableStudents: assessable,
    completenessShare: share(assessable, rows.length),
    totalSickDays: rows.reduce((sum, row) => sum + row.sickDays, 0),
    totalVisits: rows.reduce((sum, row) => sum + row.visits, 0),
    attentionCount: rows.filter((row) => row.attentionReasons.length > 0).length,
    distribution: nutritionDistribution(rows),
    sickTrend: sickTrend({
      students: input.students,
      from: input.from,
      to: input.to,
      granularity: input.granularity,
    }),
    visitTrend: visitTrend({
      students: input.students,
      from: input.from,
      to: input.to,
      granularity: input.granularity,
    }),
    // Normalisasi keluhan memakai `rankTerms()` yang sudah dipakai Halaman
    // Utama: pengelompokan hanya menyamakan huruf besar-kecil dan spasi, tanpa
    // pemetaan sinonim medis apa pun.
    complaints: rankTerms(input.complaints, TOP_CLASS_COMPLAINTS),
    completenessReasons: completenessReasons(rows),
    rows,
  }
}

/** Kolom tabel yang dapat diurutkan. */
export const CLASS_TABLE_SORTS = ["nama", "sakit", "uks", "imt", "diukur"] as const
export type ClassTableSort = (typeof CLASS_TABLE_SORTS)[number]

export function isClassTableSort(value: unknown): value is ClassTableSort {
  return typeof value === "string" && (CLASS_TABLE_SORTS as readonly string[]).includes(value)
}

export type ClassTableFilters = {
  search: string
  /** Kategori gizi, `UNKNOWN_SLICE`, atau "" untuk semua. */
  nutrition: string
  /** "LAKI_LAKI" | "PEREMPUAN" | "" */
  gender: string
  attentionOnly: boolean
  sort: ClassTableSort
  descending: boolean
}

export const defaultClassTableFilters: ClassTableFilters = {
  search: "",
  nutrition: "",
  gender: "",
  attentionOnly: false,
  sort: "nama",
  descending: false,
}

/**
 * Saring dan urutkan baris tabel.
 *
 * Nilai yang tidak diketahui (IMT/tanggal ukur kosong) selalu ditaruh di
 * belakang, arah pengurutan apa pun: siswa tanpa data bukan "yang terkecil",
 * dan menempatkannya di puncak daftar terurut akan menyesatkan.
 */
export function filterAndSortRows(
  rows: ClassStudentHealthRow[],
  filters: ClassTableFilters,
): ClassStudentHealthRow[] {
  const needle = filters.search.trim().toLowerCase()
  const filtered = rows.filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false
    if (filters.nutrition) {
      const key = row.category ?? UNKNOWN_SLICE
      if (key !== filters.nutrition) return false
    }
    if (filters.gender && row.gender !== filters.gender) return false
    if (filters.attentionOnly && row.attentionReasons.length === 0) return false
    return true
  })

  const direction = filters.descending ? -1 : 1
  const compare = (a: ClassStudentHealthRow, b: ClassStudentHealthRow): number => {
    switch (filters.sort) {
      case "sakit":
        return (a.sickDays - b.sickDays) * direction
      case "uks":
        return (a.visits - b.visits) * direction
      case "imt":
        return compareNullable(a.bmi, b.bmi, direction)
      case "diukur":
        return compareNullable(a.measuredAt, b.measuredAt, direction)
      default:
        return a.name.localeCompare(b.name, "id") * direction
    }
  }

  return [...filtered].sort((a, b) => compare(a, b) || a.name.localeCompare(b.name, "id"))
}

function compareNullable<T extends number | string>(
  a: T | null,
  b: T | null,
  direction: number,
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === "number" && typeof b === "number") return (a - b) * direction
  return String(a).localeCompare(String(b)) * direction
}

/** "L" / "P", atau penanda eksplisit ketika jenis kelamin belum diisi. */
export function genderShortLabel(gender: "LAKI_LAKI" | "PEREMPUAN" | null): string {
  if (gender === "LAKI_LAKI") return "L"
  if (gender === "PEREMPUAN") return "P"
  return "–"
}

/** Umur tampilan, mis. "13 th"; tanpa tanggal lahir bukan 0 melainkan tak diketahui. */
export function formatAge(ageYears: number | null): string {
  return ageYears === null ? "–" : `${ageYears} th`
}
