/**
 * Logika murni untuk grafik "Tren Ketidakhadiran Siswa" pada Rekap Sekolah.
 *
 * Semua fungsi di berkas ini bebas dari Prisma/React supaya mudah diuji dan
 * dipakai ulang oleh route handler maupun komponen klien.
 */

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
}

export type TrendResponse = {
  granularity: TrendGranularity
  from: string
  to: string
  /** Diisi hanya ketika granularity = "semester". */
  semester: { label: string; academicYear: string; start: string } | null
  buckets: TrendBucket[]
}

const JAKARTA = "Asia/Jakarta"
const DAY_MS = 86_400_000

const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/

/** Ubah "YYYY-MM-DD" (tanggal lokal Jakarta) menjadi instant UTC-nya. */
export function jakartaDate(value: string): Date | null {
  if (!DATE_VALUE.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null
  }
  return new Date(check.getTime() - 7 * 60 * 60 * 1000)
}

const jakartaParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: JAKARTA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** "YYYY-MM-DD" untuk sebuah instant, dievaluasi di zona waktu Jakarta. */
export function jakartaDateValue(date: Date): string {
  const parts = Object.fromEntries(jakartaParts.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Akhir hari Jakarta (23:59:59.999) supaya range `lte` inklusif. */
export function jakartaEndOfDay(value: string): Date | null {
  const start = jakartaDate(value)
  return start ? new Date(start.getTime() + DAY_MS - 1) : null
}

function addDaysValue(value: string, days: number): string {
  const date = jakartaDate(value)
  if (!date) return value
  return jakartaDateValue(new Date(date.getTime() + days * DAY_MS))
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

const longDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: JAKARTA,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})
const shortDate = new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, day: "numeric", month: "short" })
const dayMonth = new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, day: "numeric", month: "long" })
const dayOnly = new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, day: "numeric" })
const monthYear = new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, month: "long", year: "numeric" })
const monthShort = new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, month: "short", year: "2-digit" })

/**
 * Rentang tanggal satu minggu, mis. "24–30 Agustus 2026" atau
 * "29 September–5 Oktober 2026" — tanggal nyata, bukan "Minggu 1".
 */
export function weekRangeLabel(startValue: string): string {
  const start = jakartaDate(startValue)
  if (!start) return startValue
  const end = new Date(start.getTime() + 6 * DAY_MS)
  const sameMonth = jakartaDateValue(start).slice(0, 7) === jakartaDateValue(end).slice(0, 7)
  return sameMonth
    ? `${dayOnly.format(start)}–${dayMonth.format(end)} ${jakartaDateValue(end).slice(0, 4)}`
    : `${dayMonth.format(start)}–${dayMonth.format(end)} ${jakartaDateValue(end).slice(0, 4)}`
}

/** Label sumbu X + tooltip untuk sebuah bucket. */
export function bucketLabels(granularity: TrendGranularity, key: string): { label: string; tooltipLabel: string } {
  const date = jakartaDate(key)
  if (!date) return { label: key, tooltipLabel: key }

  if (granularity === "bulanan") {
    return { label: monthShort.format(date), tooltipLabel: monthYear.format(date) }
  }
  if (granularity === "mingguan") {
    const range = weekRangeLabel(key)
    return { label: shortDate.format(date), tooltipLabel: range }
  }
  // Harian dan "sejak awal semester" sama-sama satu bar per tanggal.
  return { label: shortDate.format(date), tooltipLabel: longDate.format(date) }
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

/** Pembulatan tampilan: satu desimal, tanpa ".0" yang mubazir. */
export function formatPercentage(value: number | null): string {
  if (value === null) return "–"
  const rounded = Math.round(value * 10) / 10
  return `${rounded.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`
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

/** Senin pada minggu yang memuat `value` (ISO week, sesuai date_trunc Postgres). */
export function startOfWeekValue(value: string): string {
  const date = jakartaDate(value)
  if (!date) return value
  // getUTCDay() aman: `date` adalah tengah malam Jakarta, dan kita hanya
  // memakainya untuk menghitung offset hari.
  const jakartaMidnightUtc = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  const weekday = (jakartaMidnightUtc.getUTCDay() + 6) % 7 // 0 = Senin
  return addDaysValue(value, -weekday)
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

  return input.bucketKeys.map((key) => ({
    key,
    ...bucketLabels(input.granularity, key),
    counts: counts.get(key) ?? empty(),
    validRecords: valid.get(key) ?? 0,
  }))
}

/** Deret kunci bucket berurutan yang menutupi seluruh rentang. */
export function bucketKeys(granularity: TrendGranularity, from: string, to: string): string[] {
  const mode = bucketGranularity(granularity)
  const end = jakartaDate(to)
  if (!end) return []
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
