import type { Prisma } from "@/app/generated/prisma/client"
import { ApiError } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { prisma } from "@/lib/prisma"
import type { CurrentUser } from "@/lib/rbac-access"
import type { ClassScope } from "@/lib/rbac-class-access"
import { fromPrismaDate, toPrismaDate, type SchoolDate } from "@/lib/school-date"
import type { worshipEditInput } from "@/lib/worship-attendance"
import type { z } from "zod"

async function lockWorshipAttendance(tx: Prisma.TransactionClient, studentId: string, date: Date) {
  const key = `worship:${studentId}:${fromPrismaDate(date)}`
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`
}

export async function recordWorshipScan(
  tx: Prisma.TransactionClient,
  student: { id: string; classId: string },
  date: Date,
  scannedAt: Date,
) {
  await lockWorshipAttendance(tx, student.id, date)
  const key = { studentId: student.id, date }
  const current = await tx.worshipAttendance.findUnique({ where: { studentId_date: key } })
  if (current?.status === "IKUT") {
    return { outcome: "WORSHIP_REPEAT", firstSeenAt: current.firstScannedAt }
  }

  await tx.worshipAttendance.upsert({
    where: { studentId_date: key },
    create: { ...key, classId: student.classId, status: "IKUT", firstScannedAt: scannedAt },
    update: {
      status: "IKUT",
      firstScannedAt: scannedAt,
      manualReason: null,
      manualByName: null,
      revision: { increment: 1 },
    },
  })
  return { outcome: "WORSHIP_PRESENT", firstSeenAt: scannedAt }
}

export async function readWorshipRows(db: typeof prisma, classId: string, schoolDate: SchoolDate) {
  const date = toPrismaDate(schoolDate)
  const [school, worship] = await Promise.all([
    db.attendance.findMany({
      where: { attendanceDay: { classId, date } },
      select: { studentId: true, status: true },
    }),
    db.worshipAttendance.findMany({
      where: { classId, date },
      select: {
        studentId: true, status: true, firstScannedAt: true, manualReason: true,
        manualByName: true, updatedAt: true, revision: true,
      },
    }),
  ])
  const students = await db.student.findMany({
    where: {
      OR: [
        { classId, active: true },
        { id: { in: [...school.map((row) => row.studentId), ...worship.map((row) => row.studentId)] } },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, nis: true },
  })
  const schoolByStudent = new Map(school.map((row) => [row.studentId, row.status]))
  const worshipByStudent = new Map(worship.map((row) => [row.studentId, row]))
  return students.map((student) => ({
    ...student,
    schoolStatus: schoolByStudent.get(student.id) ?? null,
    worship: worshipByStudent.get(student.id) ?? null,
  }))
}

export async function editWorshipAttendance(
  db: typeof prisma,
  scope: ClassScope,
  actor: CurrentUser,
  input: z.infer<typeof worshipEditInput>,
  date: Date,
) {
  await db.$transaction(async (tx) => {
    await lockWorshipAttendance(tx, input.studentId, date)
    const schoolClass = await tx.schoolClass.findFirst({
      where: { id: input.classId, ...scope.where },
      select: { id: true },
    })
    if (!schoolClass) throw new ApiError(404, "Kelas tidak dapat diakses")

    const student = await tx.student.findFirst({
      where: {
        id: input.studentId,
        OR: [
          { classId: schoolClass.id, active: true },
          { attendances: { some: { attendanceDay: { classId: schoolClass.id, date } } } },
          { worshipAttendances: { some: { classId: schoolClass.id, date } } },
        ],
      },
      select: { id: true },
    })
    if (!student) throw new ApiError(404, "Siswa tidak terdaftar di rekap kelas ini")
    const key = { studentId: input.studentId, date }
    const current = await tx.worshipAttendance.findUnique({ where: { studentId_date: key } })
    if (current && current.classId !== schoolClass.id) {
      throw new ApiError(409, "Catatan Zuhur siswa ini tersimpan di kelas lain.")
    }
    if ((current?.revision ?? 0) !== input.revision) {
      throw new ApiError(409, "Catatan sudah berubah. Periksa data terbaru sebelum mengoreksi.")
    }
    if (!current && input.status === "BELUM") return

    const values = {
      status: input.status,
      firstScannedAt: input.status === "IKUT" ? current?.firstScannedAt ?? null : null,
      manualReason: input.reason,
      manualByName: actor.name,
    }
    const saved = await tx.worshipAttendance.upsert({
      where: { studentId_date: key },
      create: { ...key, ...values, classId: schoolClass.id },
      update: { ...values, revision: { increment: 1 } },
    })
    await recordAuditLog({
      actorId: actor.id,
      action: "WORSHIP_ATTENDANCE_CORRECTED",
      entity: "WorshipAttendance",
      entityId: `${student.id}:${input.date}`,
      summary: input.reason,
      before: current ? {
        status: current.status, firstScannedAt: current.firstScannedAt?.toISOString() ?? null,
        manualByName: current.manualByName, reason: current.manualReason,
      } : null,
      after: { classId: schoolClass.id, status: saved.status, actorName: actor.name },
    }, tx)
  })
}
