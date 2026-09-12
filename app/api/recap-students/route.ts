import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { fromPrismaDate, parseSchoolDate, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { sortClasses } from "@/lib/class-order"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { authFailureResponse } from "@/lib/api-errors"
import { readHolidayFor } from "@/lib/server-holidays"

export async function GET(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const scope = await requireClassScopeFor("attendance.reports", "read")
    const dateParam = new URL(request.url).searchParams.get("date")
    const schoolDate = dateParam === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(dateParam)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
    const today = toPrismaDate(schoolDate)
    const classWhere = scope.where
    const [students, classes, holiday] = await Promise.all([
      prisma.student.findMany({ where: { active: true, schoolClass: classWhere }, include: { schoolClass: true, attendances: { include: { attendanceDay: true } } }, orderBy: { name: "asc" } }),
      prisma.schoolClass.findMany({ where: classWhere, select: { name: true }, orderBy: { name: "asc" } }),
      readHolidayFor(fromPrismaDate(today)),
    ])
    const rows = students.map((s) => { const count = (status: string) => s.attendances.filter((a) => a.status === status).length; const todayRecord = s.attendances.find((a) => a.attendanceDay.date.getTime() === today.getTime()); return { id: s.id, nis: s.nis, nisn: s.nisn, name: s.name, className: s.schoolClass.name, grade: s.schoolClass.grade, hadir: count("HADIR"), sakit: count("SAKIT"), izin: count("IZIN"), dispensasi: count("DISPENSASI"), alfa: count("ALFA"), todayStatus: todayRecord?.status.toLowerCase() ?? null } })
    return NextResponse.json({ students: rows, classes: sortClasses(classes).map((item) => item.name), holiday })
  } catch (error) {
    return authFailureResponse(error, "Rekap siswa gagal dimuat")
  }
}
