import { requireClassScopeFor, type ClassScope } from "@/lib/rbac-class-access"
import { buildClassRecap, localDateKey, parseClassRecapRange } from "@/lib/class-recap-period"
import { prisma } from "@/lib/prisma"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import { readHolidayDates } from "@/lib/server-holidays"

/**
 * Rekap satu kelas untuk satu periode.
 *
 * Scope diterima dari pemanggil supaya operasi yang berbeda memakai kewenangan
 * masing-masing: layar rekap memakai `attendance.reports.read`, sedangkan
 * unduhan memakai `attendance.export`. Export TIDAK menumpang izin baca.
 */
export async function readClassPeriodRecap(scope: ClassScope, classId: string, from: string, to: string) {
  const range = parseClassRecapRange(from, to)
  if (!range.ok) return { ok: false as const, status: 400, error: range.error }
  const schoolClass = await prisma.schoolClass.findFirst({
    where: { id: classId, ...scope.where },
    select: {
      id: true, name: true, grade: true,
      homeroomUser: { select: { name: true } },
      students: { where: { active: true }, select: { id: true, nis: true, nisn: true, name: true }, orderBy: { name: "asc" } },
      attendanceDays: {
        where: { date: { gte: range.from, lte: range.to } },
        select: { date: true, attendances: { select: { studentId: true, status: true } } },
      },
    },
  })
  if (!schoolClass) return { ok: false as const, status: 404, error: "Kelas tidak ditemukan atau tidak dapat diakses" }
  // Nama libur per tanggal, sudah memperhitungkan libur tetap dan hari masuk
  // khusus; kuncinya SchoolDate agar cocok dengan `range.dates`.
  const holidayNames = await readHolidayDates(range.dates.map((date) => fromPrismaDate(date)))
  const submittedDates = new Set(schoolClass.attendanceDays.map((day) => localDateKey(day.date)))
  const records = schoolClass.attendanceDays.flatMap((day) => day.attendances.map((record) => ({ studentId: record.studentId, date: day.date, status: record.status })))
  const holidayKeys = new Set(
    range.dates.filter((date) => holidayNames.has(fromPrismaDate(date))).map((date) => localDateKey(date)),
  )
  const recap = buildClassRecap({ students: schoolClass.students, dates: range.dates, holidays: holidayKeys, submittedDates, records })
  return {
    ok: true as const,
    data: {
      schoolClass: { id: schoolClass.id, name: schoolClass.name, grade: schoolClass.grade, homeroom: schoolClass.homeroomUser?.name ?? "Belum ditentukan" },
      from, to,
      dates: range.dates.map((date) => {
        const key = localDateKey(date)
        const holiday = holidayNames.get(fromPrismaDate(date)) ?? null
        return {
          value: String(key),
          day: Number(key.slice(8, 10)),
          weekday: formatSchoolDate(fromPrismaDate(date), { weekday: "short" }),
          holiday,
          submitted: !holiday && submittedDates.has(key),
        }
      }),
      ...recap,
    },
  }
}

export async function readAccessibleClassOptions() {
  const scope = await requireClassScopeFor("attendance.reports", "read")
  return prisma.schoolClass.findMany({ where: scope.where, select: { id: true, name: true }, orderBy: [{ grade: "asc" }, { name: "asc" }] })
}
