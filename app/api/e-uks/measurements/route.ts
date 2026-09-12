import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"

const payload = z.object({
  studentId: z.string().min(1),
  measuredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  heightCm: z.number().positive().max(250),
  weightKg: z.number().positive().max(300),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
})

/** Record one height/weight measurement. Requires euks.edit. */
export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.measurements.create")
    const body = payload.parse(await request.json())

    const schoolDate = parseSchoolDate(body.measuredAt)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })

    const student = await prisma.student.findUnique({
      where: { id: body.studentId },
      select: { id: true, name: true, active: true, schoolClass: { select: { name: true } } },
    })
    if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 })
    if (!student.active) {
      return NextResponse.json({ error: "Siswa sudah tidak aktif" }, { status: 400 })
    }

    const existing = await prisma.studentHealthMeasurement.findUnique({
      where: { studentId_measuredAt: { studentId: student.id, measuredAt: toPrismaDate(schoolDate) } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: "Pengukuran pada tanggal ini sudah ada" }, { status: 409 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const measurement = await tx.studentHealthMeasurement.create({
        data: {
          studentId: student.id,
          measuredAt: toPrismaDate(schoolDate),
          heightCm: body.heightCm,
          weightKg: body.weightKg,
          note: body.note,
          recordedById: viewer.id,
        },
        select: { id: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_MEASUREMENT_CREATED",
          entity: "StudentHealthMeasurement",
          entityId: measurement.id,
          summary: `Pengukuran ${student.name} (${student.schoolClass.name}) pada ${body.measuredAt} dicatat`,
          after: {
            student: student.name,
            className: student.schoolClass.name,
            measuredAt: body.measuredAt,
            heightCm: body.heightCm,
            weightKg: body.weightKg,
            note: body.note,
          },
        },
        tx,
      )
      return measurement
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
