import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"

/** Remove one measurement. Requires euks.edit. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ measurementId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.edit")
    const { measurementId } = await params

    const existing = await prisma.studentHealthMeasurement.findUnique({
      where: { id: measurementId },
      select: {
        id: true,
        measuredAt: true,
        heightCm: true,
        weightKg: true,
        student: { select: { name: true, schoolClass: { select: { name: true } } } },
      },
    })
    if (!existing) return NextResponse.json({ error: "Pengukuran tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.studentHealthMeasurement.delete({ where: { id: measurementId } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_MEASUREMENT_DELETED",
          entity: "StudentHealthMeasurement",
          entityId: measurementId,
          summary: `Pengukuran ${existing.student.name} (${existing.student.schoolClass.name}) dihapus`,
          before: {
            student: existing.student.name,
            className: existing.student.schoolClass.name,
            heightCm: Number(existing.heightCm),
            weightKg: Number(existing.weightKg),
          },
        },
        tx,
      )
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
