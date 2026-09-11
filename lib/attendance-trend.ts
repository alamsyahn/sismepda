/**
 * Logika murni untuk grafik "Tren Ketidakhadiran Siswa" pada Rekap Sekolah.
 *
 * Semua fungsi di berkas ini bebas dari Prisma/React supaya mudah diuji dan
 * dipakai ulang oleh route handler maupun komponen klien.
 */

import {
  addSchoolDays,
  differenceInSchoolDays,
  formatSchoolDate,
  parseSchoolDate,
  schoolDateFromInstant,
  startOfSchoolWeek,
  toPrismaDate,
} from "@/lib/school-date"

/** Status ketidakhadiran yang boleh tampil sebagai seri grafik (tanpa Hadir). */
export const TREND_STATUSES = ["sakit", "izin", "alfa", "dispensasi"] as const
export type TrendStatus = (typeof TREND_STATUSES)[number]

/**
 * Seluruh status absensi yang dianggap "data absensi valid".
 * Ini adalah penyebut persentase — Hadir ikut dihitung karena satu record
 * Hadir tetap merupakan satu kesempatan kehadiran yang sudah difinalisasi.
 * "Belum diisi" tidak punya record sama sekali sehingga otomatis tidak masuk.
 */
export const VALID_ATTENDANCE_STATUSES = ["HADIR", "SAKIT", "IZIN", "ALFA", "DISPENSASI"] as const
export type ValidAttendanceStatus = (typeof VALID_ATTENDANCE_STATUSES)[number]

export const TREND_GRANULARITIES = ["harian", "mingguan", "bulanan", "semester"] as const
export type TrendGranularity = (typeof TREND_GRANULARITIES)[number]

export const TREND_MEASURES = ["jumlah", "persentase"] as const
export type TrendMeasure = (typeof TREND_MEASURES)[number]
export type TrendBucketState = "active" | "holiday" | "no_data" | "future"

export type TrendBucket = {
  /** Kunci stabil, sekaligus tanggal awal bucket (YYYY-MM-DD, waktu Jakarta). */
  key: string
  /** Label ringkas untuk sumbu X. */
  label: string
  /** Label panjang untuk tooltip, mis. "Senin, 31 Agustus 2026". */
  tooltipLabel: string
  counts: Record<TrendStatus, number>
  /** Jumlah seluruh record absensi valid pada bucket (penyebut persentase). */
  validRecords: number
  expectedAttendance: number
  missingRecords: number
  state: TrendBucketState
  activeDays: number
  holidayDays: number
  noDataDays: number
  futureDays: number
  holidayNames: string[]
  isCurrentDay: boolean
}

export type TrendResponse = {
  granularity: TrendGranularity
  from: string
  to: string
  /** Diisi hanya ketika granularity = "semester". */
  semester: { label: string; academicYear: string; start: string } | null
  buckets: TrendBucket[]
  comparison: { from: string; to: string; buckets: TrendBucket[]; available: boolean } | null
}

/** Compatibility adapter for callers that still consume Prisma's Date shape. */
export function jakartaDate(value: string): Date | null {
  const parsed = parseSchoolDate(value)
  return parsed ? toPrismaDate(parsed) : null
}

/** Project an instant to its configured school-calendar date. */
export function jakartaDateValue(date: Date): string {
  return schoolDateFromInstant(date)
}

function addDaysValue(value: string, days: number): string {
  const date = parseSchoolDate(value)
  return date ? addSchoolDays(date, days) : value
}

/**
 * Awal semester aktif, diturunkan dari `SchoolSetting.academicYear` +
 * `SchoolSetting.semester` yang sudah ada — bukan definisi periode akademik baru.
 *
 * Konvensi kalender pendidikan Indonesia:
 *   - Ganjil "2025/2026" -> 1 Juli 2025
 *   - Genap  "2025/2026" -> 1 Januari 2026
 *
 * Mengembalikan null bila tahun ajaran tidak dapat diurai, sehingga pemanggil
 * bisa memberi pesan yang jelas alih-alih memakai tanggal karangan.
 */
export function semesterStartValue(setting: { academicYear: string; semester: string }): string | null {
  const years = setting.academicYear.match(/(\d{4})\s*\/\s*(\d{4})/)
  const single = setting.academicYear.match(/^\s*(\d{4})\s*$/)
  const genap = /genap/i.test(setting.semester)

  if (years) {
    const [, first, second] = years
    return genap ? `${second}-01-01` : `${first}-07-01`
  }
  if (single) {
    const year = Number(single[1])
    return genap ? `${year + 1}-01-01` : `${year}-07-01`
  }
  return null
}

/**
 * Rentang tanggal satu minggu, mis. "24–30 Agustus 2026" atau
 * "29 September–5 Oktober 2026" — tanggal nyata, bukan "Minggu 1".
 */
export function weekRangeLabel(startValue: string): string {
  const start = parseSchoolDate(startValue)
  if (!start) return startValue
  const end = addSchoolDays(start, 6)
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  return sameMonth
    ? `${formatSchoolDate(start, { day: "numeric" })}–${formatSchoolDate(end, { day: "numeric", month: "long" })} ${end.slice(0, 4)}`
    : `${formatSchoolDate(start, { day: "numeric", month: "long" })}–${formatSchoolDate(end, { day: "numeric", month: "long" })} ${end.slice(0, 4)}`
}

/** Label sumbu X + tooltip untuk sebuah bucket. */
export function bucketLabels(granularity: TrendGranularity, key: string): { label: string; tooltipLabel: string } {
  const date = parseSchoolDate(key)
  if (!date) return { label: key, tooltipLabel: key }

  if (granularity === "bulanan") {
    return { label: formatSchoolDate(date, { month: "short", year: "2-digit" }), tooltipLabel: formatSchoolDate(date, { month: "long", year: "numeric" }) }
  }
  if (granularity === "mingguan") {
    const range = weekRangeLabel(key)
    return { label: formatSchoolDate(date, { day: "numeric", month: "short" }), tooltipLabel: range }
  }
  return { label: formatSchoolDate(date, { day: "numeric", month: "short" }), tooltipLabel: formatSchoolDate(date) }
}

/**
 * Persentase satu status terhadap seluruh record absensi valid pada bucket.
 * Mengembalikan null (bukan NaN/Infinity) ketika tidak ada data valid sama
 * sekali, supaya bucket kosong bisa ditampilkan sebagai "tidak ada data".
 */
export function statusPercentage(count: number, validRecords: number): number | null {
  if (!Number.isFinite(count) || !Number.isFinite(validRecords) || validRecords <= 0) return null
  return (count / validRecords) * 100
}

export function missingPercentage(bucket: Pick<TrendBucket, "missingRecords" | "expectedAttendance">): number | null {
  if (bucket.expectedAttendance <= 0) return null
  return (bucket.missingRecords / bucket.expectedAttendance) * 100
}

/**
 * Urutan menggambar segmen stack. Legend, tooltip, dan ringkasan membaca
 * status dari atas ke bawah (Sakit lebih dulu), sedangkan SVG menumpuk dari
 * dasar plot ke atas. Membalik urutan gambar membuat status pertama pada
 * legend berada paling atas pada batang tanpa mengubah nilai apa pun.
 */
export function stackSegmentOrder(statuses: readonly TrendStatus[]): TrendStatus[] {
  return [...statuses].reverse()
}

export type TooltipPlacement = { x: number; y: number; side: "left" | "right" }

/**
 * Menempatkan tooltip dekat batang aktif tanpa menutupinya.
 * Prioritas: kanan-atas, lalu kiri-atas bila tidak muat, dan selalu
 * di-clamp agar tetap berada di dalam container chart.
 */
export function tooltipPlacement(input: {
  barX: number
  barWidth: number
  barTop: number
  chart: { width: number; height: number }
  tooltip: { width: number; height: number }
  gap?: number
  padding?: number
}): TooltipPlacement {
  const gap = input.gap ?? 12
  const padding = input.padding ?? 8
  const { chart, tooltip } = input
  const rightX = input.barX + input.barWidth + gap
  const fitsRight = rightX + tooltip.width + padding <= chart.width
  const side: "left" | "right" = fitsRight ? "right" : "left"
  const rawX = fitsRight ? rightX : input.barX - gap - tooltip.width
  const maxX = Math.max(padding, chart.width - tooltip.width - padding)
  const maxY = Math.max(padding, chart.height - tooltip.height - padding)
  return {
    x: clamp(rawX, padding, maxX),
    y: clamp(input.barTop, padding, maxY),
    side,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Nilai satu seri untuk mode grafik yang dipilih. */
export function trendValue(
  bucket: Pick<TrendBucket, "counts" | "validRecords">,
  status: TrendStatus,
  measure: TrendMeasure,
): number | null {
  return measure === "jumlah"
    ? bucket.counts[status]
    : statusPercentage(bucket.counts[status], bucket.validRecords)
}

/** Total hanya dari status yang sedang dicentang pengguna. */
export function selectedStatusTotal(
  buckets: Array<Pick<TrendBucket, "counts">>,
  statuses: readonly TrendStatus[],
): number {
  return buckets.reduce(
    (sum, bucket) => sum + statuses.reduce((bucketSum, status) => bucketSum + bucket.counts[status], 0),
    0,
  )
}

/** Pembulatan tampilan: satu desimal, tanpa ".0" yang mubazir. */
export function formatPercentage(value: number | null): string {
  if (value === null) return "–"
  const rounded = Math.round(value * 10) / 10
  return `${rounded.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`
}

export function niceTrendMaximum(max: number, measure: TrendMeasure): number {
  if (max <= 0) return measure === "persentase" ? 1 : 4
  const padded = max * 1.12
  const magnitude = 10 ** Math.floor(Math.log10(padded))
  const normalized = padded / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return measure === "persentase" ? Math.min(100, nice * magnitude) : nice * magnitude
}

/**
 * Rentang default per granularity, relatif terhadap `today` (YYYY-MM-DD).
 * Dipilih agar grafik tidak terlalu padat: harian = bulan berjalan,
 * mingguan = 12 minggu, bulanan = 12 bulan.
 */
export function defaultRange(
  granularity: TrendGranularity,
  today: string,
  semesterStart: string | null,
): { from: string; to: string } {
  if (granularity === "semester") {
    return { from: semesterStart ?? `${today.slice(0, 4)}-01-01`, to: today }
  }
  if (granularity === "harian") {
    return { from: `${today.slice(0, 7)}-01`, to: today }
  }
  if (granularity === "mingguan") {
    return { from: addDaysValue(startOfWeekValue(today), -7 * 11), to: today }
  }
  const [year, month] = today.slice(0, 7).split("-").map(Number)
  const fromMonth = month - 11
  const fromYear = year + Math.floor((fromMonth - 1) / 12)
  const normalized = ((fromMonth - 1) % 12 + 12) % 12 + 1
  return { from: `${fromYear}-${String(normalized).padStart(2, "0")}-01`, to: today }
}

/** Senin pada minggu yang memuat `value` (ISO week). */
export function startOfWeekValue(value: string): string {
  const date = parseSchoolDate(value)
  return date ? startOfSchoolWeek(date) : value
}

/** Granularity yang benar-benar dipakai untuk mengelompokkan record. */
export function bucketGranularity(granularity: TrendGranularity): "harian" | "mingguan" | "bulanan" {
  // "Sejak awal semester" adalah rentang, bukan cara pengelompokan: rentangnya
  // panjang sehingga dikelompokkan per bulan agar tetap terbaca.
  return granularity === "semester" ? "bulanan" : granularity
}

export function isTrendGranularity(value: unknown): value is TrendGranularity {
  return typeof value === "string" && (TREND_GRANULARITIES as readonly string[]).includes(value)
}

export function isTrendStatus(value: unknown): value is TrendStatus {
  return typeof value === "string" && (TREND_STATUSES as readonly string[]).includes(value)
}

/**
 * Susun bucket lengkap dari baris agregat database.
 *
 * `rows` boleh renggang (bucket tanpa record tidak muncul); bucket yang hilang
 * tetap dibuat dengan nilai nol dan `validRecords: 0` agar sumbu waktu tidak
 * bolong dan bucket tanpa data absensi valid dapat dibedakan dengan jelas.
 */
export function buildBuckets(input: {
  granularity: TrendGranularity
  bucketKeys: string[]
  rows: Array<{ bucket: string; status: ValidAttendanceStatus; total: number }>
}): TrendBucket[] {
  const empty = (): Record<TrendStatus, number> => ({ sakit: 0, izin: 0, alfa: 0, dispensasi: 0 })
  const counts = new Map<string, Record<TrendStatus, number>>()
  const valid = new Map<string, number>()

  for (const row of input.rows) {
    const total = Number(row.total) || 0
    valid.set(row.bucket, (valid.get(row.bucket) ?? 0) + total)
    const status = row.status.toLowerCase()
    if (!isTrendStatus(status)) continue // HADIR: hanya menambah penyebut.
    const bucketCounts = counts.get(row.bucket) ?? empty()
    bucketCounts[status] += total
    counts.set(row.bucket, bucketCounts)
  }

  return input.bucketKeys.map((key) => {
    const validRecords = valid.get(key) ?? 0
    return {
      key,
      ...bucketLabels(input.granularity, key),
      counts: counts.get(key) ?? empty(),
      validRecords,
      expectedAttendance: 0,
      missingRecords: 0,
      state: validRecords > 0 ? "active" as const : "no_data" as const,
      activeDays: validRecords > 0 ? 1 : 0,
      holidayDays: 0,
      noDataDays: validRecords > 0 ? 0 : 1,
      futureDays: 0,
      holidayNames: [],
      isCurrentDay: false,
    }
  })
}

type ClassifiedRow = { date: string; classId: string; status: ValidAttendanceStatus; total: number }

export function buildClassifiedBuckets(input: {
  granularity: TrendGranularity
  from: string
  to: string
  today: string
  expectedByClass: Record<string, number>
  submittedDays: Array<{ date: string; classId: string }>
  rows: ClassifiedRow[]
  holidays: Array<{ date: string; name: string }>
}): TrendBucket[] {
  const mode = bucketGranularity(input.granularity)
  const expectedPerDay = Object.values(input.expectedByClass).reduce((sum, count) => sum + count, 0)
  const submittedDates = new Set(input.submittedDays.map((day) => day.date))
  const holidays = new Map(input.holidays.map((holiday) => [holiday.date, holiday.name]))
  const rowsByDate = new Map<string, ClassifiedRow[]>()
  for (const row of input.rows) rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row])

  const daily = bucketKeys("harian", input.from, input.to).map((date) => {
    const holidayName = holidays.get(date)
    const state: TrendBucketState = holidayName ? "holiday" : date > input.today ? "future"
      : submittedDates.has(date) ? "active" : "no_data"
    const counts: Record<TrendStatus, number> = { sakit: 0, izin: 0, alfa: 0, dispensasi: 0 }
    let validRecords = 0
    if (state === "active") for (const row of rowsByDate.get(date) ?? []) {
      validRecords += row.total
      const status = row.status.toLowerCase()
      if (isTrendStatus(status)) counts[status] += row.total
    }
    return {
      date,
      bucket: mode === "harian" ? date : mode === "mingguan" ? startOfWeekValue(date) : `${date.slice(0, 7)}-01`,
      counts,
      validRecords,
      expectedAttendance: state === "active" ? expectedPerDay : 0,
      missingRecords: state === "active" ? Math.max(0, expectedPerDay - validRecords) : 0,
      state,
      holidayName,
    }
  })

  return bucketKeys(input.granularity, input.from, input.to).map((key) => {
    const days = daily.filter((day) => day.bucket === key)
    const activeDays = days.filter((day) => day.state === "active").length
    const holidayDays = days.filter((day) => day.state === "holiday").length
    const noDataDays = days.filter((day) => day.state === "no_data").length
    const futureDays = days.filter((day) => day.state === "future").length
    const state: TrendBucketState = activeDays > 0 ? "active" : holidayDays > 0 && noDataDays === 0
      ? "holiday" : noDataDays > 0 ? "no_data" : "future"
    const counts = { sakit: 0, izin: 0, alfa: 0, dispensasi: 0 }
    for (const day of days) for (const status of TREND_STATUSES) counts[status] += day.counts[status]
    return {
      key,
      ...bucketLabels(input.granularity, key),
      counts,
      validRecords: days.reduce((sum, day) => sum + day.validRecords, 0),
      expectedAttendance: days.reduce((sum, day) => sum + day.expectedAttendance, 0),
      missingRecords: days.reduce((sum, day) => sum + day.missingRecords, 0),
      state,
      activeDays,
      holidayDays,
      noDataDays,
      futureDays,
      holidayNames: [...new Set(days.flatMap((day) => day.holidayName ? [day.holidayName] : []))],
      isCurrentDay: days.some((day) => day.date === input.today),
    }
  })
}

export function previousRange(from: string, to: string): { from: string; to: string } | null {
  const fromDate = parseSchoolDate(from)
  const toDate = parseSchoolDate(to)
  if (!fromDate || !toDate || fromDate > toDate) return null
  const days = differenceInSchoolDays(fromDate, toDate) + 1
  return { from: addDaysValue(from, -days), to: addDaysValue(from, -1) }
}

export function comparisonChange(current: number, previous: number, measure: TrendMeasure) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  const difference = current - previous
  return {
    direction: difference > 0 ? "up" as const : difference < 0 ? "down" as const : "equal" as const,
    difference,
    relativePercent: measure === "jumlah" && previous !== 0 ? (difference / previous) * 100
      : measure === "jumlah" && difference === 0 ? 0 : null,
  }
}

/** Deret kunci bucket berurutan yang menutupi seluruh rentang. */
export function bucketKeys(granularity: TrendGranularity, from: string, to: string): string[] {
  const mode = bucketGranularity(granularity)
  const start = parseSchoolDate(from)
  const end = parseSchoolDate(to)
  if (!start || !end || start > end) return []
  const keys: string[] = []

  if (mode === "bulanan") {
    let [year, month] = from.slice(0, 7).split("-").map(Number)
    const endKey = to.slice(0, 7)
    while (`${year}-${String(month).padStart(2, "0")}` <= endKey) {
      keys.push(`${year}-${String(month).padStart(2, "0")}-01`)
      month += 1
      if (month > 12) { month = 1; year += 1 }
    }
    return keys
  }

  const step = mode === "mingguan" ? 7 : 1
  let cursor = mode === "mingguan" ? startOfWeekValue(from) : from
  // Batas aman: satu tahun harian tetap jauh di bawah ambang ini.
  for (let guard = 0; guard < 2000 && cursor <= to; guard += 1) {
    keys.push(cursor)
    cursor = addDaysValue(cursor, step)
  }
  return keys
}
