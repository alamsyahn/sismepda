import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requireSarprasAccessManager, sarprasErrorResponse } from "@/lib/sarpras-access"

const payload = z.object({
  userId: z.string().min(1),
  canViewSarpras: z.boolean().optional(),
  canEditSarpras: z.boolean().optional(),
})

const rightsSelect = { canViewSarpras: true, canEditSarpras: true } as const

/** Grant or revoke Sarpras rights for one user. ADMIN only. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireSarprasAccessManager()
    const body = payload.parse(await request.json())

    const target = await prisma.user.findFirst({
      where: { id: body.userId, role: { in: ["ADMIN", "GURU"] } },
      select: { id: true, name: true, role: true, ...rightsSelect },
    })
    if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 })

    const data = {
      ...(body.canViewSarpras !== undefined ? { canViewSarpras: body.canViewSarpras } : {}),
      ...(body.canEditSarpras !== undefined ? { canEditSarpras: body.canEditSarpras } : {}),
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
          action: "SARPRAS_ACCESS_CHANGED",
          entity: "User",
          entityId: target.id,
          targetUserId: target.id,
          summary: `Akses Sarpras ${target.name} diperbarui`,
          before: { canViewSarpras: target.canViewSarpras, canEditSarpras: target.canEditSarpras },
          after: { canViewSarpras: result.canViewSarpras, canEditSarpras: result.canEditSarpras },
        },
        tx,
      )
      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = sarprasErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
