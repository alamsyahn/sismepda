import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"

export function parseProfileDateRange(fromValue?: string, toValue?: string) {
  const fromSchoolDate = fromValue ? parseSchoolDate(fromValue) : null
  const toSchoolDate = toValue ? parseSchoolDate(toValue) : null
  if ((fromValue && !fromSchoolDate) || (toValue && !toSchoolDate) || (fromSchoolDate && toSchoolDate && fromSchoolDate > toSchoolDate)) {
    return { from: undefined, to: undefined }
  }
  return {
    from: fromSchoolDate ? toPrismaDate(fromSchoolDate) : undefined,
    to: toSchoolDate ? toPrismaDate(toSchoolDate) : undefined,
  }
}

export function clampProfilePage(value: string | undefined, totalPages: number) {
  if (!value || !/^\d{1,6}$/.test(value)) return 1
  const requested = Number(value)
  if (!Number.isSafeInteger(requested) || requested < 1) return 1
  return Math.min(requested, Math.max(1, totalPages))
}
