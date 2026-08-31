import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { bosErrorResponse, requireBosPermission } from "@/lib/bos-access"

const payload = z.object({
  userId: z.string().min(1),
  canViewBos: z.boolean().optional(),
  canCreateBos: z.boolean().optional(),
  canEditBos: z.boolean().optional(),
  canManageBosCategories: z.boolean().optional(),
  canManageBosAccess: z.boolean().optional(),
})

const rightsSelect = {
  canViewBos: true,
  canCreateBos: true,
  canEditBos: true,
  canManageBosCategories: true,
  canManageBosAccess: true,
} as const

/** Grant or revoke BOS rights for one user. Requires bos.manage_access. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireBosPermission("bos.manage_access")
    const body = payload.parse(await request.json())

    const target = await prisma.user.findFirst({
      where: { id: body.userId, role: { in: ["ADMIN", "GURU"] } },
      select: { id: true, name: true, role: true, ...rightsSelect },
    })
    if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 })

    const data = {
      ...(body.canViewBos !== undefined ? { canViewBos: body.canViewBos } : {}),
      ...(body.canCreateBos !== undefined ? { canCreateBos: body.canCreateBos } : {}),
      ...(body.canEditBos !== undefined ? { canEditBos: body.canEditBos } : {}),
      ...(body.canManageBosCategories !== undefined
        ? { canManageBosCategories: body.canManageBosCategories }
        : {}),
      ...(body.canManageBosAccess !== undefined
        ? { canManageBosAccess: body.canManageBosAccess }
        : {}),
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: target.id },
        data,
        select: { id: true, ...rightsSelect },
      })

      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "BOS_ACCESS_CHANGED",
          entity: "User",
          entityId: target.id,
          targetUserId: target.id,
          summary: `Akses BOS ${target.name} diperbarui`,
          before: {
            canViewBos: target.canViewBos,
            canCreateBos: target.canCreateBos,
            canEditBos: target.canEditBos,
            canManageBosCategories: target.canManageBosCategories,
            canManageBosAccess: target.canManageBosAccess,
          },
          after: {
            canViewBos: result.canViewBos,
            canCreateBos: result.canCreateBos,
            canEditBos: result.canEditBos,
            canManageBosCategories: result.canManageBosCategories,
            canManageBosAccess: result.canManageBosAccess,
          },
        },
        tx,
      )

      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = bosErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
