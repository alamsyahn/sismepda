import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import {
  assignBosBundle,
  BosBundleAssignmentError,
  type BosBundleStore,
} from "@/lib/bos-access-service"

const payload = z.object({
  userId: z.string().min(1),
  bundleKey: z.string().min(1),
  assigned: z.boolean(),
}).strict()

/** Fixed BOS-bundle delegation. This is not a generic role-assignment API. */
export async function PATCH(request: Request) {
  try {
    const actor = await requirePermission("bos.access.manage")
    const body = payload.parse(await request.json())

    const result = await prisma.$transaction(async (tx) => {
      const store: BosBundleStore = {
        findBundleRole: async (key) => {
          const role = await tx.role.findUnique({
            where: { key },
            select: {
              id: true,
              key: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          })
          return role ? {
            id: role.id,
            key: role.key,
            permissionKeys: role.permissions.map((entry) => entry.permission.key),
          } : null
        },
        findTarget: async (userId) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              rbacRoles: { where: { role: { isProtected: true } }, select: { roleId: true }, take: 1 },
            },
          })
          return user ? { id: user.id, hasProtectedRole: user.rbacRoles.length > 0 } : null
        },
        hasMembership: async (userId, roleId) => Boolean(await tx.userRole.findUnique({
          where: { userId_roleId: { userId, roleId } },
          select: { userId: true },
        })),
        createMembership: async (userId, roleId) => {
          await tx.userRole.create({ data: { userId, roleId } })
        },
        deleteMembership: async (userId, roleId) => {
          await tx.userRole.delete({ where: { userId_roleId: { userId, roleId } } })
        },
      }

      const updated = await assignBosBundle(store, body)
      await recordAuditLog({
        actorId: actor.user.id,
        action: "BOS_ACCESS_CHANGED",
        entity: "User",
        entityId: `${updated.userId}:${updated.bundleKey}`,
        targetUserId: updated.userId,
        summary: `Bundle ${updated.bundleKey} ${updated.assigned ? "diberikan" : "dicabut"}`,
        after: updated,
      }, tx)
      return updated
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Payload akses BOS tidak valid" }, { status: 400 })
    }
    if (error instanceof BosBundleAssignmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return authFailureResponse(error, "Akses BOS gagal disimpan")
  }
}
