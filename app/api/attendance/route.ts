import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { fromPrismaDate, parseSchoolDate, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { sortClasses } from "@/lib/class-order"
import { classInScope, requireClassScopeFor } from "@/lib/rbac-class-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { requireUser } from "@/lib/rbac-access"
import { FILLED_WIRE_STATUSES, UNFILLED_WIRE_STATUS, planAttendanceWrite } from "@/lib/attendance-save"
import { readHolidayFor } from "@/lib/server-holidays"

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
    // Scope BACA. Tidak pernah meminjam scope operasi tulis.
    const scope = await requireClassScopeFor("attendance", "read")
    const dateParam = new URL(request.url).searchParams.get("date")
    const schoolDate = dateParam === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(dateParam)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
    const date = toPrismaDate(schoolDate)
    const classes = await prisma.schoolClass.findMany({
      where: scope.where,
      include: { students: { where: { active: true }, orderBy: { name: "asc" } }, homeroomUser: { select: { id: true, name: true } }, attendanceDays: { where: { date }, include: { attendances: true, submittedBy: { select: { id: true, name: true } } } } },
      orderBy: { name: "asc" },
    })
    const holiday = await readHolidayFor(fromPrismaDate(date))
    const serializedClasses = sortClasses(classes).map((schoolClass) => ({
      ...schoolClass,
      attendanceDays: schoolClass.attendanceDays.map((day) => ({ ...day, date: fromPrismaDate(day.date) })),
    }))
    return NextResponse.json({ classes: serializedClasses, holiday })
  } catch (error) {
    return authFailureResponse(error, "Data absensi gagal dimuat")
  }
}

export async function POST(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    // Scope TULIS, diselesaikan terpisah dari read: punya attendance.read.all
    // tidak membuat seseorang boleh menulis di luar kelas binaannya.
    const scope = await requireClassScopeFor("attendance", "write")
    const user = await requireUser()

    let body: z.infer<typeof attendanceInput>
    try {
      body = attendanceInput.parse(await request.json())
    } catch {
      throw new ApiError(400, "Data absensi tidak valid")
    }

    // Relasi kelas selalu dibaca dari database; classId pada body tidak pernah
    // dipercaya sebagai bukti kewenangan.
    const cls = await prisma.schoolClass.findUnique({
      where: { id: body.classId },
      select: { id: true, homeroomUserId: true },
    })
    if (!cls) throw new ApiError(404, "Kelas tidak ditemukan")
    if (!classInScope(scope, cls)) throw new ApiError(403, "Tidak diizinkan")

    const studentIds = body.records.map((record) => record.studentId)
    if (new Set(studentIds).size !== studentIds.length) throw new ApiError(400, "Data siswa duplikat")
    const validStudents = await prisma.student.count({ where: { id: { in: studentIds }, classId: body.classId, active: true } })
    if (validStudents !== studentIds.length) throw new ApiError(400, "Terdapat siswa yang tidak terdaftar di kelas ini")
    const schoolDate = parseSchoolDate(body.date)
    if (!schoolDate) throw new ApiError(400, "Tanggal absensi tidak valid")
    const date = toPrismaDate(schoolDate)
    if (schoolDate > todayInSchoolTimeZone(undefined, timeZone)) throw new ApiError(400, "Tanggal absensi tidak boleh di masa depan")
    const holiday = await readHolidayFor(fromPrismaDate(date))
    if (holiday) throw new ApiError(400, `Tanggal ini ditandai sebagai hari libur: ${holiday.name}`)

    const plan = planAttendanceWrite(body.records)
    await prisma.$transaction(async (tx) => {
      const day = await tx.attendanceDay.upsert({ where: { classId_date: { classId: body.classId, date } }, update: { submittedById: user.id }, create: { classId: body.classId, date, submittedById: user.id } })
      for (const r of plan.upserts) await tx.attendance.upsert({ where: { attendanceDayId_studentId: { attendanceDayId: day.id, studentId: r.studentId } }, update: { status: r.status, note: r.note }, create: { attendanceDayId: day.id, studentId: r.studentId, status: r.status, note: r.note } })
      // Siswa yang dikosongkan kembali menjadi "belum diisi" = barisnya dihapus.
      if (plan.clears.length > 0) await tx.attendance.deleteMany({ where: { attendanceDayId: day.id, studentId: { in: plan.clears } } })
    })
    return NextResponse.json({ ok: true, submittedAt: new Date().toISOString(), submittedBy: { id: user.id, name: user.name ?? "Guru" } })
  } catch (error) {
    return authFailureResponse(error, "Gagal menyimpan absensi")
  }
}
