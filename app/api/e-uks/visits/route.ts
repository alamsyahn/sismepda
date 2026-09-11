import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"

const payload = z.object({
  studentId: z.string().min(1),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  complaint: z.string().trim().min(2).max(500),
  treatment: z.string().trim().min(2).max(500),
  followUp: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
})

/** Record one UKS visit. Requires euks.edit. */
export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.edit")
    const body = payload.parse(await request.json())

    const schoolDate = parseSchoolDate(body.occurredAt)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })

    const student = await prisma.student.findUnique({
      where: { id: body.studentId },
      select: { id: true, name: true, active: true, schoolClass: { select: { name: true } } },
    })
    if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 })
    if (!student.active) {
      return NextResponse.json({ error: "Siswa sudah tidak aktif" }, { status: 400 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const visit = await tx.euksVisit.create({
        data: {
          studentId: student.id,
          occurredAt: toPrismaDate(schoolDate),
          complaint: body.complaint,
          treatment: body.treatment,
          followUp: body.followUp,
          recordedById: viewer.id,
        },
        select: { id: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_VISIT_CREATED",
          entity: "EuksVisit",
          entityId: visit.id,
          summary: `Kunjungan UKS ${student.name} (${student.schoolClass.name}) pada ${body.occurredAt} dicatat`,
          after: {
            student: student.name,
            className: student.schoolClass.name,
            occurredAt: body.occurredAt,
            complaint: body.complaint,
            treatment: body.treatment,
            followUp: body.followUp,
          },
        },
        tx,
      )
      return visit
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
