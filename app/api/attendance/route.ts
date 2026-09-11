import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { fromPrismaDate, parseSchoolDate, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { sortClasses } from "@/lib/class-order"
import { canAccessClass, getClassAccess } from "@/lib/class-access"
import { FILLED_WIRE_STATUSES, UNFILLED_WIRE_STATUS, planAttendanceWrite } from "@/lib/attendance-save"

const attendanceInput = z.object({
  classId: z.string().min(1),
  date: z.string(),
  records: z.array(z.object({
    studentId: z.string().min(1),
    // "BELUM" = siswa sengaja dibiarkan kosong. Diterima di sini agar absensi
    // parsial bisa disimpan, lalu diterjemahkan menjadi penghapusan baris.
    status: z.enum([...FILLED_WIRE_STATUSES, UNFILLED_WIRE_STATUS]),
    note: z.string().optional(),
  })),
})

export async function GET(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const user = await requireUser()
    const access = await getClassAccess(user)
    const dateParam = new URL(request.url).searchParams.get("date")
    const schoolDate = dateParam === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(dateParam)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
    const date = toPrismaDate(schoolDate)
    const classes = await prisma.schoolClass.findMany({
      where: access.where,
      include: { students: { where: { active: true }, orderBy: { name: "asc" } }, homeroomUser: { select: { id: true, name: true } }, attendanceDays: { where: { date }, include: { attendances: true, submittedBy: { select: { id: true, name: true } } } } },
      orderBy: { name: "asc" },
    })
    const holiday = await prisma.schoolHoliday.findUnique({ where: { date }, select: { id: true, name: true } })
    const serializedClasses = sortClasses(classes).map((schoolClass) => ({
      ...schoolClass,
      attendanceDays: schoolClass.attendanceDays.map((day) => ({ ...day, date: fromPrismaDate(day.date) })),
    }))
    return NextResponse.json({ classes: serializedClasses, holiday })
  } catch { return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 }) }
}

export async function POST(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const user = await requireUser()
    const access = await getClassAccess(user)
    const body = attendanceInput.parse(await request.json())
    const cls = await prisma.schoolClass.findUnique({ where: { id: body.classId } })
    if (!cls || !canAccessClass(access, cls, user.id)) return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
    const studentIds = body.records.map((record) => record.studentId)
    if (new Set(studentIds).size !== studentIds.length) return NextResponse.json({ error: "Data siswa duplikat" }, { status: 400 })
    const validStudents = await prisma.student.count({ where: { id: { in: studentIds }, classId: body.classId, active: true } })
    if (validStudents !== studentIds.length) return NextResponse.json({ error: "Terdapat siswa yang tidak terdaftar di kelas ini" }, { status: 400 })
    const schoolDate = parseSchoolDate(body.date)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal absensi tidak valid" }, { status: 400 })
    const date = toPrismaDate(schoolDate)
    if (schoolDate > todayInSchoolTimeZone(undefined, timeZone)) return NextResponse.json({ error: "Tanggal absensi tidak boleh di masa depan" }, { status: 400 })
    const holiday = await prisma.schoolHoliday.findUnique({ where: { date }, select: { name: true } })
    if (holiday) return NextResponse.json({ error: `Tanggal ini ditandai sebagai hari libur: ${holiday.name}` }, { status: 400 })
    const plan = planAttendanceWrite(body.records)
    await prisma.$transaction(async (tx) => {
      const day = await tx.attendanceDay.upsert({ where: { classId_date: { classId: body.classId, date } }, update: { submittedById: user.id }, create: { classId: body.classId, date, submittedById: user.id } })
      for (const r of plan.upserts) await tx.attendance.upsert({ where: { attendanceDayId_studentId: { attendanceDayId: day.id, studentId: r.studentId } }, update: { status: r.status, note: r.note }, create: { attendanceDayId: day.id, studentId: r.studentId, status: r.status, note: r.note } })
      // Siswa yang dikosongkan kembali menjadi "belum diisi" = barisnya dihapus.
      if (plan.clears.length > 0) await tx.attendance.deleteMany({ where: { attendanceDayId: day.id, studentId: { in: plan.clears } } })
    })
    return NextResponse.json({ ok: true, submittedAt: new Date().toISOString(), submittedBy: { id: user.id, name: user.name ?? "Guru" } })
  } catch { return NextResponse.json({ error: "Gagal menyimpan absensi" }, { status: 400 }) }
}
