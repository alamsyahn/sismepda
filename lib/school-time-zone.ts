import { DEFAULT_SCHOOL_TIME_ZONE, requireIanaTimeZone } from "@/lib/school-date"

export function resolveSchoolTimeZone(value: unknown): string {
  try {
    return requireIanaTimeZone(value)
  } catch {
    return DEFAULT_SCHOOL_TIME_ZONE
  }
}
