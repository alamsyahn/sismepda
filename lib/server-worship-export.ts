import type { PrismaClient } from "@/app/generated/prisma/client"
import { ApiError } from "@/lib/api-errors"
import type { ClassScope } from "@/lib/rbac-class-access"
import { differenceInSchoolDays, fromPrismaDate, parseSchoolDate, prismaSchoolDateRange, type SchoolDate } from "@/lib/school-date"
import { WORSHIP_EXPORT_MAX_DAYS } from "@/lib/worship-attendance"

const studentSelect = { id: true, name: true, nis: true } as const

export function parseWorshipExportRange(fromValue: string | null, toValue: string | null, today: SchoolDate) {
  const from = parseSchoolDate(fromValue)
  const to = parseSchoolDate(toValue)
  if (!from || !to || from > to || to > today) throw new ApiError(400, "Rentang tanggal tidak valid")
  if (differenceInSchoolDays(from, to) >= WORSHIP_EXPORT_MAX_DAYS) {
    throw new ApiError(400, `Rentang ekspor maksimal ${WORSHIP_EXPORT_MAX_DAYS} hari`)
  }
  return { from, to }
}

export async function readWorshipExport(
  db: PrismaClient, scope: ClassScope, classId: string, range: { from: SchoolDate; to: SchoolDate },
) {
  const date = prismaSchoolDateRange(range.from, range.to)
  const schoolClass = await db.schoolClass.findFirst({
    where: { id: classId, ...scope.where },
    select: {
      name: true,
      students: { where: { active: true }, select: studentSelect },
      attendanceDays: {
        where: { date },
        select: { date: true, attendances: { select: { student: { select: studentSelect }, status: true } } },
      },
    },
  })
  if (!schoolClass) throw new ApiError(404, "Kelas tidak ditemukan atau tidak dapat diakses")
  const records = await db.worshipAttendance.findMany({
    where: { classId, date },
    select: {
      date: true, status: true, firstScannedAt: true, manualByName: true,
      student: { select: studentSelect },
    },
  })

  const students = new Map(schoolClass.students.map((student) => [student.id, student]))
  const dates = new Set<SchoolDate>()
  const schools = new Map(schoolClass.attendanceDays.map((day) => {
    const dayKey = fromPrismaDate(day.date)
    dates.add(dayKey)
    return [dayKey, new Map(day.attendances.map((record) => {
      students.set(record.student.id, record.student)
      return [record.student.id, record.status]
    }))]
  }))
  const worshipByDate = new Map<SchoolDate, Map<string, (typeof records)[number]>>()
  for (const record of records) {
    const dayKey = fromPrismaDate(record.date)
    dates.add(dayKey)
    students.set(record.student.id, record.student)
    const byStudent = worshipByDate.get(dayKey) ?? new Map()
    byStudent.set(record.student.id, record)
    worshipByDate.set(dayKey, byStudent)
  }
  const roster = [...students.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "id") || left.id.localeCompare(right.id))
  const active = new Set(schoolClass.students.map((student) => student.id))
  const totals = new Map(roster.map((student) => [student.id, { attended: 0, excused: 0 }]))
  const details = [...dates].sort().flatMap((day) => roster.flatMap((student) => {
    const school = schools.get(day)?.get(student.id) ?? null
    const worship = worshipByDate.get(day)?.get(student.id) ?? null
    if (!active.has(student.id) && !school && !worship) return []
    const total = totals.get(student.id)!
    if (worship?.status === "IKUT") total.attended += 1
    if (worship?.status === "DISPENSASI") total.excused += 1
    return [{ day, student, school, worship }]
  }))
  const summary = roster.map((student) => ({ ...student, ...totals.get(student.id)! }))
  return { className: schoolClass.name, ...range, summary, details }
}
