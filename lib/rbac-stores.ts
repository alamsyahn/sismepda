/**
 * Adapter Prisma untuk service RBAC.
 *
 * Service (`lib/rbac-role-service.ts`, `lib/rbac-assignment-service.ts`) sengaja
 * tidak mengenal Prisma sehingga aturannya dapat diuji tanpa database. Modul ini
 * satu-satunya tempat pemetaan store → Prisma, supaya route handler tidak
 * mengulang query yang sama dan tidak ada dua versi pemetaan yang menyimpang.
 *
 * Seluruh store dibangun DARI CLIENT TRANSAKSI. Penulisan audit ikut memakai
 * client yang sama, sehingga baris audit dan perubahan yang dijelaskannya
 * commit atau rollback bersama-sama.
 */

import { recordAuditLog } from "@/lib/audit-log"
import { redactAuditPayload, type AuditPayload } from "@/lib/rbac-audit"
import type { TransactionClient } from "@/lib/rbac-invariants-db"
import type { AssignmentStore } from "@/lib/rbac-assignment-service"
import type { RoleStore } from "@/lib/rbac-role-service"
import { SYSTEM_ADMIN_ROLE_KEY } from "@/lib/rbac-permissions"
import type { Prisma } from "@/app/generated/prisma/client"

const roleSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  isProtected: true,
  version: true,
  permissions: { select: { permission: { select: { key: true } } } },
  users: { select: { userId: true } },
} as const

type RoleRow = {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  isProtected: boolean
  version: number
  permissions: { permission: { key: string } }[]
  users: { userId: string }[]
}

function toRoleRecord(role: RoleRow) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isProtected: role.isProtected,
    version: role.version,
    permissionKeys: role.permissions.map((entry) => entry.permission.key),
    memberIds: role.users.map((entry) => entry.userId),
  }
}

/** Menyiapkan payload audit: diredaksi lebih dulu, lalu disesuaikan tipe Prisma. */
function auditJson(payload: unknown): Prisma.InputJsonValue | null {
  if (payload === undefined || payload === null) return null
  return redactAuditPayload(payload as AuditPayload) as Prisma.InputJsonValue
}

/**
 * Menukar daftar key permission menjadi id baris, menolak key yang tidak ada di
 * tabel. Service sudah memvalidasi terhadap registry; ini menangkap registry
 * yang belum tersinkron ke database.
 */
async function resolvePermissionIds(
  tx: TransactionClient,
  keys: readonly string[],
): Promise<string[]> {
  if (keys.length === 0) return []
  const rows = await tx.permission.findMany({
    where: { key: { in: [...keys] } },
    select: { id: true, key: true },
  })
  if (rows.length !== new Set(keys).size) {
    const found = new Set(rows.map((row) => row.key))
    const missing = [...new Set(keys)].filter((key) => !found.has(key))
    throw new Error(`Permission belum tersedia di database: ${missing.join(", ")}`)
  }
  return rows.map((row) => row.id)
}

export function createRoleStore(tx: TransactionClient, actorId: string): RoleStore {
  return {
    findRoleById: async (id) => {
      const role = await tx.role.findUnique({ where: { id }, select: roleSelect })
      return role ? toRoleRecord(role) : null
    },
    findRoleByKey: async (key) => {
      const role = await tx.role.findUnique({ where: { key }, select: roleSelect })
      return role ? toRoleRecord(role) : null
    },
    createRole: async (data) => {
      const permissionIds = await resolvePermissionIds(tx, data.permissionKeys)
      const role = await tx.role.create({
        data: {
          key: data.key,
          name: data.name,
          description: data.description,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
        select: roleSelect,
      })
      return toRoleRecord(role)
    },
    updateRole: async (id, data) => {
      if (data.permissionKeys !== undefined) {
        const permissionIds = await resolvePermissionIds(tx, data.permissionKeys)
        // Ganti seluruh himpunan: selisih dihitung service, dan penulisan ulang
        // menyeluruh menghindari baris yatim bila dua permintaan bersilangan.
        await tx.rolePermission.deleteMany({ where: { roleId: id } })
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          })
        }
      }

      const role = await tx.role.update({
        where: { id },
        data: {
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.description === undefined ? {} : { description: data.description }),
          // Setiap mutasi menaikkan versi; inilah yang membuat penulisan basi
          // tertolak 409 pada percobaan berikutnya.
          version: { increment: 1 },
        },
        select: roleSelect,
      })
      return toRoleRecord(role)
    },
    deleteRole: async (id) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } })
      await tx.role.delete({ where: { id } })
    },
    removeAllMembers: async (id) => {
      const result = await tx.userRole.deleteMany({ where: { roleId: id } })
      return result.count
    },
    recordAudit: async (entry) => {
      await recordAuditLog(
        {
          actorId,
          action: entry.action,
          entity: "RbacRole",
          entityId: entry.entityId,
          summary: entry.summary,
          before: auditJson(entry.before),
          after: auditJson(entry.after),
        },
        tx,
      )
    },
  }
}

export function createAssignmentStore(tx: TransactionClient, actorId: string): AssignmentStore {
  return {
    findUser: async (id) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, name: true, active: true, rbacRoles: { select: { roleId: true } } },
      })
      return user
        ? {
            id: user.id,
            name: user.name,
            active: user.active,
            roleIds: user.rbacRoles.map((entry) => entry.roleId),
          }
        : null
    },
    findRoles: async (ids) => {
      if (ids.length === 0) return []
      const roles = await tx.role.findMany({
        where: { id: { in: [...ids] } },
        select: {
          id: true,
          key: true,
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      })
      return roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        permissionKeys: role.permissions.map((entry) => entry.permission.key),
      }))
    },
    replaceRoles: async (userId, roleIds) => {
      await tx.userRole.deleteMany({ where: { userId } })
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId, roleId })),
        })
      }
    },
    countOtherActiveSystemAdmins: async (excludeUserId) =>
      tx.user.count({
        where: {
          active: true,
          id: { not: excludeUserId },
          rbacRoles: { some: { role: { key: SYSTEM_ADMIN_ROLE_KEY } } },
        },
      }),
    recordAudit: async (entry) => {
      await recordAuditLog(
        {
          actorId,
          action: entry.action,
          entity: "RbacUserRole",
          entityId: entry.entityId,
          targetUserId: entry.targetUserId,
          summary: entry.summary,
          before: auditJson(entry.before),
          after: auditJson(entry.after),
        },
        tx,
      )
    },
  }
}
