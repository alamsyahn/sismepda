import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { formatSchoolDate, formatSchoolTime, fromPrismaDate, parseSchoolDate, schoolMinutesOfDay, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { sortClasses } from "@/lib/class-order"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { authFailureResponse } from "@/lib/api-errors"
import { isClassRecapComplete } from "@/lib/attendance-save"
import { readHolidayFor, readHolidayRules } from "@/lib/server-holidays"
import { resolveHoliday } from "@/lib/holiday-rules"

function timeLimitMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

export async function GET(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const scope = await requireClassScopeFor("attendance.dashboard", "read")
    const dateParam = new URL(request.url).searchParams.get("date")
    const schoolDate = dateParam === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(dateParam)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
    const date = toPrismaDate(schoolDate)
    const classWhere = scope.where
    const holiday = await readHolidayFor(schoolDate)
    const rows = await prisma.schoolClass.findMany({
      where: classWhere,
      include: {
        students: { where: { active: true } },
        homeroomUser: { select: { id: true, name: true } },
        attendanceDays: {
          where: { date },
          include: {
            attendances: {
              include: {
                student: { include: { attendances: { select: { status: true } } } },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    })
    const [setting, priorDays, priorHolidays] = await Promise.all([
      prisma.schoolSetting.findUnique({ where: { id: "default" }, select: { attendanceCloseTime: true } }),
      prisma.attendanceDay.findMany({ where: { date: { lt: date }, schoolClass: classWhere }, select: { date: true }, orderBy: { date: "desc" } }),
      readHolidayRules(),
    ])
    // Aturan berulang tidak dapat disaring di SQL, sehingga tanggal calon
    // diperiksa satu per satu terhadap seluruh aturan.
    const previousDate = priorDays.find((day) => !resolveHoliday(fromPrismaDate(day.date), priorHolidays).isHoliday)?.date
    const previousDays = previousDate ? await prisma.attendanceDay.findMany({ where: { date: previousDate, schoolClass: classWhere }, select: { classId: true, attendances: { select: { status: true } } } }) : []
    const previousByClass = new Map(previousDays.map((day) => [day.classId, day.attendances]))
    const closeMinutes = timeLimitMinutes(setting?.attendanceCloseTime ?? "08:00")
    const classes = sortClasses(rows).map((c) => {
      const day = c.attendanceDays[0]; const count = (status: string) => day?.attendances.filter((a) => a.status === status).length ?? 0
      const previous = previousByClass.get(c.id) ?? []
      return { id: c.id, name: c.name, grade: c.grade, homeroom: c.homeroomUser?.name ?? "Belum ditentukan", homeroomId: c.homeroomUser?.id ?? null, totalStudents: c.students.length, submitted: isClassRecapComplete({ totalStudents: c.students.length, recorded: day?.attendances.length ?? 0 }), submittedAt: day ? formatSchoolTime(day.submittedAt, timeZone) : null, onTime: day ? schoolMinutesOfDay(day.submittedAt, timeZone) <= closeMinutes : null, hadir: count("HADIR"), sakit: count("SAKIT"), izin: count("IZIN"), alfa: count("ALFA"), dispensasi: count("DISPENSASI"), previousHadir: previous.filter((attendance) => attendance.status === "HADIR").length, previousTotal: previous.length }
    })
    const absentStudents = rows.flatMap((c) => c.attendanceDays[0]?.attendances.filter((a) => a.status !== "HADIR").map((a) => { const count = (status: string) => a.student.attendances.filter((item) => item.status === status).length; return { id: a.student.id, name: a.student.name, nis: a.student.nis, nisn: a.student.nisn, classId: c.id, className: c.name, status: a.status.toLowerCase(), note: a.note ?? "-", history: { sakit: count("SAKIT"), izin: count("IZIN"), alfa: count("ALFA"), dispensasi: count("DISPENSASI") } } }) ?? [])
    const recentDays = await prisma.attendanceDay.findMany({ where: { date, schoolClass: classWhere }, include: { schoolClass: true, submittedBy: true, attendances: { select: { status: true } } }, orderBy: { updatedAt: "desc" }, take: 7 })
    const recentActivity = recentDays.map((day) => { const edited = day.updatedAt.getTime() - day.submittedAt.getTime() > 1000; return { id: day.id, teacherId: day.submittedBy.id, teacher: day.submittedBy.name, className: day.schoolClass.name, action: edited ? "memperbarui absensi" : "menginput absensi", time: formatSchoolTime(day.updatedAt, timeZone), type: edited ? "edit" : "input" } })
    const [trendDays, holidays] = await Promise.all([
      prisma.attendanceDay.findMany({ where: { date: { lte: date }, schoolClass: classWhere }, select: { date: true, attendances: { select: { status: true } } }, orderBy: { date: "desc" } }),
      readHolidayRules(),
    ])
    const holidayDates = new Set(
      trendDays.filter((day) => resolveHoliday(fromPrismaDate(day.date), holidays).isHoliday).map((day) => fromPrismaDate(day.date)),
    )
    const byDate = new Map<string, { date: ReturnType<typeof fromPrismaDate>; hadir: number; dispensasi: number; total: number }>()
    for (const day of trendDays) { const key = fromPrismaDate(day.date); if (holidayDates.has(key)) continue; const item = byDate.get(key) ?? { date: key, hadir: 0, dispensasi: 0, total: 0 }; item.hadir += day.attendances.filter((a) => a.status === "HADIR").length; item.dispensasi += day.attendances.filter((a) => a.status === "DISPENSASI").length; item.total += day.attendances.length; byDate.set(key, item) }
    const weeklyTrend = [...byDate.values()].filter((item) => item.total > 0).slice(0, 6).reverse().map((item) => ({ date: item.date, day: formatSchoolDate(item.date, { weekday: "short" }).replace(".", ""), hadir: item.hadir, dispensasi: item.dispensasi, total: item.total }))
    return NextResponse.json({ classes, absentStudents, recentActivity, weeklyTrend, holiday })
  } catch (error) {
    return authFailureResponse(error, "Dashboard gagal dimuat")
  }
}
