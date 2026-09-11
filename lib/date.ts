import {
  formatSchoolDate,
  fromPrismaDate,
  parseSchoolDate,
  schoolDateFromInstant,
  todayInSchoolTimeZone,
  toPrismaDate,
  type SchoolDate,
} from "@/lib/school-date"

/** @deprecated Prefer todayInSchoolTimeZone/fromPrismaDate at explicit boundaries. */
export function localDateValue(date?: Date): SchoolDate {
  return date ? fromPrismaDate(date) : todayInSchoolTimeZone()
}

/** Project a real instant onto the configured school calendar. */
export function indonesiaDateValue(date = new Date()): SchoolDate {
  return schoolDateFromInstant(date)
}

/**
 * Compatibility helper for optional UI/query inputs. Present invalid values and
 * missing values both fall back to the configured school timezone today; API writes must use
 * parseSchoolDate/requireSchoolDate directly so invalid input is rejected.
 */
export function parseDateValue(value?: string | null): Date {
  return toPrismaDate(parseSchoolDate(value) ?? todayInSchoolTimeZone())
}

export function startOfToday(): Date {
  return toPrismaDate(todayInSchoolTimeZone())
}

export function formatLongDate(value: string): string {
  return formatSchoolDate(parseSchoolDate(value) ?? todayInSchoolTimeZone())
}
