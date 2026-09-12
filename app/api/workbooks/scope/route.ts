import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requirePermission, requireUser } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { teacherPopulationWhere } from "@/lib/teacher-population"
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
    await requirePermission("workbook.scope.manage")
    const admin = await requireUser()
    const body = payload.parse(await request.json())

    const teacher = await prisma.user.findFirst({
      where: { id: body.teacherId, ...teacherPopulationWhere() },
      select: {
        id: true,
        name: true,
        workbookSupervised: true,
        canSuperviseWorkbooks: true,
        canViewWorkbookSupervision: true,
      },
    })
    if (!teacher) throw new ApiError(404, "Guru tidak ditemukan")

    const data = {
      ...(body.workbookSupervised !== undefined ? { workbookSupervised: body.workbookSupervised } : {}),
      ...(body.canSuperviseWorkbooks !== undefined ? { canSuperviseWorkbooks: body.canSuperviseWorkbooks } : {}),
      ...(body.canViewWorkbookSupervision !== undefined
        ? { canViewWorkbookSupervision: body.canViewWorkbookSupervision }
        : {}),
    }
    if (Object.keys(data).length === 0) throw new ApiError(400, "Tidak ada perubahan yang dikirim")

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
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data pengaturan tidak valid" }, { status: 400 })
    }
    return authFailureResponse(error, "Pengaturan supervisi gagal disimpan")
  }
}
