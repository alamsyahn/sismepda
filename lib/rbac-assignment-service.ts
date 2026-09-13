/**
 * Service penugasan role ke pengguna.
 *
 * Seperti `lib/rbac-role-service.ts`, seluruh akses data lewat store yang
 * diinjeksi sehingga aturannya dapat diuji tanpa database, dan route handler
 * menjalankannya di dalam satu `prisma.$transaction` bersama baris auditnya.
 *
 * Concurrency memakai REVISI dari isi himpunan role, bukan kolom versi. Alasan:
 * keanggotaan tersimpan sebagai baris-baris `UserRole`, tidak ada satu baris
 * pun yang bisa membawa nomor versi. Revisi adalah sidik jari himpunan saat
 * klien memuat formulir; bila keanggotaan berubah sejak itu, penyimpanan
 * ditolak 409 alih-alih menghapus perubahan orang lain (lost update).
 */

import { createHash } from "node:crypto"

import {
  assertAccountMutationAllowed,
  assertSystemAdminRemains,
} from "@/lib/rbac-invariants"
import { summarizeRoleAssignment, type RbacAuditAction, type RoleRef } from "@/lib/rbac-audit"
import { SYSTEM_ADMIN_ROLE_KEY, isSensitiveAuthority } from "@/lib/rbac-permissions"
import type { AuthorityActor } from "@/lib/rbac-authority"

export type AssignmentRole = {
  id: string
  key: string
  name: string
  permissionKeys: string[]
}

export type AssignmentAuditEntry = {
  action: RbacAuditAction
  entityId: string
  targetUserId: string
  summary: string
  before?: unknown
  after?: unknown
}

export type AssignmentStore = {
  findUser(id: string): Promise<{ id: string; name: string; active: boolean; roleIds: string[] } | null>
  findRoles(ids: readonly string[]): Promise<AssignmentRole[]>
  replaceRoles(userId: string, roleIds: readonly string[]): Promise<void>
  /** Jumlah system admin aktif SELAIN `excludeUserId`. Harus dibaca di bawah kunci. */
  countOtherActiveSystemAdmins(excludeUserId: string): Promise<number>
  recordAudit(entry: AssignmentAuditEntry): Promise<void>
}

export class AssignmentError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "AssignmentError"
  }
}

export type ServiceActor = AuthorityActor & { id: string }

/**
 * Sidik jari sebuah himpunan role.
 *
 * Diurutkan lebih dulu supaya revisi hanya bergantung pada ISI, bukan urutan
 * yang kebetulan dikembalikan database.
 */
export function computeAssignmentRevision(roleIds: readonly string[]): string {
  const canonical = [...roleIds].sort().join("|")
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

export async function updateUserRoles(
  store: AssignmentStore,
  input: {
    actor: ServiceActor
    userId: string
    roleIds: readonly string[]
    expectedRevision: string
    confirmSelfRevoke?: boolean
  },
): Promise<{ added: RoleRef[]; removed: RoleRef[]; revision: string }> {
  const user = await store.findUser(input.userId)
  if (!user) throw new AssignmentError(404, "Pengguna tidak ditemukan.")

  const currentRevision = computeAssignmentRevision(user.roleIds)
  if (currentRevision !== input.expectedRevision) {
    throw new AssignmentError(
      409,
      "Role pengguna telah diubah pihak lain. Muat ulang dan tinjau sebelum menyimpan.",
    )
  }

  const requestedIds = [...new Set(input.roleIds)]
  const roles = await store.findRoles(requestedIds)
  if (roles.length !== requestedIds.length) {
    const found = new Set(roles.map((role) => role.id))
    const missing = requestedIds.filter((id) => !found.has(id))
    throw new AssignmentError(400, `Role tidak ditemukan: ${missing.join(", ")}.`)
  }

  const currentRoles = await store.findRoles(user.roleIds)
  const currentIds = new Set(user.roleIds)
  const nextIds = new Set(requestedIds)

  const added = roles.filter((role) => !currentIds.has(role.id))
  const removed = currentRoles.filter((role) => !nextIds.has(role.id))

  if (added.length === 0 && removed.length === 0) {
    return { added: [], removed: [], revision: currentRevision }
  }

  const grantsAdmin = added.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY)
  const revokesAdmin = removed.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY)

  // Pemberian/pencabutan system_admin hanya boleh oleh system admin, dan
  // mencabut milik sendiri menuntut konfirmasi eksplisit.
  for (const intent of [
    ...(grantsAdmin ? (["grant_system_admin"] as const) : []),
    ...(revokesAdmin ? (["revoke_system_admin"] as const) : []),
  ]) {
    const denial = assertAccountMutationAllowed({
      actorId: input.actor.id,
      actorIsSystemAdmin: input.actor.isSystemAdmin,
      target: {
        id: user.id,
        isSystemAdmin: currentRoles.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY),
        hasSensitiveAuthority: currentRoles.some((role) =>
          role.permissionKeys.some(isSensitiveAuthority),
        ),
        active: user.active,
      },
      intent,
      confirmSelfRevoke: input.confirmSelfRevoke,
    })
    if (denial) throw new AssignmentError(denial.status, denial.error)
  }

  // Aktor non-system tidak boleh mendelegasikan role yang memuat kewenangan
  // sensitif — itu setara memberikan kewenangan itu sendiri. Untuk role biasa,
  // setiap permission yang DIBERIKAN harus sudah dimiliki aktor; memiliki hak
  // mengatur assignment bukan kuasa untuk menciptakan kewenangan baru.
  if (!input.actor.isSystemAdmin) {
    const sensitiveRole = [...added, ...removed].find((role) =>
      role.permissionKeys.some(isSensitiveAuthority),
    )
    if (sensitiveRole) {
      throw new AssignmentError(
        403,
        `Role ${sensitiveRole.name} memuat kewenangan sensitif dan hanya dapat diatur Admin Sistem.`,
      )
    }

    const beyondOwnAuthority = added.flatMap((role) =>
      role.permissionKeys.filter((key) => !input.actor.grants.has(key)),
    )
    if (beyondOwnAuthority.length > 0) {
      throw new AssignmentError(
        403,
        `Anda tidak dapat memberikan permission yang tidak Anda miliki: ${[...new Set(beyondOwnAuthority)].join(", ")}.`,
      )
    }
  }

  await store.replaceRoles(user.id, requestedIds)

  // Invariant dibaca SETELAH penulisan, supaya yang diperiksa adalah kondisi
  // akhir. Pemanggil wajib sudah memegang advisory lock populasi admin.
  if (revokesAdmin) {
    const others = await store.countOtherActiveSystemAdmins(user.id)
    const denial = assertSystemAdminRemains({
      remainingActiveAdminIds: others > 0 ? ["ada"] : [],
      actorId: input.actor.id,
      targetId: user.id,
    })
    if (denial) throw new AssignmentError(denial.status, denial.error)
  }

  const revision = computeAssignmentRevision(requestedIds)

  await store.recordAudit({
    action: "RBAC_USER_ROLES_CHANGED",
    entityId: user.id,
    targetUserId: user.id,
    summary: summarizeRoleAssignment({
      userName: user.name,
      added,
      removed,
      resultingRoleCount: requestedIds.length,
    }),
    before: { roles: currentRoles.map(toRef) },
    after: { roles: roles.map(toRef), revision },
  })

  return { added: added.map(toRef), removed: removed.map(toRef), revision }
}

function toRef(role: AssignmentRole): RoleRef {
  return { id: role.id, key: role.key, name: role.name }
}
