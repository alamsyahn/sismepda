import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { fromPrismaDate, parseSchoolDate, toPrismaDate } from "@/lib/school-date"

/** Every field is optional — the dialog may change only one of them. */
const payload = z.object({
  studentId: z.string().min(1).optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  complaint: z.string().trim().min(2).max(500).optional(),
  treatment: z.string().trim().min(2).max(500).optional(),
  followUp: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
})

const visitSelect = {
  id: true,
  studentId: true,
  occurredAt: true,
  complaint: true,
  treatment: true,
  followUp: true,
  student: { select: { name: true, schoolClass: { select: { name: true } } } },
} as const

/** Edit one recorded visit. Requires euks.edit. */
export async function PATCH(request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.visits.update")
    const { visitId } = await params
    const body = payload.parse(await request.json())

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const visit = await prisma.euksVisit.findUnique({ where: { id: visitId }, select: visitSelect })
    if (!visit) return NextResponse.json({ error: "Kunjungan tidak ditemukan" }, { status: 404 })

    let occurredAt: Date | undefined
    if (body.occurredAt !== undefined) {
      const parsed = parseSchoolDate(body.occurredAt)
      if (!parsed) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
      occurredAt = toPrismaDate(parsed)
    }

    let studentName = visit.student.name
    let className = visit.student.schoolClass.name
    if (body.studentId !== undefined && body.studentId !== visit.studentId) {
      const student = await prisma.student.findUnique({
        where: { id: body.studentId },
        select: { id: true, name: true, active: true, schoolClass: { select: { name: true } } },
      })
      if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 })
      if (!student.active) {
        return NextResponse.json({ error: "Siswa sudah tidak aktif" }, { status: 400 })
      }
      studentName = student.name
      className = student.schoolClass.name
    }

    await prisma.$transaction(async (tx) => {
      await tx.euksVisit.update({
        where: { id: visit.id },
        data: {
          ...(body.studentId === undefined ? {} : { studentId: body.studentId }),
          ...(occurredAt === undefined ? {} : { occurredAt }),
          ...(body.complaint === undefined ? {} : { complaint: body.complaint }),
          ...(body.treatment === undefined ? {} : { treatment: body.treatment }),
          ...(body.followUp === undefined ? {} : { followUp: body.followUp }),
          recordedById: viewer.id,
        },
      })

      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_VISIT_UPDATED",
          entity: "EuksVisit",
          entityId: visit.id,
          summary: `Kunjungan UKS ${studentName} (${className}) diperbarui`,
          before: {
            student: visit.student.name,
            className: visit.student.schoolClass.name,
            occurredAt: fromPrismaDate(visit.occurredAt),
            complaint: visit.complaint,
            treatment: visit.treatment,
            followUp: visit.followUp,
          },
          after: {
            student: studentName,
            className,
            occurredAt: body.occurredAt ?? fromPrismaDate(visit.occurredAt),
            complaint: body.complaint ?? visit.complaint,
            treatment: body.treatment ?? visit.treatment,
            followUp: body.followUp === undefined ? visit.followUp : body.followUp,
          },
        },
        tx,
      )
    })

    return NextResponse.json({ id: visit.id })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Remove one recorded visit. Requires euks.edit. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.visits.delete")
    const { visitId } = await params

    const visit = await prisma.euksVisit.findUnique({ where: { id: visitId }, select: visitSelect })
    if (!visit) return NextResponse.json({ error: "Kunjungan tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksVisit.delete({ where: { id: visit.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_VISIT_DELETED",
          entity: "EuksVisit",
          entityId: visit.id,
          summary: `Kunjungan UKS ${visit.student.name} (${visit.student.schoolClass.name}) dihapus`,
          before: {
            student: visit.student.name,
            className: visit.student.schoolClass.name,
            occurredAt: fromPrismaDate(visit.occurredAt),
            complaint: visit.complaint,
            treatment: visit.treatment,
            followUp: visit.followUp,
          },
        },
        tx,
      )
    })

    return NextResponse.json({ id: visit.id })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
