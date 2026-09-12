/**
 * Pemetaan akses legacy → RBAC dan pemeriksa paritas keputusan.
 *
 * MURNI: tidak mengimpor Prisma. Seluruh aturan di sini diturunkan dari helper
 * legacy yang masih hidup di HEAD (`lib/bos.ts`, `lib/sarpras.ts`,
 * `lib/euks.ts`, `lib/workbook.ts`, `lib/teacher-profile.ts`,
 * `lib/class-access.ts`, `lib/auth-guards.ts`, `auth.ts authorized`) dan
 * inventori di docs/architecture/rbac.md — bukan dari asumsi.
 *
 * Dua hal dipisahkan tegas:
 *   1. `planLegacyUser`   — rencana keanggotaan RBAC untuk satu akun legacy.
 *   2. `compareParity`    — OLD effective decision vs NEW effective decision
 *      per operasi+scope, dilaporkan dua arah (LOST / GAINED).
 *
 * Kompatibilitas memakai BUNDLE tetap (`legacy_*`), bukan template mutable dan
 * bukan satu role per user. Isi bundle beku pada versi ini
 * (LEGACY_MAPPING_VERSION) supaya hasil backfill deterministik dan tidak
 * bergeser bila admin nanti mengedit template.
 */

import {
  CLASS_WIDENING_FAMILIES,
  collectGrants,
  resolveClassScope,
  type AuthorizationSubject,
  type RoleSummary,
} from "@/lib/rbac"
import {
  PERMISSION_KEYS,
  SYSTEM_ADMIN_ROLE_KEY,
  getPermission,
  isKnownPermission,
} from "@/lib/rbac-permissions"

export const LEGACY_MAPPING_VERSION = 1
export const LEGACY_BACKFILL_KEY = "legacy-access-backfill-v1"

// ---------------------------------------------------------------------------
// Bentuk akun legacy
// ---------------------------------------------------------------------------

/// Kolom otorisasi legacy pada User, persis seperti di prisma/schema.prisma.
export const LEGACY_CAPABILITY_FLAGS = [
  "canManageTeacherProfiles",
  "canSuperviseWorkbooks",
  "canViewWorkbookSupervision",
  "canViewBos",
  "canCreateBos",
  "canEditBos",
  "canManageBosCategories",
  "canManageBosAccess",
  "canViewSarpras",
  "canEditSarpras",
  "canViewEuks",
  "canEditEuks",
] as const

export type LegacyCapabilityFlag = (typeof LEGACY_CAPABILITY_FLAGS)[number]

export type LegacyUser = {
  readonly id: string
  readonly role: "ADMIN" | "GURU"
  readonly active: boolean
} & { readonly [K in LegacyCapabilityFlag]: boolean }

// ---------------------------------------------------------------------------
// Bundle kompatibilitas (beku)
// ---------------------------------------------------------------------------

export type CompatibilityBundle = {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly permissionKeys: readonly string[]
}

const BOS_CATEGORY_CREATE_NOTE =
  "HEAD: POST /api/bos/categories dijaga bos.create, sehingga pembuatan kategori ikut bos.entries.create."

/**
 * Bundle beku. Nama key diawali `legacy_` supaya mudah dikenali dan dibersihkan
 * pada fase berikutnya. Setiap bundle memuat dependency read-nya sendiri secara
 * eksplisit karena evaluator tidak mewariskan apa pun.
 */
export const COMPATIBILITY_BUNDLES: readonly CompatibilityBundle[] = [
  {
    key: "legacy_guru",
    name: "Kompatibilitas: Guru",
    description:
      "Perilaku akun GURU sebelum RBAC: absensi/profil/pelanggaran kelas binaan, direktori guru, laporan WhatsApp sekolah, tautan buku kerja sendiri.",
    permissionKeys: [
      "attendance.dashboard.read.assigned_classes",
      "attendance.reports.read.assigned_classes",
      "attendance.read.assigned_classes",
      "attendance.write.assigned_classes",
      "attendance.export.assigned_classes",
      // HEAD: /laporan-whatsapp hanya requireUser() tanpa scope kelas —
      // setiap akun terautentikasi melihat absen harian seluruh kelas.
      "reports.whatsapp.read",
      "students.profile.read.assigned_classes",
      "students.violations.write.assigned_classes",
      "teachers.directory.read",
      "workbook.links.read.own",
      "workbook.links.write.own",
    ],
  },
  {
    key: "legacy_teacher_manager",
    name: "Kompatibilitas: Kelola Profil Guru",
    description: "canManageTeacherProfiles: mengubah kepegawaian, jadwal, dan tugas tambahan guru.",
    permissionKeys: [
      "teachers.directory.read",
      "teachers.profile.write",
      "teachers.duties.write",
      "teachers.schedule.write",
    ],
  },
  {
    key: "legacy_workbook_viewer",
    name: "Kompatibilitas: Lihat Supervisi Buku Kerja",
    description: "canViewWorkbookSupervision.",
    permissionKeys: ["workbook.supervision.read"],
  },
  {
    key: "legacy_workbook_supervisor",
    name: "Kompatibilitas: Supervisi Buku Kerja",
    description: "canSuperviseWorkbooks (menyiratkan lihat).",
    permissionKeys: ["workbook.supervision.read", "workbook.supervision.write"],
  },
  {
    key: "legacy_bos_view",
    name: "Kompatibilitas: Lihat BOS",
    description: "canViewBos.",
    permissionKeys: ["bos.read"],
  },
  {
    key: "legacy_bos_create",
    name: "Kompatibilitas: Tambah Entry BOS",
    description: `canCreateBos (menyiratkan lihat). ${BOS_CATEGORY_CREATE_NOTE}`,
    permissionKeys: ["bos.read", "bos.entries.create"],
  },
  {
    key: "legacy_bos_edit",
    name: "Kompatibilitas: Edit BOS",
    description: "canEditBos (menyiratkan lihat): ubah entry dan anggaran.",
    permissionKeys: ["bos.read", "bos.entries.update", "bos.budget.write"],
  },
  {
    key: "legacy_bos_categories",
    name: "Kompatibilitas: Kelola Kategori BOS",
    description:
      "canManageBosCategories (menyiratkan lihat): mengubah kategori. Tidak memberi pembuatan kategori — di HEAD itu milik bos.create.",
    permissionKeys: ["bos.read", "bos.categories.manage"],
  },
  {
    key: "legacy_bos_access",
    name: "Kompatibilitas: Kelola Akses BOS",
    description: "canManageBosAccess (menyiratkan lihat). Dibatasi ke delegasi BOS pada Phase 4.",
    permissionKeys: ["bos.read", "bos.access.manage"],
  },
  {
    key: "legacy_sarpras_view",
    name: "Kompatibilitas: Lihat Sarpras",
    description: "canViewSarpras: seluruh pembacaan Sarpras termasuk riwayat dan foto.",
    permissionKeys: ["sarpras.read"],
  },
  {
    key: "legacy_sarpras_edit",
    name: "Kompatibilitas: Edit Sarpras",
    description: "canEditSarpras (menyiratkan lihat): CRUD lokasi/jenis/barang dan unggah/hapus foto.",
    permissionKeys: [
      "sarpras.read",
      "sarpras.locations.write",
      "sarpras.item_types.write",
      "sarpras.items.write",
      "sarpras.photos.write",
    ],
  },
  {
    key: "legacy_euks_view",
    name: "Kompatibilitas: Lihat E-UKS",
    description:
      "canViewEuks: profil unit, kunjungan, pantauan kesehatan, dan aset (pengurus/fasilitas/foto). Bukan pengaturan.",
    permissionKeys: ["euks.overview.read", "euks.visits.read", "euks.monitoring.read"],
  },
  {
    key: "legacy_euks_edit",
    name: "Kompatibilitas: Edit E-UKS",
    description:
      "canEditEuks (menyiratkan lihat): kunjungan (buat/ubah/hapus), pengukuran (buat/hapus), tindak lanjut absen sakit, baca opsi keluhan.",
    permissionKeys: [
      "euks.overview.read",
      "euks.visits.read",
      "euks.monitoring.read",
      "euks.visits.write",
      "euks.measurements.write",
      "euks.sick_absences.write",
      "euks.complaint_options.read",
    ],
  },
]

export function getCompatibilityBundle(key: string): CompatibilityBundle | undefined {
  return COMPATIBILITY_BUNDLES.find((bundle) => bundle.key === key)
}

/// Flag legacy → bundle yang mereproduksi perilakunya. Setiap flag WAJIB ada.
export const FLAG_TO_BUNDLE: Readonly<Record<LegacyCapabilityFlag, string>> = {
  canManageTeacherProfiles: "legacy_teacher_manager",
  canSuperviseWorkbooks: "legacy_workbook_supervisor",
  canViewWorkbookSupervision: "legacy_workbook_viewer",
  canViewBos: "legacy_bos_view",
  canCreateBos: "legacy_bos_create",
  canEditBos: "legacy_bos_edit",
  canManageBosCategories: "legacy_bos_categories",
  canManageBosAccess: "legacy_bos_access",
  canViewSarpras: "legacy_sarpras_view",
  canEditSarpras: "legacy_sarpras_edit",
  canViewEuks: "legacy_euks_view",
  canEditEuks: "legacy_euks_edit",
}

// ---------------------------------------------------------------------------
// Rencana per akun
// ---------------------------------------------------------------------------

export class UnknownLegacyCapabilityError extends Error {
  constructor(readonly userId: string, readonly capability: string) {
    super(
      `Akun ${userId} memiliki kapabilitas legacy "${capability}" yang tidak punya pemetaan RBAC. ` +
        `Tambahkan pemetaan pada FLAG_TO_BUNDLE di lib/rbac-legacy.ts lalu naikkan LEGACY_MAPPING_VERSION. ` +
        `Backfill dibatalkan; tidak ada fallback ke system_admin.`,
    )
    this.name = "UnknownLegacyCapabilityError"
  }
}

export type LegacyUserPlan = {
  readonly userId: string
  /// Role key yang harus dimiliki akun ini setelah backfill.
  readonly roleKeys: readonly string[]
  /// Identitas bisnis guru (populasi kompatibilitas, lihat catatan di bawah).
  readonly isTeacher: boolean
}

/**
 * Menyusun rencana keanggotaan untuk satu akun legacy.
 *
 * - ADMIN → `system_admin`. Semua admin, bukan satu; tidak dipilih berdasarkan
 *   email/nama. Legacy ADMIN juga ikut bundle guru karena di HEAD ia memang
 *   melewati setiap guard guru (bypass) — bundle ini tidak menambah apa pun
 *   di atas bypass, tetapi menjaga hak tetap ada jika keanggotaan
 *   `system_admin` kelak dicabut secara sadar oleh admin lain.
 * - GURU → `legacy_guru`.
 * - Setiap flag true → bundle-nya. Flag yang tidak dikenal (kolom baru tanpa
 *   pemetaan) menghentikan proses, tidak pernah dipetakan ke admin.
 * - `isTeacher` = true untuk ADMIN dan GURU: di HEAD populasi guru (direktori,
 *   supervisi, daftar akses) memilih `role IN (ADMIN, GURU)`, jadi ini
 *   kompatibilitas populasi, bukan klaim bahwa tiap admin sungguh guru.
 *
 * Akun nonaktif tetap direncanakan sama; `active` tidak disentuh, dan guard
 * tetap menolak akun nonaktif, sehingga bila diaktifkan lagi hak legacy-nya
 * sudah tersedia.
 */
export function planLegacyUser(user: LegacyUser): LegacyUserPlan {
  const roleKeys: string[] = []

  if (user.role === "ADMIN") {
    roleKeys.push(SYSTEM_ADMIN_ROLE_KEY)
    roleKeys.push("legacy_guru")
  } else if (user.role === "GURU") {
    roleKeys.push("legacy_guru")
  } else {
    throw new UnknownLegacyCapabilityError(user.id, `role=${String(user.role)}`)
  }

  for (const flag of Object.keys(user)) {
    if (!isLegacyCapabilityFlagName(flag)) continue
    if (user[flag] !== true) continue
    const bundle = FLAG_TO_BUNDLE[flag]
    if (!bundle || !getCompatibilityBundle(bundle)) {
      throw new UnknownLegacyCapabilityError(user.id, flag)
    }
    if (!roleKeys.includes(bundle)) roleKeys.push(bundle)
  }

  return { userId: user.id, roleKeys, isTeacher: true }
}

function isLegacyCapabilityFlagName(name: string): name is LegacyCapabilityFlag {
  return (LEGACY_CAPABILITY_FLAGS as readonly string[]).includes(name)
}

/**
 * Menemukan kolom boolean `can*` pada baris User yang belum punya pemetaan.
 * Dipanggil tooling sebelum apa pun ditulis, supaya kolom kapabilitas baru
 * yang ditambahkan tanpa memperbarui pemetaan membatalkan backfill lebih awal.
 */
export function findUnmappedCapabilityColumns(columnNames: readonly string[]): readonly string[] {
  return columnNames.filter(
    (name) => /^can[A-Z]/.test(name) && !isLegacyCapabilityFlagName(name),
  )
}

// ---------------------------------------------------------------------------
// Keputusan efektif LEGACY
// ---------------------------------------------------------------------------

export type EffectiveScope = "all" | "assigned_classes" | "own"

/// Satu keputusan efektif: permission `key` diberikan dengan scope tertentu
/// (scope kosong untuk permission tak berskala).
export type EffectiveDecision = {
  readonly key: string
  readonly scope: EffectiveScope | null
}

export type LegacyDecisionContext = {
  readonly allowTeachersAccessAllClasses: boolean
}

/**
 * Keputusan efektif yang diberikan sistem LAMA kepada satu akun, dihitung
 * langsung dari helper legacy (bukan dari bundle) supaya paritas benar-benar
 * membandingkan dua implementasi yang berbeda.
 *
 * Akun nonaktif: `requireUser()` lama menolak, jadi tidak ada keputusan.
 */
export function legacyEffectiveDecisions(
  user: LegacyUser,
  context: LegacyDecisionContext,
): ReadonlySet<string> {
  const out = new Set<string>()
  if (!user.active) return out

  const add = (key: string, scope: EffectiveScope | null = null) => {
    out.add(encodeDecision({ key, scope }))
  }

  if (user.role === "ADMIN") {
    // lib/auth-guards.ts requireAdmin + setiap helper "ADMIN always passes"
    // + getClassAccess → allClasses. Semua key katalog, scope terlebar.
    for (const key of PERMISSION_KEYS) {
      const definition = getPermission(key)
      if (!definition) continue
      if (definition.scope === "all" || definition.scope === "assigned_classes") {
        add(`${definition.resource}.${definition.action}`, "all")
      } else if (definition.scope === "own") {
        add(key, "own")
      } else {
        add(key)
      }
    }
    return out
  }

  // ---- GURU ----------------------------------------------------------------
  // lib/class-access.ts: setting global melebarkan ke semua kelas.
  const classScope: EffectiveScope = context.allowTeachersAccessAllClasses
    ? "all"
    : "assigned_classes"
  for (const family of CLASS_WIDENING_FAMILIES) add(family, classScope)

  // /laporan-whatsapp: requireUser saja.
  add("reports.whatsapp.read")
  // /guru/direktori, /guru/[id], foto guru: requireUser saja.
  add("teachers.directory.read")
  // /api/workbooks/links: own id.
  add("workbook.links.read.own", "own")
  add("workbook.links.write.own", "own")

  // lib/teacher-profile.ts canManageTeacherProfile
  if (user.canManageTeacherProfiles) {
    add("teachers.profile.write")
    add("teachers.duties.write")
    add("teachers.schedule.write")
  }

  // lib/workbook.ts
  const supervise = user.canSuperviseWorkbooks
  if (supervise || user.canViewWorkbookSupervision) add("workbook.supervision.read")
  if (supervise) add("workbook.supervision.write")

  // lib/bos.ts hasBosPermission: any right implies bos.view
  const bosAny =
    user.canViewBos ||
    user.canCreateBos ||
    user.canEditBos ||
    user.canManageBosCategories ||
    user.canManageBosAccess
  if (bosAny) add("bos.read")
  if (user.canCreateBos) add("bos.entries.create")
  if (user.canEditBos) {
    add("bos.entries.update")
    add("bos.budget.write")
  }
  if (user.canManageBosCategories) add("bos.categories.manage")
  if (user.canManageBosAccess) add("bos.access.manage")

  // lib/sarpras.ts: edit implies view
  if (user.canViewSarpras || user.canEditSarpras) add("sarpras.read")
  if (user.canEditSarpras) {
    add("sarpras.locations.write")
    add("sarpras.item_types.write")
    add("sarpras.items.write")
    add("sarpras.photos.write")
  }

  // lib/euks.ts: edit implies view
  if (user.canViewEuks || user.canEditEuks) {
    add("euks.overview.read")
    add("euks.visits.read")
    add("euks.monitoring.read")
  }
  if (user.canEditEuks) {
    add("euks.visits.write")
    add("euks.measurements.write")
    add("euks.sick_absences.write")
    add("euks.complaint_options.read")
  }

  return out
}

// ---------------------------------------------------------------------------
// Keputusan efektif BARU
// ---------------------------------------------------------------------------

export type ResolvedRole = RoleSummary

/**
 * Keputusan efektif yang diberikan sistem BARU kepada satu subjek, dihitung
 * lewat evaluator Phase 2 (union role → grants → scope per operasi, termasuk
 * pelebaran kelas yang bergantung pada isTeacher).
 */
export function rbacEffectiveDecisions(
  subject: AuthorizationSubject,
  active: boolean,
  context: LegacyDecisionContext,
): ReadonlySet<string> {
  const out = new Set<string>()
  if (!active) return out

  const isAdmin = subject.roles.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY)
  const grants = isAdmin ? new Set(PERMISSION_KEYS) : collectGrants(subject)

  // Permission tanpa scope dan scope own: langsung.
  for (const key of grants) {
    const definition = getPermission(key)
    if (!definition) continue
    if (!definition.scope) out.add(encodeDecision({ key, scope: null }))
    else if (definition.scope === "own") out.add(encodeDecision({ key, scope: "own" }))
  }

  // Permission berskala kelas: satu keputusan per keluarga operasi.
  const families = new Set<string>()
  for (const key of grants) {
    const definition = getPermission(key)
    if (definition?.scope === "assigned_classes" || definition?.scope === "all") {
      families.add(`${definition.resource}.${definition.action}`)
    }
  }
  for (const family of families) {
    const lastDot = family.lastIndexOf(".")
    const resource = family.slice(0, lastDot)
    const action = family.slice(lastDot + 1)
    const decision = resolveClassScope({
      subject,
      resource,
      action,
      allowTeachersAccessAllClasses: context.allowTeachersAccessAllClasses,
    })
    if (decision.allowed) out.add(encodeDecision({ key: family, scope: decision.scope }))
  }

  return out
}

// ---------------------------------------------------------------------------
// Paritas
// ---------------------------------------------------------------------------

export type ParityDelta = {
  readonly userId: string
  readonly decision: string
}

export type ParityReport = {
  readonly usersCompared: number
  /// Keputusan yang dimiliki sistem lama tetapi tidak oleh sistem baru.
  readonly lost: readonly ParityDelta[]
  /// Keputusan yang dimiliki sistem baru tetapi tidak oleh sistem lama.
  readonly gained: readonly ParityDelta[]
  /**
   * Perbedaan yang DISENGAJA dan dicatat terpisah — bukan disamarkan sebagai
   * paritas. Tidak menghasilkan LOST/GAINED karena tidak ada keputusan
   * permission yang berubah pada tingkat ini.
   */
  readonly intentionalDeltas: readonly string[]
}

export const INTENTIONAL_SECURITY_DELTAS: readonly string[] = [
  "Otoritas permission dibaca dari database pada tiap permintaan; JWT lama yang masih memuat role/kapabilitas tidak lagi dipercaya (menutup TD-008).",
  "Akun nonaktif memperoleh keanggotaan role potensial, tetapi tetap ditolak selama active=false.",
  "Legacy ADMIN dipetakan ke system_admin (bypass berbasis key) plus bundle legacy_guru; bypass tidak tersalin bila role dikloning.",
  "isTeacher=true untuk seluruh ADMIN dan GURU adalah kompatibilitas populasi (HEAD memilih role IN (ADMIN, GURU) sebagai guru), bukan klaim identitas nyata.",
]

export function compareParity(
  users: readonly {
    readonly legacy: LegacyUser
    readonly subject: AuthorizationSubject
  }[],
  context: LegacyDecisionContext,
): ParityReport {
  const lost: ParityDelta[] = []
  const gained: ParityDelta[] = []

  for (const { legacy, subject } of users) {
    const before = legacyEffectiveDecisions(legacy, context)
    const after = rbacEffectiveDecisions(subject, legacy.active, context)
    for (const decision of before) {
      if (!after.has(decision)) lost.push({ userId: legacy.id, decision })
    }
    for (const decision of after) {
      if (!before.has(decision)) gained.push({ userId: legacy.id, decision })
    }
  }

  return {
    usersCompared: users.length,
    lost,
    gained,
    intentionalDeltas: INTENTIONAL_SECURITY_DELTAS,
  }
}

/// Membangun subjek RBAC dari rencana + katalog bundle, tanpa database.
/// Dipakai untuk paritas pra-tulis (dry-run) dan oleh test.
export function subjectFromPlan(plan: LegacyUserPlan): AuthorizationSubject {
  const roles: RoleSummary[] = plan.roleKeys.map((key) => {
    const bundle = getCompatibilityBundle(key)
    return {
      id: `plan:${key}`,
      key,
      name: bundle?.name ?? key,
      permissionKeys: bundle?.permissionKeys ?? [],
    }
  })
  return { userId: plan.userId, roles, isTeacher: plan.isTeacher }
}

export function encodeDecision(decision: EffectiveDecision): string {
  return decision.scope ? `${decision.key}@${decision.scope}` : decision.key
}

/// Validasi statis bundle: hanya key registry, tanpa dependency yang hilang.
export function validateCompatibilityBundles(): readonly string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const bundle of COMPATIBILITY_BUNDLES) {
    if (seen.has(bundle.key)) problems.push(`bundle ganda: ${bundle.key}`)
    seen.add(bundle.key)
    if (!bundle.key.startsWith("legacy_")) problems.push(`bundle tanpa awalan legacy_: ${bundle.key}`)
    for (const key of bundle.permissionKeys) {
      if (!isKnownPermission(key)) problems.push(`${bundle.key} memakai key tak dikenal: ${key}`)
      for (const dependency of getPermission(key)?.dependsOn ?? []) {
        if (!bundle.permissionKeys.includes(dependency)) {
          problems.push(`${bundle.key}: ${key} membutuhkan ${dependency}`)
        }
      }
    }
  }
  for (const flag of LEGACY_CAPABILITY_FLAGS) {
    if (!getCompatibilityBundle(FLAG_TO_BUNDLE[flag])) problems.push(`flag tanpa bundle: ${flag}`)
  }
  return problems
}
