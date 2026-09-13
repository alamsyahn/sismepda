/**
 * Data baca untuk halaman administrasi RBAC.
 *
 * SERVER-ONLY — mengimpor `lib/prisma.ts`. Komponen klien hanya boleh
 * mengimpor TIPE dari berkas ini (`import type`), tidak pernah nilainya,
 * karena itu menarik `pg` ke bundel browser dan mematahkan `next build`.
 */
import { prisma } from "@/lib/prisma"
import { PERMISSIONS, SYSTEM_ADMIN_ROLE_KEY } from "@/lib/rbac-permissions"
import { computeAssignmentRevision } from "@/lib/rbac-assignment-service"
import { RBAC_AUDIT_ENTITIES } from "@/lib/rbac-audit"

export type RoleRow = {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly description: string | null
  readonly isSystem: boolean
  readonly isProtected: boolean
  readonly memberCount: number
  readonly permissionKeys: string[]
  readonly version: number
  /**
   * Role bypass. Ditentukan dari KEY, tidak pernah dari nama tampilan — role
   * kustom bernama "Admin Sistem" tidak punya kuasa apa pun.
   */
  readonly isSystemAdmin: boolean
}

export type AccountRow = {
  readonly id: string
  readonly name: string
  readonly nip: string | null
  readonly email: string | null
  readonly active: boolean
  readonly isTeacher: boolean
  readonly roles: { id: string; name: string; isSystemAdmin: boolean }[]
  /**
   * Sidik jari himpunan role saat dibaca. Dihitung di SERVER: penghitungnya
   * memakai `node:crypto`, yang tidak tersedia di browser. Klien mengirimkannya
   * kembali sebagai `expectedRevision` sehingga penulisan di atas data basi
   * ditolak alih-alih menimpa diam-diam.
   */
  readonly revision: string
}

export type PermissionRow = {
  readonly key: string
  readonly label: string
  readonly module: string
  readonly sensitive: boolean
}

export type RbacAuditRow = {
  readonly id: string
  readonly action: string
  readonly entity: string
  readonly summary: string | null
  readonly targetUserId: string | null
  readonly targetUserName: string | null
  readonly actorName: string
  readonly createdAt: Date
}

export async function readRoles(): Promise<RoleRow[]> {
  const roles = await prisma.role.findMany({
    orderBy: [{ isProtected: "desc" }, { name: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      isSystem: true,
      isProtected: true,
      version: true,
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { users: true } },
    },
  })

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isProtected: role.isProtected,
    version: role.version,
    memberCount: role._count.users,
    permissionKeys: role.permissions.map((entry) => entry.permission.key),
    isSystemAdmin: role.key === SYSTEM_ADMIN_ROLE_KEY,
  }))
}

export async function readRbacAudit(limit = 100): Promise<RbacAuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entity: { in: [...RBAC_AUDIT_ENTITIES] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(Math.trunc(limit), 1), 100),
    select: {
      id: true,
      action: true,
      entity: true,
      summary: true,
      targetUserId: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  })
  const targetIds = [...new Set(rows.map((row) => row.targetUserId).filter((id): id is string => Boolean(id)))]
  const targets = targetIds.length
    ? await prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } })
    : []
  const targetById = new Map(targets.map((target) => [target.id, target.name]))

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    summary: row.summary,
    targetUserId: row.targetUserId,
    targetUserName: row.targetUserId ? targetById.get(row.targetUserId) ?? null : null,
    actorName: row.actor?.name ?? "Akun terhapus",
    createdAt: row.createdAt,
  }))
}

export async function readAccounts(): Promise<AccountRow[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      nip: true,
      email: true,
      active: true,
      isTeacher: true,
      rbacRoles: { select: { role: { select: { id: true, key: true, name: true } } } },
    },
  })

  return users.map((user) => {
    const roleIds = user.rbacRoles.map((assignment) => assignment.role.id)
    return {
      id: user.id,
      name: user.name,
      nip: user.nip,
      email: user.email,
      active: user.active,
      isTeacher: user.isTeacher,
      roles: user.rbacRoles.map((assignment) => ({
        id: assignment.role.id,
        name: assignment.role.name,
        isSystemAdmin: assignment.role.key === SYSTEM_ADMIN_ROLE_KEY,
      })),
      revision: computeAssignmentRevision(roleIds),
    }
  })
}

/**
 * Katalog permission untuk matriks. Dibaca dari registry kode, bukan database:
 * registry adalah sumber kebenaran, dan key yang belum tersemai tetap harus
 * terlihat oleh admin.
 */
export function readPermissionCatalog(): PermissionRow[] {
  return PERMISSIONS.map((permission) => ({
    key: permission.key,
    label: permission.label,
    module: permission.module,
    sensitive: permission.sensitive === true,
  }))
}
