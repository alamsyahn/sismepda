import { formatSchoolDate, fromPrismaDate, schoolDateFromInstant, schoolMonthOf } from "@/lib/school-date"

export type StudentAttendanceStatus = "HADIR" | "SAKIT" | "IZIN" | "ALFA" | "DISPENSASI"

export type StudentAttendancePoint = {
  date: Date
  status: StudentAttendanceStatus
}

export function summarizeStudentAttendance(records: StudentAttendancePoint[], now = new Date(), timeZone?: string) {
  const sorted = [...records].sort((a, b) => a.date.getTime() - b.date.getTime())
  const counts = { hadir: 0, sakit: 0, izin: 0, dispensasi: 0, alfa: 0 }
  const months = new Map<string, { key: string; label: string; hadir: number; tidakHadir: number }>()

  for (const record of sorted) {
    const status = record.status.toLowerCase() as keyof typeof counts
    counts[status] += 1
    const schoolDate = fromPrismaDate(record.date)
    const key = schoolMonthOf(schoolDate)
    const month = months.get(key) ?? {
      key,
      label: formatSchoolDate(schoolDate, { month: "short" }).replace(".", ""),
      hadir: 0,
      tidakHadir: 0,
    }
    if (record.status === "HADIR") month.hadir += 1
    else month.tidakHadir += 1
    months.set(key, month)
  }

  let currentPresentStreak = 0
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].status !== "HADIR") break
    currentPresentStreak += 1
  }

  const lastAlfaDate = [...sorted].reverse().find((record) => record.status === "ALFA")?.date ?? null
  const currentMonth = schoolMonthOf(schoolDateFromInstant(now, timeZone))
  const currentMonthAbsences = sorted.filter(
    (record) => schoolMonthOf(fromPrismaDate(record.date)) === currentMonth && record.status !== "HADIR",
  ).length
  const total = sorted.length

  return {
    counts,
    total,
    attendanceRate: total > 0 ? Math.round((counts.hadir / total) * 100) : 0,
    currentPresentStreak,
    lastAlfaDate,
    currentMonthAbsences,
    monthlyTrend: [...months.values()],
  }
}
