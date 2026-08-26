import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { parseDateValue, startOfToday } from "@/lib/date"
import { sortClasses } from "@/lib/class-order"
import { canAccessClass, getClassAccess } from "@/lib/class-access"

const attendanceInput = z.object({
  classId: z.string().min(1),
  date: z.string().optional(),
  records: z.array(z.object({
    studentId: z.string().min(1),
    status: z.enum(["HADIR", "SAKIT", "IZIN", "ALFA", "DISPENSASI"]),
    note: z.string().optional(),
  })),
})

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const access = await getClassAccess(user)
    const date = parseDateValue(new URL(request.url).searchParams.get("date"))
    const classes = await prisma.schoolClass.findMany({
      where: access.where,
      include: { students: { where: { active: true }, orderBy: { name: "asc" } }, homeroomUser: { select: { name: true } }, attendanceDays: { where: { date }, include: { attendances: true, submittedBy: { select: { name: true } } } } },
      orderBy: { name: "asc" },
    })
    const holiday = await prisma.schoolHoliday.findUnique({ where: { date }, select: { id: true, name: true } })
    return NextResponse.json({ classes: sortClasses(classes), holiday })
  } catch { return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 }) }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const access = await getClassAccess(user)
    const body = attendanceInput.parse(await request.json())
    const cls = await prisma.schoolClass.findUnique({ where: { id: body.classId } })
    if (!cls || !canAccessClass(access, cls, user.id)) return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
    const studentIds = body.records.map((record) => record.studentId)
    if (new Set(studentIds).size !== studentIds.length) return NextResponse.json({ error: "Data siswa duplikat" }, { status: 400 })
    const validStudents = await prisma.student.count({ where: { id: { in: studentIds }, classId: body.classId, active: true } })
    if (validStudents !== studentIds.length) return NextResponse.json({ error: "Terdapat siswa yang tidak terdaftar di kelas ini" }, { status: 400 })
    const date = parseDateValue(body.date)
    if (date > startOfToday()) return NextResponse.json({ error: "Tanggal absensi tidak boleh di masa depan" }, { status: 400 })
    const holiday = await prisma.schoolHoliday.findUnique({ where: { date }, select: { name: true } })
    if (holiday) return NextResponse.json({ error: `Tanggal ini ditandai sebagai hari libur: ${holiday.name}` }, { status: 400 })
    await prisma.$transaction(async (tx) => {
      const day = await tx.attendanceDay.upsert({ where: { classId_date: { classId: body.classId, date } }, update: { submittedById: user.id }, create: { classId: body.classId, date, submittedById: user.id } })
      for (const r of body.records) await tx.attendance.upsert({ where: { attendanceDayId_studentId: { attendanceDayId: day.id, studentId: r.studentId } }, update: { status: r.status, note: r.note }, create: { attendanceDayId: day.id, studentId: r.studentId, status: r.status, note: r.note } })
    })
    return NextResponse.json({ ok: true, submittedAt: new Date().toISOString(), submittedBy: user.name ?? "Guru" })
  } catch { return NextResponse.json({ error: "Gagal menyimpan absensi" }, { status: 400 }) }
}
