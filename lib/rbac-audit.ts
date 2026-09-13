/**
 * Audit khusus perubahan kewenangan.
 *
 * Modul ini CLIENT-SAFE dan murni: ia hanya mendefinisikan kosakata audit RBAC,
 * meredaksi payload, dan menyusun ringkasan. Penulisan baris audit tetap lewat
 * `lib/audit-log.ts` (satu tabel `AuditLog`, bukan stack logging baru) dan
 * WAJIB berada di transaksi yang sama dengan mutasi kewenangannya.
 *
 * Alasan entitas RBAC dipisah: pembaca audit profil guru biasa tidak boleh ikut
 * melihat riwayat kewenangan hanya karena `targetUserId` kebetulan cocok.
 * Pemisahan itu ditegakkan saat membaca, lihat `lib/rbac-audit-access.ts`.
 */

/// Entitas yang riwayatnya hanya boleh dibaca pemegang `rbac.audit.read`.
export const RBAC_AUDIT_ENTITIES = [
  "RbacRole",
  "RbacRolePermission",
  "RbacUserRole",
  /// Perubahan identitas/status/kredensial akun yang bernilai otorisasi.
  "UserAuthority",
] as const

export type RbacAuditEntity = (typeof RBAC_AUDIT_ENTITIES)[number]

export const RBAC_AUDIT_ACTIONS = [
  "RBAC_ROLE_CREATED",
  "RBAC_ROLE_UPDATED",
  "RBAC_ROLE_DELETED",
  "RBAC_ROLE_PERMISSIONS_CHANGED",
  "RBAC_USER_ROLES_CHANGED",
  "RBAC_USER_ROLES_BULK_CHANGED",
  "RBAC_ACCOUNT_CREATED",
  "RBAC_ACCOUNT_IDENTITY_CHANGED",
  "RBAC_ACCOUNT_STATUS_CHANGED",
  "RBAC_ACCOUNT_CREDENTIAL_CHANGED",
  "RBAC_ACCOUNT_TEACHER_FLAG_CHANGED",
  "RBAC_LEGACY_BACKFILL",
] as const

export type RbacAuditAction = (typeof RBAC_AUDIT_ACTIONS)[number]

export function isRbacAuditEntity(entity: string): entity is RbacAuditEntity {
  return (RBAC_AUDIT_ENTITIES as readonly string[]).includes(entity)
}

/**
 * Nama field yang tidak boleh pernah masuk audit.
 *
 * Dicocokkan setelah dinormalisasi (huruf kecil, tanpa `_`), sehingga
 * `passwordHash`, `password_hash`, dan `hashedPassword` sama-sama tertangkap.
 */
const FORBIDDEN_FIELDS = new Set([
  "password",
  "passwordhash",
  "hashedpassword",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "salt",
  "secret",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "csrftoken",
  "env",
  "healthrecord",
  "healthrecords",
  "measurement",
  "measurements",
])

function isForbiddenField(key: string): boolean {
  return FORBIDDEN_FIELDS.has(key.toLowerCase().replace(/_/g, ""))
}

export type AuditPayload = Record<string, unknown>

/**
 * Menyalin payload audit tanpa field rahasia, secara rekursif.
 *
 * Pendekatannya daftar-larangan atas objek yang SUDAH dipilih pemanggil —
 * pemanggil tetap wajib menyusun ringkasan seperlunya (id, key, nama, status),
 * bukan melempar seluruh entitas User ke sini.
 */
export function redactAuditPayload(payload: AuditPayload): AuditPayload {
  return redactValue(payload) as AuditPayload
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue)
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenField(key)) continue
      result[key] = redactValue(child)
    }
    return result
  }
  return value
}

export function summarizePermissionChange(input: {
  roleName: string
  added: readonly string[]
  removed: readonly string[]
}): string {
  return `Permission role ${input.roleName}: +${input.added.length} ditambahkan, -${input.removed.length} dicabut.`
}

export type RoleRef = { id: string; key: string; name: string }

export function summarizeRoleAssignment(input: {
  userName: string
  added: readonly RoleRef[]
  removed: readonly RoleRef[]
  resultingRoleCount?: number
}): string {
  const parts: string[] = []
  if (input.added.length > 0) {
    parts.push(`ditambahkan ${input.added.map((role) => role.name).join(", ")}`)
  }
  if (input.removed.length > 0) {
    parts.push(`dicabut ${input.removed.map((role) => role.name).join(", ")}`)
  }
  const detail = parts.length > 0 ? parts.join("; ") : "tidak ada perubahan"

  const zeroRole = input.resultingRoleCount === 0 ? " Akun kini tanpa role." : ""
  return `Role ${input.userName}: ${detail}.${zeroRole}`
}
