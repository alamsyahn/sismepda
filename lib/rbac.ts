/**
 * Evaluator permission murni.
 *
 * CLIENT-SAFE dan bebas efek samping: tidak mengimpor Prisma maupun sesi.
 * Seluruh input diberikan pemanggil, sehingga setiap aturan keputusan bisa
 * diuji sebagai fungsi biasa. Pengambilan data dari database ada di
 * `lib/rbac-access.ts`.
 *
 * Aturan yang SENGAJA tidak ada:
 *   - grant langsung user→permission (hanya lewat role);
 *   - DENY eksplisit (ketiadaan grant sudah berarti tolak);
 *   - hierarki/inheritance/prioritas antar role;
 *   - role default implisit (tanpa role = tanpa permission);
 *   - wildcard runtime (`manage` bukan singkatan CRUD);
 *   - implikasi diam-diam (write tidak memberi read, read tidak memberi export);
 *   - pelebaran scope otomatis (assigned_classes tidak pernah menjadi all).
 */

import {
  PERMISSION_KEYS,
  SYSTEM_ADMIN_ROLE_KEY,
  buildPermissionKey,
  getPermission,
  isKnownPermission,
  type PermissionScope,
} from "@/lib/rbac-permissions"

/// Ringkasan role yang dipegang seorang user, sebagaimana tersimpan di DB.
export type RoleSummary = {
  readonly id: string
  readonly key: string
  readonly name: string
  /// Permission key milik role ini.
  readonly permissionKeys: readonly string[]
}

/// Seluruh bahan keputusan untuk satu permintaan.
export type AuthorizationSubject = {
  readonly userId: string
  readonly roles: readonly RoleSummary[]
  /// Identitas bisnis, bukan otorisasi. Hanya dipakai sebagai syarat tambahan
  /// pelebaran scope kelas, tidak pernah sebagai pemberi permission.
  readonly isTeacher: boolean
}

export type ScopeDecision =
  | { readonly allowed: true; readonly scope: PermissionScope }
  | { readonly allowed: false; readonly reason: DenyReason }

export type DenyReason =
  | "unknown_permission"
  | "not_granted"

/**
 * Gabungan permission dari seluruh role. Tidak ada sumber lain yang
 * berkontribusi.
 *
 * Key yang tidak dikenal registry dibuang di sini: baris DB basi (misalnya
 * sisa permission yang key-nya sudah dihapus dari kode) tidak boleh menjadi
 * kewenangan hidup.
 */
export function collectGrants(subject: AuthorizationSubject): ReadonlySet<string> {
  const grants = new Set<string>()
  for (const role of subject.roles) {
    for (const key of role.permissionKeys) {
      if (isKnownPermission(key)) grants.add(key)
    }
  }
  return grants
}

export function isSystemAdmin(subject: AuthorizationSubject): boolean {
  // Ditentukan oleh key role, bukan oleh nama tampilan dan bukan oleh flag
  // `isProtected`: role hasil duplikasi boleh saja membawa flag itu, tetapi
  // tidak boleh membawa bypass.
  return subject.roles.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY)
}

/**
 * Keputusan untuk satu key persis.
 *
 * System admin lolos untuk key yang DIKENAL saja — key tak dikenal tetap
 * ditolak supaya salah ketik tidak pernah berubah menjadi izin.
 */
export function hasPermission(subject: AuthorizationSubject, key: string): boolean {
  if (!isKnownPermission(key)) return false
  if (isSystemAdmin(subject)) return true
  return collectGrants(subject).has(key)
}

/**
 * Permission EFEKTIF: setiap key yang benar-benar diizinkan bagi subjek ini.
 *
 * Berbeda dari `collectGrants`, yang hanya memantulkan baris `RolePermission`
 * mentah. Role `system_admin` sengaja TIDAK memiliki baris itu — kewenangannya
 * hidup sebagai bypass terkendali di `hasPermission`. Modul fitur yang
 * menurunkan kemampuannya dari `collectGrants` karena itu melihat himpunan
 * KOSONG untuk Admin Sistem dan menyembunyikan seluruh isinya.
 *
 * Fungsi ini menutup celah itu di satu tempat, dengan memutuskan ulang setiap
 * key yang dikenal lewat evaluator kanonik. Konsekuensinya otomatis benar:
 * bypass hanya milik role ber-key `system_admin` (bukan yang sekadar bernama
 * sama atau hasil kloning), key di luar registry tetap tertutup, dan pemakai
 * biasa tetap memperoleh union OR dari seluruh role-nya.
 *
 * Tidak ada `RolePermission` yang dimaterialisasi demi ini.
 */
export function effectiveGrants(subject: AuthorizationSubject): ReadonlySet<string> {
  if (!isSystemAdmin(subject)) return collectGrants(subject)
  return new Set(PERMISSION_KEYS)
}

export function hasAnyPermission(subject: AuthorizationSubject, keys: readonly string[]): boolean {
  return keys.some((key) => hasPermission(subject, key))
}

export function hasAllPermissions(subject: AuthorizationSubject, keys: readonly string[]): boolean {
  return keys.length > 0 && keys.every((key) => hasPermission(subject, key))
}

/**
 * Menentukan scope efektif untuk satu operasi.
 *
 * Tiap operasi menyelesaikan scope-nya sendiri: `attendance.read.all` tidak
 * pernah ikut melebarkan `attendance.write`. Urutan `all` lebih dulu karena ia
 * superset dari `assigned_classes` untuk operasi yang sama.
 */
export function resolveScope(
  subject: AuthorizationSubject,
  resource: string,
  action: string,
): ScopeDecision {
  const allKey = buildPermissionKey(resource, action, "all")
  const assignedKey = buildPermissionKey(resource, action, "assigned_classes")

  if (!isKnownPermission(allKey) && !isKnownPermission(assignedKey)) {
    return { allowed: false, reason: "unknown_permission" }
  }

  // Bypass system admin berlaku per-operasi dan selalu menghasilkan `all`.
  if (isSystemAdmin(subject)) {
    return { allowed: true, scope: "all" }
  }

  const grants = collectGrants(subject)
  if (isKnownPermission(allKey) && grants.has(allKey)) {
    return { allowed: true, scope: "all" }
  }
  if (isKnownPermission(assignedKey) && grants.has(assignedKey)) {
    return { allowed: true, scope: "assigned_classes" }
  }
  return { allowed: false, reason: "not_granted" }
}

/**
 * Keluarga permission yang boleh dilebarkan oleh
 * `SchoolSetting.allowTeachersAccessAllClasses`.
 *
 * Daftar ini tertutup dan mereproduksi perilaku legacy apa adanya; modul
 * lain (E-UKS, BOS, Sarpras, guru, buku kerja) bersifat school-wide dan tidak
 * pernah terpengaruh.
 */
export const CLASS_WIDENING_FAMILIES: readonly string[] = [
  "attendance.dashboard.read",
  "attendance.reports.read",
  "attendance.read",
  "attendance.write",
  "attendance.export",
  "students.profile.read",
  "students.violations.read",
  "students.violations.create",
]

export type ClassScopeInput = {
  readonly subject: AuthorizationSubject
  readonly resource: string
  readonly action: string
  /// Nilai SchoolSetting.allowTeachersAccessAllClasses saat permintaan ini.
  readonly allowTeachersAccessAllClasses: boolean
}

/**
 * Scope kelas efektif setelah memperhitungkan setelan sekolah.
 *
 * Pelebaran hanya terjadi bila SEMUA syarat terpenuhi: setelan menyala,
 * subjek benar-benar record guru (`isTeacher`), keluarga permission-nya
 * termasuk daftar tertutup di atas, dan subjek MEMANG sudah punya permission
 * operasi itu. Setelan tidak pernah memberi permission baru — ia hanya
 * melebarkan yang sudah ada.
 */
export function resolveClassScope(input: ClassScopeInput): ScopeDecision {
  const decision = resolveScope(input.subject, input.resource, input.action)
  if (!decision.allowed) return decision
  if (decision.scope === "all") return decision

  const family = `${input.resource}.${input.action}`
  const widenable =
    input.allowTeachersAccessAllClasses &&
    input.subject.isTeacher &&
    CLASS_WIDENING_FAMILIES.includes(family)

  return widenable ? { allowed: true, scope: "all" } : decision
}

/**
 * Memvalidasi bahwa satu set permission yang akan disimpan ke sebuah role
 * membawa serta dependency yang dideklarasikan registry.
 *
 * Ini validasi KONFIGURASI, bukan aturan runtime: evaluator tidak pernah
 * memberi dependency secara diam-diam. Dipakai saat menyimpan role agar
 * kombinasi yang pasti rusak di UI tertolak lebih awal.
 */
export function findMissingDependencies(keys: readonly string[]): readonly string[] {
  const selected = new Set(keys)
  const missing = new Set<string>()

  for (const key of keys) {
    const permission = getPermission(key)
    if (!permission) continue
    for (const dependency of permission.dependsOn ?? []) {
      if (!selected.has(dependency)) missing.add(dependency)
    }
  }

  return [...missing].sort()
}

/// Key yang tidak dikenal registry, untuk menolak payload UI lebih awal.
export function findUnknownPermissions(keys: readonly string[]): readonly string[] {
  return keys.filter((key) => !isKnownPermission(key))
}
