import { compareSchoolDates, type SchoolDate } from "@/lib/school-date"

/**
 * Tiga tipe entri kalender libur.
 *
 * - `SINGLE`   : satu tanggal tertentu, misalnya libur nasional.
 * - `RECURRING`: hari dalam seminggu yang berulang, misalnya setiap Minggu,
 *                berlaku dalam rentang tanggal tertentu.
 * - `SCHOOL_DAY`: hari masuk khusus yang membatalkan libur pada tanggal itu.
 */
export type HolidayKind = "SINGLE" | "RECURRING" | "SCHOOL_DAY"

/** 0 = Minggu … 6 = Sabtu, mengikuti `Date.prototype.getUTCDay`. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_NAMES: readonly string[] = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
]

export const HOLIDAY_KIND_LABELS: Record<HolidayKind, string> = {
  SINGLE: "Hari libur biasa",
  RECURRING: "Hari libur tetap",
  SCHOOL_DAY: "Hari masuk khusus",
}

export type HolidayRule = {
  id: string
  kind: HolidayKind
  name: string
  /** Terisi untuk `SINGLE` dan `SCHOOL_DAY`. */
  date: SchoolDate | null
  /** Terisi untuk `RECURRING`. */
  weekday: WeekdayIndex | null
  /** Awal berlaku `RECURRING`. */
  startDate: SchoolDate | null
  /** Akhir berlaku `RECURRING`; `null` berarti berlaku selamanya. */
  endDate: SchoolDate | null
}

/** Hasil pemeriksaan satu tanggal. */
export type HolidayVerdict =
  | { isHoliday: false; reason: null }
  | { isHoliday: true; reason: string }

export function weekdayOf(date: SchoolDate): WeekdayIndex {
  // SchoolDate adalah "YYYY-MM-DD" tanpa zona waktu; membacanya sebagai UTC
  // menjaga hasilnya tidak bergeser oleh zona waktu server.
  return new Date(`${date}T00:00:00Z`).getUTCDay() as WeekdayIndex
}

export function isWeekdayIndex(value: unknown): value is WeekdayIndex {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6
}

function withinRange(date: SchoolDate, start: SchoolDate | null, end: SchoolDate | null): boolean {
  if (start && compareSchoolDates(date, start) < 0) return false
  // `end` null berarti berlaku selamanya.
  if (end && compareSchoolDates(date, end) > 0) return false
  return true
}

/**
 * Menentukan apakah satu tanggal adalah hari libur.
 *
 * Hari masuk khusus selalu menang: satu tanggal yang ditandai `SCHOOL_DAY`
 * tetap menjadi hari masuk walaupun tertutup libur tetap maupun libur biasa.
 * Itulah gunanya tipe tersebut — membatalkan libur untuk tanggal tertentu.
 */
export function resolveHoliday(date: SchoolDate, rules: readonly HolidayRule[]): HolidayVerdict {
  let reason: string | null = null

  for (const rule of rules) {
    if (rule.kind === "SCHOOL_DAY") {
      if (rule.date === date) return { isHoliday: false, reason: null }
      continue
    }
    if (reason !== null) continue
    if (rule.kind === "SINGLE") {
      if (rule.date === date) reason = rule.name
      continue
    }
    if (
      rule.weekday !== null &&
      rule.weekday === weekdayOf(date) &&
      withinRange(date, rule.startDate, rule.endDate)
    ) {
      reason = rule.name
    }
  }

  return reason === null ? { isHoliday: false, reason: null } : { isHoliday: true, reason }
}

/** Ringkasan untuk satu tanggal; `null` bila hari itu bukan libur. */
export function holidayNameFor(
  date: SchoolDate,
  rules: readonly HolidayRule[],
): string | null {
  const verdict = resolveHoliday(date, rules)
  return verdict.isHoliday ? verdict.reason : null
}

/** Semua tanggal libur dalam satu rentang, dipakai rekap dan rentetan sakit. */
export function holidayDatesInRange(
  dates: readonly SchoolDate[],
  rules: readonly HolidayRule[],
): SchoolDate[] {
  return dates.filter((date) => resolveHoliday(date, rules).isHoliday)
}
