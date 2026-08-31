import { Prisma } from "@/app/generated/prisma/client"
import { databaseSchema } from "@/lib/database-config"
import { getClassAccess } from "@/lib/class-access"
import { prisma } from "@/lib/prisma"
import {
  buildClassifiedBuckets,
  defaultRange,
  isTrendGranularity,
  jakartaDate,
  jakartaDateValue,
  jakartaEndOfDay,
  previousRange,
  semesterStartValue,
  type TrendGranularity,
  type TrendResponse,
  type ValidAttendanceStatus,
} from "@/lib/attendance-trend"
import type { requireUser } from "@/lib/auth-guards"

type User = Awaited<ReturnType<typeof requireUser>>
const MAX_RANGE_DAYS = 800

function qualifiedTable(table: string) {
  const schema = databaseSchema(process.env.DATABASE_URL ?? "")
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`
  return Prisma.raw(`${quote(schema)}.${quote(table)}`)
}

export async function readAttendanceTrend(
  user: User,
  params: { granularity?: string | null; from?: string | null; to?: string | null; classId?: string | null },
): Promise<{ ok: true; data: TrendResponse } | { ok: false; status: number; error: string }> {
  const granularity: TrendGranularity = isTrendGranularity(params.granularity) ? params.granularity : "harian"
  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" }, select: { academicYear: true, semester: true },
  })
  const semesterStart = setting ? semesterStartValue(setting) : null
  if (granularity === "semester" && !semesterStart) {
    return { ok: false, status: 409, error: "Tahun ajaran pada Pengaturan belum valid, sehingga awal semester tidak dapat ditentukan" }
  }

  const today = jakartaDateValue(new Date())
  const fallback = defaultRange(granularity, today, semesterStart)
  const from = granularity === "semester" ? fallback.from : (params.from?.trim() || fallback.from)
  const to = granularity === "semester" ? fallback.to : (params.to?.trim() || fallback.to)
  const fromDate = jakartaDate(from)
  const toDate = jakartaEndOfDay(to)
  if (!fromDate || !toDate) return { ok: false, status: 400, error: "Tanggal tidak valid" }
  if (fromDate > toDate) return { ok: false, status: 400, error: "Tanggal mulai tidak boleh setelah tanggal akhir" }
  if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return { ok: false, status: 400, error: "Rentang tanggal terlalu panjang" }
  }

  const access = await getClassAccess(user)
  const allowedClasses = await prisma.schoolClass.findMany({
    where: access.where,
    select: { id: true, students: { where: { active: true }, select: { id: true } } },
  })
  const allowedIds = allowedClasses.map((item) => item.id)
  const classId = params.classId?.trim() || null
  if (classId && !allowedIds.includes(classId)) {
    return { ok: false, status: 404, error: "Kelas tidak ditemukan atau tidak dapat diakses" }
  }
  const classIds = classId ? [classId] : allowedIds
  const expectedByClass = Object.fromEntries(
    allowedClasses.filter((item) => classIds.includes(item.id)).map((item) => [item.id, item.students.length]),
  )
  const emptyData = (): TrendResponse => ({
    granularity, from, to, semester: semesterInfo(setting, semesterStart, granularity),
    buckets: buildClassifiedBuckets({ granularity, from, to, today, expectedByClass, submittedDays: [], rows: [], holidays: [] }),
    comparison: null,
  })
  if (classIds.length === 0) return { ok: true, data: emptyData() }

  const comparisonRange = previousRange(from, to)
  const queryFrom = comparisonRange ? jakartaDate(comparisonRange.from)! : fromDate
  const attendanceTable = qualifiedTable("Attendance")
  const attendanceDayTable = qualifiedTable("AttendanceDay")
  const [rows, submittedDays, holidays] = await Promise.all([
    prisma.$queryRaw<Array<{ date: Date; classId: string; status: ValidAttendanceStatus; total: bigint }>>`
      SELECT
        date_trunc('day', d."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta') AS date,
        d."classId" AS "classId",
        a."status"::text AS status,
        COUNT(*) AS total
      FROM ${attendanceTable} a
      JOIN ${attendanceDayTable} d ON d."id" = a."attendanceDayId"
      WHERE d."date" >= ${queryFrom}
        AND d."date" <= ${toDate}
        AND d."classId" = ANY(${classIds})
      GROUP BY 1, 2, 3
      ORDER BY 1
    `,
    prisma.attendanceDay.findMany({
      where: { date: { gte: queryFrom, lte: toDate }, classId: { in: classIds } },
      select: { date: true, classId: true },
    }),
    prisma.schoolHoliday.findMany({
      where: { date: { gte: queryFrom, lte: toDate } }, select: { date: true, name: true },
    }),
  ])

  const normalizedRows = rows.map((row) => ({
    date: row.date.toISOString().slice(0, 10), classId: row.classId, status: row.status, total: Number(row.total),
  }))
  const normalizedDays = submittedDays.map((day) => ({ date: jakartaDateValue(day.date), classId: day.classId }))
  const normalizedHolidays = holidays.map((holiday) => ({ date: jakartaDateValue(holiday.date), name: holiday.name }))
  const buildRange = (rangeFrom: string, rangeTo: string) => buildClassifiedBuckets({
    granularity, from: rangeFrom, to: rangeTo, today, expectedByClass,
    submittedDays: normalizedDays, rows: normalizedRows, holidays: normalizedHolidays,
  })
  const buckets = buildRange(from, to)
  const previousBuckets = comparisonRange ? buildRange(comparisonRange.from, comparisonRange.to) : []

  return {
    ok: true,
    data: {
      granularity, from, to, semester: semesterInfo(setting, semesterStart, granularity), buckets,
      comparison: comparisonRange ? {
        ...comparisonRange, buckets: previousBuckets,
        available: previousBuckets.some((bucket) => bucket.validRecords > 0),
      } : null,
    },
  }
}

function semesterInfo(
  setting: { academicYear: string; semester: string } | null,
  start: string | null,
  granularity: TrendGranularity,
) {
  if (granularity !== "semester" || !setting || !start) return null
  return { label: setting.semester, academicYear: setting.academicYear, start }
}
