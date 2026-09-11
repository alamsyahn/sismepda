export const DEFAULT_SCHOOL_TIME_ZONE: string = "Asia/Jakarta"

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export function requireIanaTimeZone(value: unknown, message = "Zona waktu sekolah tidak valid"): string {
  if (!isIanaTimeZone(value)) throw new SchoolDateError(message)
  return value
}

const DAY_MS = 86_400_000
const SCHOOL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

declare const schoolDateBrand: unique symbol
export type SchoolDate = string & { readonly [schoolDateBrand]: true }

declare const schoolMonthBrand: unique symbol
export type SchoolMonth = string & { readonly [schoolMonthBrand]: true }

export class SchoolDateError extends Error {
  constructor(message = "Tanggal tidak valid") {
    super(message)
    this.name = "SchoolDateError"
  }
}

function utcDate(year: number, month: number, day: number): Date {
  const result = new Date(0)
  result.setUTCHours(0, 0, 0, 0)
  result.setUTCFullYear(year, month - 1, day)
  return result
}

function parts(value: SchoolDate): [number, number, number] {
  const match = SCHOOL_DATE_PATTERN.exec(value)
  if (!match) throw new SchoolDateError()
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0")
}

function fromUtcParts(date: Date): SchoolDate {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` as SchoolDate
}

export function parseSchoolDate(value: unknown): SchoolDate | null {
  if (typeof value !== "string") return null
  const match = SCHOOL_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1) return null
  const check = utcDate(year, month, day)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null
  return value as SchoolDate
}

export function isSchoolDate(value: unknown): value is SchoolDate {
  return parseSchoolDate(value) !== null
}

export function requireSchoolDate(value: unknown, message = "Tanggal tidak valid"): SchoolDate {
  const parsed = parseSchoolDate(value)
  if (!parsed) throw new SchoolDateError(message)
  return parsed
}

/** Prisma maps PostgreSQL DATE to Date; UTC midnight is the sole adapter representation. */
export function toPrismaDate(value: SchoolDate): Date {
  const [year, month, day] = parts(value)
  return utcDate(year, month, day)
}

/** Use only for Prisma fields declared with @db.Date, never for timestamps. */
export function fromPrismaDate(value: Date): SchoolDate {
  if (Number.isNaN(value.getTime())) throw new SchoolDateError("Nilai DATE database tidak valid")
  if (
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0
  ) throw new SchoolDateError("Timestamp tidak boleh diperlakukan sebagai tanggal sekolah")
  return fromUtcParts(value)
}

export function fromNullablePrismaDate(value: Date | null | undefined): SchoolDate | null {
  return value ? fromPrismaDate(value) : null
}

function schoolDatePartsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en", {
    timeZone: requireIanaTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

/** Project an instant to the configured school calendar explicitly. */
export function schoolDateFromInstant(
  instant: Date,
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): SchoolDate {
  if (Number.isNaN(instant.getTime())) throw new SchoolDateError("Timestamp tidak valid")
  const values = Object.fromEntries(
    schoolDatePartsFormatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]),
  )
  return requireSchoolDate(`${pad(Number(values.year), 4)}-${values.month}-${values.day}`)
}

export function todayInSchoolTimeZone(
  now = new Date(),
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): SchoolDate {
  return schoolDateFromInstant(now, timeZone)
}

export function formatSchoolDate(
  value: SchoolDate,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  },
  locale = "id-ID",
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(toPrismaDate(value))
}

export function compareSchoolDates(a: SchoolDate, b: SchoolDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

export function addSchoolDays(value: SchoolDate, amount: number): SchoolDate {
  if (!Number.isSafeInteger(amount)) throw new SchoolDateError("Jumlah hari tidak valid")
  return fromUtcParts(new Date(toPrismaDate(value).getTime() + amount * DAY_MS))
}

export function differenceInSchoolDays(from: SchoolDate, to: SchoolDate): number {
  return Math.round((toPrismaDate(to).getTime() - toPrismaDate(from).getTime()) / DAY_MS)
}

export function eachSchoolDate(
  from: SchoolDate,
  to: SchoolDate,
  options: { maxDays?: number } = {},
): SchoolDate[] {
  const difference = differenceInSchoolDays(from, to)
  if (difference < 0) throw new SchoolDateError("Tanggal mulai tidak boleh setelah tanggal akhir")
  const count = difference + 1
  if (count > (options.maxDays ?? 2_000)) throw new SchoolDateError("Rentang tanggal terlalu panjang")
  return Array.from({ length: count }, (_, index) => addSchoolDays(from, index))
}

export function prismaSchoolDateRange(from: SchoolDate, to: SchoolDate): { gte: Date; lte: Date } {
  if (compareSchoolDates(from, to) > 0) throw new SchoolDateError("Tanggal mulai tidak boleh setelah tanggal akhir")
  return { gte: toPrismaDate(from), lte: toPrismaDate(to) }
}

export function schoolYearRange(year: number): { gte: Date; lte: Date } {
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999) throw new SchoolDateError("Tahun tidak valid")
  return prismaSchoolDateRange(
    requireSchoolDate(`${pad(year, 4)}-01-01`),
    requireSchoolDate(`${pad(year, 4)}-12-31`),
  )
}

export function schoolMonthOf(value: SchoolDate): SchoolMonth {
  return value.slice(0, 7) as SchoolMonth
}

export function startOfSchoolMonth(value: SchoolDate | SchoolMonth): SchoolDate {
  return requireSchoolDate(`${value.slice(0, 7)}-01`)
}

export function startOfSchoolWeek(value: SchoolDate): SchoolDate {
  const weekday = (toPrismaDate(value).getUTCDay() + 6) % 7
  return addSchoolDays(value, -weekday)
}

function timeZoneOffsetMilliseconds(instant: Date, timeZone: string): number {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: requireIanaTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  )
  const projectedAsUtc = utcDate(
    Number(values.year),
    Number(values.month),
    Number(values.day),
  )
  projectedAsUtc.setUTCHours(
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
    0,
  )
  return projectedAsUtc.getTime() - Math.floor(instant.getTime() / 1_000) * 1_000
}

/** Timestamp boundary only; never persist this in an @db.Date field. */
export function schoolDateAtStart(
  value: SchoolDate,
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): Date {
  const [year, month, day] = parts(value)
  const localMidnightAsUtc = utcDate(year, month, day).getTime()
  let instant = new Date(localMidnightAsUtc)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = new Date(localMidnightAsUtc - timeZoneOffsetMilliseconds(instant, timeZone))
    if (corrected.getTime() === instant.getTime()) break
    instant = corrected
  }
  if (schoolDateFromInstant(instant, timeZone) !== value) {
    throw new SchoolDateError("Awal tanggal tidak dapat ditentukan untuk zona waktu sekolah")
  }
  return instant
}

export function schoolTimestampRange(
  from: SchoolDate,
  to: SchoolDate,
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
): { gte: Date; lt: Date } {
  if (compareSchoolDates(from, to) > 0) throw new SchoolDateError("Tanggal mulai tidak boleh setelah tanggal akhir")
  return {
    gte: schoolDateAtStart(from, timeZone),
    lt: schoolDateAtStart(addSchoolDays(to, 1), timeZone),
  }
}

export function formatSchoolTime(
  instant: Date,
  timeZone = DEFAULT_SCHOOL_TIME_ZONE,
  locale = "id-ID",
): string {
  if (Number.isNaN(instant.getTime())) throw new SchoolDateError("Timestamp tidak valid")
  return new Intl.DateTimeFormat(locale, {
    timeZone: requireIanaTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant).replace(".", ":")
}

export function schoolMinutesOfDay(instant: Date, timeZone = DEFAULT_SCHOOL_TIME_ZONE): number {
  const formatted = formatSchoolTime(instant, timeZone, "en-GB")
  const [hour, minute] = formatted.split(":").map(Number)
  return hour * 60 + minute
}
