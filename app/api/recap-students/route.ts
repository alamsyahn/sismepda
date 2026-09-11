import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { fromPrismaDate, parseSchoolDate, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { sortClasses } from "@/lib/class-order"
import { getClassAccess } from "@/lib/class-access"
import { readHolidayFor } from "@/lib/server-holidays"

export async function GET(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const user = await requireUser()
    const dateParam = new URL(request.url).searchParams.get("date")
    const schoolDate = dateParam === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(dateParam)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
    const today = toPrismaDate(schoolDate)
    const classWhere = (await getClassAccess(user)).where
    const [students, classes, holiday] = await Promise.all([
      prisma.student.findMany({ where: { active: true, schoolClass: classWhere }, include: { schoolClass: true, attendances: { include: { attendanceDay: true } } }, orderBy: { name: "asc" } }),
      prisma.schoolClass.findMany({ where: classWhere, select: { name: true }, orderBy: { name: "asc" } }),
      readHolidayFor(fromPrismaDate(today)),
    ])
    const rows = students.map((s) => { const count = (status: string) => s.attendances.filter((a) => a.status === status).length; const todayRecord = s.attendances.find((a) => a.attendanceDay.date.getTime() === today.getTime()); return { id: s.id, nis: s.nis, nisn: s.nisn, name: s.name, className: s.schoolClass.name, grade: s.schoolClass.grade, hadir: count("HADIR"), sakit: count("SAKIT"), izin: count("IZIN"), dispensasi: count("DISPENSASI"), alfa: count("ALFA"), todayStatus: todayRecord?.status.toLowerCase() ?? null } })
    return NextResponse.json({ students: rows, classes: sortClasses(classes).map((item) => item.name), holiday })
  } catch { return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 }) }
}
