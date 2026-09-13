/**
 * Service manajemen role.
 *
 * Murni terhadap infrastruktur: seluruh akses data lewat `RoleStore` yang
 * diinjeksi pemanggil, mengikuti pola `lib/bos-access-service.ts`. Route
 * handler membungkusnya dalam `prisma.$transaction` dan menyediakan store yang
 * memakai client transaksi — sehingga mutasi role DAN baris auditnya berada di
 * transaksi yang sama.
 *
 * Kontrak penting:
 *
 *   - `key` STABIL. Tidak ada operasi di sini yang mengubah key, `isSystem`,
 *     atau `isProtected`. Otorisasi tidak pernah memeriksa nama tampilan,
 *     sehingga mengganti nama aman dan menamai role "Admin Sistem" tidak
 *     memberi kekuatan apa pun.
 *   - Optimistic concurrency lewat `expectedVersion`. Penulisan basi ditolak
 *     409, bukan menimpa diam-diam.
 *   - Payload yang memuat satu entri terlarang ditolak SELURUHNYA.
 *   - Kegagalan audit dilempar keluar, tidak pernah ditelan, supaya transaksi
 *     pemanggil ikut rollback.
 */

import { findMissingDependencies } from "@/lib/rbac"
import {
  assertRoleMutationAllowed,
  describeAuthorityDenial,
  type AuthorityActor,
} from "@/lib/rbac-authority"
import { summarizePermissionChange, type RbacAuditAction } from "@/lib/rbac-audit"
import {
  RESERVED_ROLE_KEYS,
  SYSTEM_ADMIN_ROLE_KEY,
  isKnownPermission,
} from "@/lib/rbac-permissions"

export type RoleRecord = {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  isProtected: boolean
  version: number
  permissionKeys: string[]
  memberIds: string[]
}

export type RoleAuditEntry = {
  action: RbacAuditAction
  entityId: string
  summary: string
  before?: unknown
  after?: unknown
}

export type RoleStore = {
  findRoleById(id: string): Promise<RoleRecord | null>
  findRoleByKey(key: string): Promise<RoleRecord | null>
  createRole(data: {
    key: string
    name: string
    description: string | null
    permissionKeys: string[]
  }): Promise<RoleRecord>
  updateRole(
    id: string,
    expectedVersion: number,
    data: { name?: string; description?: string | null; permissionKeys?: string[] },
  ): Promise<RoleRecord | null>
  deleteRole(id: string, expectedVersion: number): Promise<boolean>
  removeAllMembers(id: string): Promise<number>
  recordAudit(entry: RoleAuditEntry): Promise<void>
}

export class RoleMutationError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Jumlah anggota, diisi saat penghapusan ditolak karena masih berisi. */
    readonly memberCount?: number,
  ) {
    super(message)
    this.name = "RoleMutationError"
  }
}

export type ServiceActor = AuthorityActor & { id: string }

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

function staleVersionError(): RoleMutationError {
  return new RoleMutationError(
    409,
    "Role telah diubah pihak lain. Muat ulang dan tinjau perubahan sebelum menyimpan.",
  )
}

function assertVersion(role: RoleRecord, expectedVersion: number): void {
  if (role.version !== expectedVersion) throw staleVersionError()
}

async function loadRole(store: RoleStore, roleId: string): Promise<RoleRecord> {
  const role = await store.findRoleById(roleId)
  if (!role) throw new RoleMutationError(404, "Role tidak ditemukan.")
  return role
}

/**
 * Memvalidasi satu set permission yang akan disimpan: harus dikenal registry,
 * dependency-nya lengkap, dan berada dalam batas kewenangan aktor.
 */
function assertPermissionSetAllowed(input: {
  actor: ServiceActor
  role: { key: string; name: string; isProtected: boolean; isSystem: boolean }
  current: readonly string[]
  next: readonly string[]
}): { added: string[]; removed: string[] } {
  const currentSet = new Set(input.current)
  const nextSet = new Set(input.next)
  const added = [...nextSet].filter((key) => !currentSet.has(key))
  const removed = [...currentSet].filter((key) => !nextSet.has(key))

  // Validasi SELURUH payload final, bukan hanya delta. Baris permission stale
  // yang masih ada di database tidak boleh dilewatkan kembali oleh klien.
  const unknown = [...nextSet].filter((key) => !isKnownPermission(key))
  if (unknown.length > 0) {
    throw new RoleMutationError(400, `Permission tidak dikenal: ${unknown.join(", ")}.`)
  }

  const denial = assertRoleMutationAllowed({
    actor: input.actor,
    role: input.role,
    addedKeys: added,
    removedKeys: removed,
  })
  if (denial) {
    const failure = describeAuthorityDenial(denial)
    throw new RoleMutationError(failure.status, failure.error)
  }

  // Dependency diperiksa atas set FINAL, bukan atas yang ditambahkan saja.
  const missing = findMissingDependencies([...nextSet])
  if (missing.length > 0) {
    throw new RoleMutationError(
      400,
      `Permission berikut membutuhkan prasyarat yang belum dipilih: ${missing.join(", ")}.`,
    )
  }

  return { added, removed }
}

export async function createRole(
  store: RoleStore,
  input: {
    actor: ServiceActor
    key: string
    name: string
    description: string | null
    permissionKeys: string[]
  },
): Promise<RoleRecord> {
  const key = input.key.trim().toLowerCase()
  const name = input.name.trim()

  if (!KEY_PATTERN.test(key)) {
    throw new RoleMutationError(400, "Key role hanya boleh huruf kecil, angka, dan garis bawah.")
  }
  if (RESERVED_ROLE_KEYS.includes(key)) {
    throw new RoleMutationError(400, `Key "${key}" dicadangkan sistem.`)
  }
  if (name.length === 0) {
    throw new RoleMutationError(400, "Nama role wajib diisi.")
  }
  if (await store.findRoleByKey(key)) {
    throw new RoleMutationError(409, `Key "${key}" sudah dipakai role lain.`)
  }

  const unknown = input.permissionKeys.filter((permission) => !isKnownPermission(permission))
  if (unknown.length > 0) {
    throw new RoleMutationError(400, `Permission tidak dikenal: ${unknown.join(", ")}.`)
  }

  // Role baru selalu lahir sebagai role biasa: tidak ada jalur untuk membuat
  // role bersistem/terproteksi lewat API.
  assertPermissionSetAllowed({
    actor: input.actor,
    role: { key, name, isProtected: false, isSystem: false },
    current: [],
    next: input.permissionKeys,
  })

  const role = await store.createRole({
    key,
    name,
    description: input.description,
    permissionKeys: input.permissionKeys,
  })

  await store.recordAudit({
    action: "RBAC_ROLE_CREATED",
    entityId: role.id,
    summary: `Role ${role.name} dibuat dengan ${role.permissionKeys.length} permission.`,
    after: {
      id: role.id,
      key: role.key,
      name: role.name,
      permissionKeys: role.permissionKeys,
    },
  })

  return role
}

/** Mengubah nama/deskripsi. Key dan metadata sistem tidak pernah ikut berubah. */
export async function updateRoleProfile(
  store: RoleStore,
  input: {
    actor: ServiceActor
    roleId: string
    expectedVersion: number
    name: string
    description: string | null
  },
): Promise<RoleRecord> {
  const role = await loadRole(store, input.roleId)
  assertVersion(role, input.expectedVersion)

  const name = input.name.trim()
  if (name.length === 0) throw new RoleMutationError(400, "Nama role wajib diisi.")

  // Role terproteksi boleh diganti NAMANYA (nama hanyalah label), tetapi hanya
  // oleh system admin, dan key-nya tetap.
  if ((role.isProtected || role.isSystem) && !input.actor.isSystemAdmin) {
    throw new RoleMutationError(403, "Role terproteksi hanya dapat diubah oleh Admin Sistem.")
  }

  if (name === role.name && input.description === role.description) {
    return role
  }

  const updated = await store.updateRole(role.id, input.expectedVersion, { name, description: input.description })
  if (!updated) throw staleVersionError()

  await store.recordAudit({
    action: "RBAC_ROLE_UPDATED",
    entityId: role.id,
    summary: `Role ${role.name} diperbarui menjadi ${updated.name}.`,
    before: { id: role.id, key: role.key, name: role.name, description: role.description },
    after: { id: updated.id, key: updated.key, name: updated.name, description: updated.description },
  })

  return updated
}

export async function updateRolePermissions(
  store: RoleStore,
  input: {
    actor: ServiceActor
    roleId: string
    expectedVersion: number
    permissionKeys: string[]
  },
): Promise<RoleRecord> {
  const role = await loadRole(store, input.roleId)
  assertVersion(role, input.expectedVersion)

  const { added, removed } = assertPermissionSetAllowed({
    actor: input.actor,
    role,
    current: role.permissionKeys,
    next: input.permissionKeys,
  })

  if (added.length === 0 && removed.length === 0) {
    return role
  }

  const updated = await store.updateRole(role.id, input.expectedVersion, { permissionKeys: input.permissionKeys })
  if (!updated) throw staleVersionError()

  await store.recordAudit({
    action: "RBAC_ROLE_PERMISSIONS_CHANGED",
    entityId: role.id,
    summary: summarizePermissionChange({ roleName: role.name, added, removed }),
    before: { id: role.id, key: role.key, permissionKeys: role.permissionKeys },
    after: { id: updated.id, key: updated.key, permissionKeys: updated.permissionKeys, added, removed },
  })

  return updated
}

/**
 * Menduplikasi role.
 *
 * Salinan selalu lahir sebagai role BIASA: `isSystem`/`isProtected` tidak ikut
 * tersalin. Menyalin bendera itu akan menciptakan role yang tampak istimewa
 * dan tidak bisa dihapus, tanpa pernah memberi bypass — kebingungan tanpa
 * manfaat. Bypass sendiri melekat pada key `system_admin`, yang unik.
 */
export async function cloneRole(
  store: RoleStore,
  input: { actor: ServiceActor; sourceRoleId: string; key: string; name: string },
): Promise<RoleRecord> {
  const source = await loadRole(store, input.sourceRoleId)

  return createRole(store, {
    actor: input.actor,
    key: input.key,
    name: input.name,
    description: source.description,
    permissionKeys: [...source.permissionKeys],
  })
}

export async function deleteRole(
  store: RoleStore,
  input: {
    actor: ServiceActor
    roleId: string
    expectedVersion: number
    /** Operator berwenang menyatakan niat mencabut role dari semua anggotanya. */
    revokeFromAllMembers?: boolean
  },
): Promise<{ revokedMemberCount: number }> {
  const role = await loadRole(store, input.roleId)
  assertVersion(role, input.expectedVersion)

  if (role.isProtected || role.isSystem || role.key === SYSTEM_ADMIN_ROLE_KEY) {
    throw new RoleMutationError(403, "Role terproteksi tidak dapat dihapus.")
  }
  if (!input.actor.isSystemAdmin) {
    const denial = assertRoleMutationAllowed({
      actor: input.actor,
      role,
      addedKeys: [],
      removedKeys: role.permissionKeys,
    })
    if (denial) {
      const failure = describeAuthorityDenial(denial)
      throw new RoleMutationError(failure.status, failure.error)
    }
  }

  const memberCount = role.memberIds.length
  if (memberCount > 0 && input.revokeFromAllMembers !== true) {
    throw new RoleMutationError(
      409,
      `Role ${role.name} masih dipegang ${memberCount} pengguna.`,
      memberCount,
    )
  }

  // Pencabutan dan penghapusan berada dalam satu transaksi pemanggil, sehingga
  // tidak mungkin tersisa keanggotaan yang menunjuk role yang sudah hilang.
  const revokedMemberCount = memberCount > 0 ? await store.removeAllMembers(role.id) : 0
  const deleted = await store.deleteRole(role.id, input.expectedVersion)
  if (!deleted) throw staleVersionError()

  await store.recordAudit({
    action: "RBAC_ROLE_DELETED",
    entityId: role.id,
    summary:
      revokedMemberCount > 0
        ? `Role ${role.name} dihapus dan dicabut dari ${revokedMemberCount} pengguna.`
        : `Role ${role.name} dihapus.`,
    before: {
      id: role.id,
      key: role.key,
      name: role.name,
      permissionKeys: role.permissionKeys,
      memberIds: role.memberIds,
    },
  })

  return { revokedMemberCount }
}
