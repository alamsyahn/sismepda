import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { parseDateValue } from "@/lib/date"
import { sortClasses } from "@/lib/class-order"
import { getClassAccess } from "@/lib/class-access"

function jakartaMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date)
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0)
}

function timeLimitMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const access = await getClassAccess(user)
    const date = parseDateValue(new URL(request.url).searchParams.get("date"))
    const classWhere = access.where
    const holiday = await prisma.schoolHoliday.findUnique({ where: { date }, select: { id: true, name: true } })
    const rows = await prisma.schoolClass.findMany({
      where: classWhere,
      include: { students: { where: { active: true } }, homeroomUser: { select: { name: true } }, attendanceDays: { where: { date }, include: { attendances: { include: { student: { include: { attendances: { select: { status: true } } } } } } } } }, orderBy: { name: "asc" },
    })
    const [setting, priorDays, priorHolidays] = await Promise.all([
      prisma.schoolSetting.findUnique({ where: { id: "default" }, select: { attendanceCloseTime: true } }),
      prisma.attendanceDay.findMany({ where: { date: { lt: date }, schoolClass: classWhere }, select: { date: true }, orderBy: { date: "desc" } }),
      prisma.schoolHoliday.findMany({ where: { date: { lt: date } }, select: { date: true } }),
    ])
    const priorHolidayDates = new Set(priorHolidays.map((item) => item.date.toISOString().slice(0, 10)))
    const previousDate = priorDays.find((day) => !priorHolidayDates.has(day.date.toISOString().slice(0, 10)))?.date
    const previousDays = previousDate ? await prisma.attendanceDay.findMany({ where: { date: previousDate, schoolClass: classWhere }, select: { classId: true, attendances: { select: { status: true } } } }) : []
    const previousByClass = new Map(previousDays.map((day) => [day.classId, day.attendances]))
    const closeMinutes = timeLimitMinutes(setting?.attendanceCloseTime ?? "08:00")
    const classes = sortClasses(rows).map((c) => {
      const day = c.attendanceDays[0]; const count = (status: string) => day?.attendances.filter((a) => a.status === status).length ?? 0
      const previous = previousByClass.get(c.id) ?? []
      return { id: c.id, name: c.name, grade: c.grade, homeroom: c.homeroomUser?.name ?? "Belum ditentukan", totalStudents: c.students.length, submitted: Boolean(day), submittedAt: day ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(day.submittedAt).replace(".", ":") : null, onTime: day ? jakartaMinutes(day.submittedAt) <= closeMinutes : null, hadir: count("HADIR"), sakit: count("SAKIT"), izin: count("IZIN"), alfa: count("ALFA"), dispensasi: count("DISPENSASI"), previousHadir: previous.filter((attendance) => attendance.status === "HADIR").length, previousTotal: previous.length }
    })
    const absentStudents = rows.flatMap((c) => c.attendanceDays[0]?.attendances.filter((a) => a.status !== "HADIR").map((a) => { const count = (status: string) => a.student.attendances.filter((item) => item.status === status).length; return { id: a.id, name: a.student.name, nis: a.student.nis, nisn: a.student.nisn, className: c.name, status: a.status.toLowerCase(), note: a.note ?? "-", history: { sakit: count("SAKIT"), izin: count("IZIN"), alfa: count("ALFA"), dispensasi: count("DISPENSASI") } } }) ?? [])
    const recentDays = await prisma.attendanceDay.findMany({ where: { date, schoolClass: classWhere }, include: { schoolClass: true, submittedBy: true, attendances: { select: { status: true } } }, orderBy: { updatedAt: "desc" }, take: 7 })
    const recentActivity = recentDays.map((day) => { const edited = day.updatedAt.getTime() - day.submittedAt.getTime() > 1000; return { id: day.id, teacher: day.submittedBy.name, className: day.schoolClass.name, action: edited ? "memperbarui absensi" : "menginput absensi", time: new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(day.updatedAt).replace(".", ":"), type: edited ? "edit" : "input" } })
    const [trendDays, holidays] = await Promise.all([
      prisma.attendanceDay.findMany({ where: { date: { lte: date }, schoolClass: classWhere }, select: { date: true, attendances: { select: { status: true } } }, orderBy: { date: "desc" } }),
      prisma.schoolHoliday.findMany({ where: { date: { lte: date } }, select: { date: true } }),
    ])
    const holidayDates = new Set(holidays.map((item) => item.date.toISOString().slice(0, 10)))
    const byDate = new Map<string, { date: Date; hadir: number; dispensasi: number; total: number }>()
    for (const day of trendDays) { const key = day.date.toISOString().slice(0, 10); if (holidayDates.has(key)) continue; const item = byDate.get(key) ?? { date: day.date, hadir: 0, dispensasi: 0, total: 0 }; item.hadir += day.attendances.filter((a) => a.status === "HADIR").length; item.dispensasi += day.attendances.filter((a) => a.status === "DISPENSASI").length; item.total += day.attendances.length; byDate.set(key, item) }
    const weeklyTrend = [...byDate.values()].filter((item) => item.total > 0).slice(0, 6).reverse().map((item) => ({ day: new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(item.date).replace(".", ""), hadir: item.hadir, dispensasi: item.dispensasi, total: item.total }))
    return NextResponse.json({ classes, absentStudents, recentActivity, weeklyTrend, holiday })
  } catch { return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 }) }
}
