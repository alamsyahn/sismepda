import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import type { ClassRecord } from "@/lib/dashboard-data"
import type { AbsenceRankingRow } from "@/components/dashboard/absence-ranking"
import { sortClasses } from "@/lib/class-order"
import { getClassAccess } from "@/lib/class-access"

export async function getClassRecords(date: Date): Promise<ClassRecord[]> {
  const user = await requireUser()
  const access = await getClassAccess(user)
  const rows = await prisma.schoolClass.findMany({
    where: access.where,
    include: { students: { where: { active: true } }, homeroomUser: true, attendanceDays: { where: { date }, include: { attendances: true } } },
    orderBy: { name: "asc" },
  })
  return sortClasses(rows).map((c) => {
    const day = c.attendanceDays[0]
    const count = (status: string) => day?.attendances.filter((a) => a.status === status).length ?? 0
    return {
      id: c.id, name: c.name, grade: c.grade as ClassRecord["grade"],
      homeroom: c.homeroomUser?.name ?? "Belum ditentukan", totalStudents: c.students.length,
      submitted: Boolean(day), submittedAt: day ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(day.submittedAt).replace(".", ":") : null,
      onTime: null, previousHadir: 0, previousTotal: 0,
      hadir: count("HADIR"), sakit: count("SAKIT"), izin: count("IZIN"), alfa: count("ALFA"), dispensasi: count("DISPENSASI"),
    }
  })
}

export async function getAbsenceRanking(): Promise<AbsenceRankingRow[]> {
  const user = await requireUser()
  const access = await getClassAccess(user)
  const students = await prisma.student.findMany({
    where: {
      active: true,
      schoolClass: access.where,
    },
    select: {
      id: true,
      nis: true,
      nisn: true,
      name: true,
      schoolClass: { select: { name: true } },
      attendances: {
        where: { status: { in: ["SAKIT", "IZIN", "ALFA", "DISPENSASI"] } },
        select: { status: true },
      },
    },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }],
  })

  return students.map((student) => {
    const count = (status: "SAKIT" | "IZIN" | "ALFA" | "DISPENSASI") =>
      student.attendances.filter((attendance) => attendance.status === status).length

    return {
      id: student.id,
      nis: student.nis,
      nisn: student.nisn,
      name: student.name,
      className: student.schoolClass.name,
      sakit: count("SAKIT"),
      izin: count("IZIN"),
      alfa: count("ALFA"),
      dispensasi: count("DISPENSASI"),
    }
  })
}

export async function getHoliday(date: Date) {
  return prisma.schoolHoliday.findUnique({ where: { date }, select: { id: true, name: true } })
}
