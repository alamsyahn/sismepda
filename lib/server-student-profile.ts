import type { AttendanceStatus } from "@/app/generated/prisma/client"
import { getClassAccess } from "@/lib/class-access"
import { prisma } from "@/lib/prisma"
import { summarizeStudentAttendance } from "@/lib/student-profile"
import { clampProfilePage, parseProfileDateRange } from "@/lib/student-profile-query"
import { summarizeViolationPoints } from "@/lib/student-violation-points"

type UserIdentity = { id: string; role: "ADMIN" | "GURU" }

export type StudentHistoryFilter = {
  from?: string
  to?: string
  status?: string
  page?: string
}

const allowedStatuses = new Set<AttendanceStatus>(["HADIR", "SAKIT", "IZIN", "ALFA", "DISPENSASI"])

export async function readStudentProfile(user: UserIdentity, studentId: string, filter: StudentHistoryFilter) {
  const access = await getClassAccess(user)
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolClass: access.where },
    select: {
      id: true,
      name: true,
      nis: true,
      nisn: true,
      active: true,
      schoolClass: { select: { name: true, grade: true, homeroomUser: { select: { name: true } } } },
    },
  })
  if (!student) return null

  const { from, to } = parseProfileDateRange(filter.from, filter.to)
  const requestedStatus = filter.status?.toUpperCase() as AttendanceStatus | undefined
  const status = requestedStatus && allowedStatuses.has(requestedStatus) ? requestedStatus : undefined
  const pageSize = 20
  const dateWhere = from || to ? { gte: from, lte: to } : undefined
  const baseWhere = { studentId, attendanceDay: dateWhere ? { date: dateWhere } : undefined }
  const historyWhere = { ...baseWhere, status }

  const [allRecords, totalHistory, violationPoints] = await Promise.all([
    prisma.attendance.findMany({
      where: baseWhere,
      select: { status: true, attendanceDay: { select: { date: true } } },
      orderBy: { attendanceDay: { date: "asc" } },
    }),
    prisma.attendance.count({ where: historyWhere }),
    prisma.studentViolationPoint.findMany({
      where: { studentId },
      select: { id: true, category: true, points: true, note: true, occurredAt: true, createdAt: true, recordedBy: { select: { name: true } } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    }),
  ])
  const totalPages = Math.max(1, Math.ceil(totalHistory / pageSize))
  const page = clampProfilePage(filter.page, totalPages)
  const history = await prisma.attendance.findMany({
    where: historyWhere,
    select: {
      id: true,
      status: true,
      note: true,
      attendanceDay: {
        select: { date: true, updatedAt: true, submittedBy: { select: { name: true } } },
      },
    },
    orderBy: { attendanceDay: { date: "desc" } },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  const summary = summarizeStudentAttendance(
    allRecords.map((record) => ({ date: record.attendanceDay.date, status: record.status })),
  )
  const pointSummary = summarizeViolationPoints(violationPoints)

  return {
    student,
    summary,
    history,
    violationPoints,
    pointSummary,
    pagination: { page, pageSize, total: totalHistory, totalPages },
    filters: { from: from ? filter.from ?? "" : "", to: to ? filter.to ?? "" : "", status: status?.toLowerCase() ?? "all" },
  }
}
