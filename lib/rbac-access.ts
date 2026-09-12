/**
 * Konteks otorisasi sisi server.
 *
 * SERVER-ONLY: berkas ini mengimpor `lib/prisma.ts`. Komponen klien tidak boleh
 * mengimpor value dari sini (import type aman) — lihat catatan boundary bundel
 * di docs/architecture/overview.md.
 *
 * Otoritas backend adalah DATABASE SAAT INI. JWT/sesi hanya dipakai untuk
 * mengetahui SIAPA pemanggilnya; role dan permission di dalam token, payload
 * `update`, body permintaan, atau apa pun yang dikirim browser tidak pernah
 * ikut menentukan keputusan. Konsekuensinya: mencabut role yang sudah
 * ter-commit langsung berlaku pada permintaan berikutnya tanpa logout, dan
 * cookie lama tetap sah sebagai identitas.
 */

import { cache } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  hasAnyPermission,
  hasPermission,
  isSystemAdmin,
  resolveClassScope,
  resolveScope,
  type AuthorizationSubject,
  type RoleSummary,
  type ScopeDecision,
} from "@/lib/rbac"
import { SYSTEM_ADMIN_ROLE_KEY, isKnownPermission } from "@/lib/rbac-permissions"
import { LEGACY_BACKFILL_KEY } from "@/lib/rbac-legacy"
import { evaluateReadiness, type RbacReadiness } from "@/lib/rbac-readiness"

export class RbacNotReadyError extends Error {
  constructor(readonly readiness: RbacReadiness) {
    super(`RBAC_NOT_READY:${readiness.state}:${readiness.reason}`)
    this.name = "RbacNotReadyError"
  }
}

/**
 * Status kesiapan RBAC, dibaca dari database pada tiap permintaan
 * (memoized request-local). Kegagalan query dipetakan ke `error`, bukan
 * dilempar, supaya pemanggil yang hanya ingin menampilkan status tetap bisa;
 * guard di bawah memperlakukan apa pun selain `ready` sebagai penolakan.
 */
export const getRbacReadiness = cache(async (): Promise<RbacReadiness> => {
  try {
    const [backfill, userCount] = await Promise.all([
      prisma.rbacMigration.findUnique({
        where: { key: LEGACY_BACKFILL_KEY },
        select: { key: true, status: true },
      }),
      prisma.user.count(),
    ])
    return evaluateReadiness({ backfill, userCount })
  } catch (error) {
    return { state: "error", reason: error instanceof Error ? error.message : String(error) }
  }
})

export class UnauthorizedError extends Error {
  constructor(message = "UNAUTHORIZED") {
    super(message)
    this.name = "UnauthorizedError"
  }
}

export class ForbiddenError extends Error {
  constructor(message = "FORBIDDEN") {
    super(message)
    this.name = "ForbiddenError"
  }
}

/// Identitas bisnis minimal. Sengaja tidak memuat permission apa pun supaya
/// tidak ada pemanggil yang tergoda memakainya sebagai keputusan akses.
export type CurrentUser = {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly isTeacher: boolean
}

export type AuthorizationContext = {
  readonly user: CurrentUser
  readonly subject: AuthorizationSubject
  readonly roles: readonly RoleSummary[]
  /// Permission efektif hasil union seluruh role, sudah disaring registry.
  readonly grants: ReadonlySet<string>
  readonly isSystemAdmin: boolean
}

/**
 * Identitas pemanggil, diverifikasi ulang ke database.
 *
 * Sesi lama dengan user id yang masih valid tetap boleh dipakai, tetapi akun
 * yang dihapus atau dinonaktifkan langsung ditolak meski token-nya belum
 * kedaluwarsa.
 *
 * Dibungkus `cache()` sehingga satu permintaan React/Next hanya sekali
 * membaca. Memoization ini request-local — tidak ada cache lintas permintaan
 * atau lintas pengguna, jadi perubahan hak selalu terbaca pada request baru.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await auth()
  const sessionUserId = session?.user?.id
  if (!sessionUserId) throw new UnauthorizedError()

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: { id: true, name: true, email: true, active: true, isTeacher: true },
  })

  if (!user || !user.active) throw new UnauthorizedError()

  return { id: user.id, name: user.name, email: user.email, isTeacher: user.isTeacher }
})

/**
 * Konteks otorisasi lengkap untuk permintaan ini.
 *
 * Kegagalan membaca database TIDAK pernah jatuh kembali ke flag legacy, ke
 * `User.role`, atau ke isi JWT: error dibiarkan naik sehingga permintaan gagal
 * tertutup. Memberi akses saat sumber kebenaran tidak terbaca adalah kegagalan
 * yang lebih buruk daripada menolak.
 */
export const getAuthorizationContext = cache(async (): Promise<AuthorizationContext> => {
  const readiness = await getRbacReadiness()
  if (readiness.state !== "ready") throw new RbacNotReadyError(readiness)

  const user = await requireUser()

  const memberships = await prisma.userRole.findMany({
    where: { userId: user.id },
    select: {
      role: {
        select: {
          id: true,
          key: true,
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  })

  const roles: RoleSummary[] = memberships.map(({ role }) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    permissionKeys: role.permissions.map((entry) => entry.permission.key),
  }))

  const subject: AuthorizationSubject = {
    userId: user.id,
    roles,
    isTeacher: user.isTeacher,
  }

  const grants = new Set<string>()
  for (const role of roles) {
    for (const key of role.permissionKeys) {
      if (isKnownPermission(key)) grants.add(key)
    }
  }

  return {
    user,
    subject,
    roles,
    grants,
    isSystemAdmin: isSystemAdmin(subject),
  }
})

/// Pemeriksaan tanpa melempar, untuk menyusun menu/tombol.
export async function can(key: string): Promise<boolean> {
  const context = await getAuthorizationContext()
  return hasPermission(context.subject, key)
}

/**
 * Menuntut satu permission. Key di luar registry selalu ditolak, termasuk
 * untuk system admin.
 */
export async function requirePermission(key: string): Promise<AuthorizationContext> {
  const context = await getAuthorizationContext()
  if (!hasPermission(context.subject, key)) throw new ForbiddenError()
  return context
}

/// Menuntut minimal salah satu permission (mis. satu halaman yang melayani
/// beberapa peran berbeda).
export async function requireAnyPermission(keys: readonly string[]): Promise<AuthorizationContext> {
  const context = await getAuthorizationContext()
  if (!hasAnyPermission(context.subject, keys)) throw new ForbiddenError()
  return context
}

/// Scope efektif satu operasi, tanpa memperhitungkan setelan kelas.
export async function requireScope(resource: string, action: string): Promise<ScopeDecision> {
  const context = await getAuthorizationContext()
  const decision = resolveScope(context.subject, resource, action)
  if (!decision.allowed) throw new ForbiddenError()
  return decision
}

/**
 * Scope kelas efektif, sudah memperhitungkan
 * `SchoolSetting.allowTeachersAccessAllClasses`.
 *
 * Setelan dibaca per permintaan dari database; ia hanya melebarkan permission
 * yang sudah dimiliki dan hanya untuk akun ber-`isTeacher`.
 */
export async function requireClassScope(resource: string, action: string): Promise<ScopeDecision> {
  const context = await getAuthorizationContext()
  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { allowTeachersAccessAllClasses: true },
  })

  const decision = resolveClassScope({
    subject: context.subject,
    resource,
    action,
    allowTeachersAccessAllClasses: setting?.allowTeachersAccessAllClasses ?? false,
  })

  if (!decision.allowed) throw new ForbiddenError()
  return decision
}

/**
 * Kompatibilitas sementara untuk pemanggil legacy.
 *
 * Berbeda dari `requireAdmin()` lama yang memercayai role di dalam JWT, versi
 * ini memeriksa keanggotaan `system_admin` pada database saat ini. Ini BUKAN
 * model otorisasi akhir: tiap surface harus pindah ke `requirePermission()`
 * dengan key spesifik pada Phase 4, karena "admin" bukan sebuah kewenangan.
 */
export async function requireSystemAdmin(): Promise<AuthorizationContext> {
  const context = await getAuthorizationContext()
  if (!context.roles.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY)) {
    throw new ForbiddenError()
  }
  return context
}
