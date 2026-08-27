import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth-guards"
import { recordAuditLog } from "@/lib/audit-log"

const payload = z.object({
  teacherId: z.string().min(1),
  workbookSupervised: z.boolean().optional(),
  canSuperviseWorkbooks: z.boolean().optional(),
  canViewWorkbookSupervision: z.boolean().optional(),
})

/** Only administrators manage who is supervised and who may supervise. */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin()
    const body = payload.parse(await request.json())

    const teacher = await prisma.user.findFirst({
      where: { id: body.teacherId, role: { in: ["ADMIN", "GURU"] } },
      select: {
        id: true,
        name: true,
        workbookSupervised: true,
        canSuperviseWorkbooks: true,
        canViewWorkbookSupervision: true,
      },
    })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    const data = {
      ...(body.workbookSupervised !== undefined ? { workbookSupervised: body.workbookSupervised } : {}),
      ...(body.canSuperviseWorkbooks !== undefined ? { canSuperviseWorkbooks: body.canSuperviseWorkbooks } : {}),
      ...(body.canViewWorkbookSupervision !== undefined
        ? { canViewWorkbookSupervision: body.canViewWorkbookSupervision }
        : {}),
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: teacher.id },
        data,
        select: {
          id: true,
          workbookSupervised: true,
          canSuperviseWorkbooks: true,
          canViewWorkbookSupervision: true,
        },
      })

      await recordAuditLog(
        {
          actorId: admin.id,
          action: "WORKBOOK_SUPERVISION_SCOPE_CHANGED",
          entity: "User",
          entityId: teacher.id,
          targetUserId: teacher.id,
          summary: `Pengaturan supervisi ${teacher.name} diperbarui`,
          before: {
            workbookSupervised: teacher.workbookSupervised,
            canSuperviseWorkbooks: teacher.canSuperviseWorkbooks,
            canViewWorkbookSupervision: teacher.canViewWorkbookSupervision,
          },
          after: {
            workbookSupervised: result.workbookSupervised,
            canSuperviseWorkbooks: result.canSuperviseWorkbooks,
            canViewWorkbookSupervision: result.canViewWorkbookSupervision,
          },
        },
        tx,
      )

      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Hanya administrator yang dapat mengubah pengaturan ini" }, { status: 403 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data pengaturan tidak valid" }, { status: 400 })
    }
    return NextResponse.json({ error: "Pengaturan supervisi gagal disimpan" }, { status: 500 })
  }
}
