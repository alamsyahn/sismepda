/**
 * Katalog permission yang benar-benar didukung kode.
 *
 * CLIENT-SAFE: berkas ini tidak mengimpor Prisma, `lib/prisma.ts`, maupun modul
 * server mana pun, sehingga komponen klien boleh mengimpornya sebagai value
 * tanpa memecah bundel (lihat catatan boundary di docs/architecture/overview.md).
 *
 * Registry ini adalah otoritas atas *key mana yang ada*. Database menyimpan
 * cerminannya, tetapi kunci yang tidak terdaftar di sini tidak pernah bisa
 * lolos pengecekan — termasuk untuk system admin. UI tidak pernah boleh
 * mengarang key; ia hanya memilih dari katalog ini.
 */

/// Scope mempersempit permission ke subset data. `null`/absen berarti
/// permission tidak berskala (school-wide) — BUKAN berarti "semua scope".
export const PERMISSION_SCOPES = ["assigned_classes", "all", "own"] as const

export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

export type PermissionModule =
  | "attendance"
  | "students"
  | "teachers"
  | "homerooms"
  | "workbook"
  | "bos"
  | "sarpras"
  | "euks"
  | "school"
  | "database"
  | "rbac"

export type PermissionDefinition = {
  /// `resource.action` atau `resource.action.scope` — selalu gabungan dari
  /// ketiga kolom di bawah, tidak pernah ditulis lepas.
  readonly key: string
  readonly resource: string
  readonly action: string
  readonly scope?: PermissionScope
  readonly module: PermissionModule
  readonly label: string
  readonly description?: string
  /**
   * Permission pendukung yang memang dibutuhkan operasi ini agar berfungsi di
   * UI. Sengaja sempit: hanya dicantumkan bila layar/endpoint-nya benar-benar
   * memanggil surface lain. Dependency TIDAK diberikan diam-diam oleh
   * evaluator — ini metadata untuk memvalidasi konfigurasi role, bukan aturan
   * pewarisan runtime.
   */
  readonly dependsOn?: readonly string[]
  /**
   * Menandai permission yang berdampak luas (menyentuh seluruh data sekolah,
   * mengubah siapa yang punya akses, atau menyentuh berkas database). Dipakai
   * UI untuk memberi peringatan tambahan; tidak mengubah keputusan evaluator.
   */
  readonly sensitive?: boolean
}

function def(definition: PermissionDefinition): PermissionDefinition {
  return definition
}

/**
 * Katalog lengkap. Urutan mengikuti modul agar mudah dibandingkan dengan
 * inventori otorisasi di docs/architecture/rbac.md.
 */
export const PERMISSIONS: readonly PermissionDefinition[] = [
  // --- attendance ---------------------------------------------------------
  def({
    key: "attendance.dashboard.read.assigned_classes",
    resource: "attendance.dashboard",
    action: "read",
    scope: "assigned_classes",
    module: "attendance",
    label: "Lihat dashboard absensi (kelas binaan)",
  }),
  def({
    key: "attendance.dashboard.read.all",
    resource: "attendance.dashboard",
    action: "read",
    scope: "all",
    module: "attendance",
    label: "Lihat dashboard absensi (semua kelas)",
    sensitive: true,
  }),
  def({
    key: "attendance.reports.read.assigned_classes",
    resource: "attendance.reports",
    action: "read",
    scope: "assigned_classes",
    module: "attendance",
    label: "Lihat rekap absensi (kelas binaan)",
  }),
  def({
    key: "attendance.reports.read.all",
    resource: "attendance.reports",
    action: "read",
    scope: "all",
    module: "attendance",
    label: "Lihat rekap absensi (semua kelas)",
    sensitive: true,
  }),
  def({
    key: "attendance.read.assigned_classes",
    resource: "attendance",
    action: "read",
    scope: "assigned_classes",
    module: "attendance",
    label: "Lihat daftar hadir (kelas binaan)",
  }),
  def({
    key: "attendance.read.all",
    resource: "attendance",
    action: "read",
    scope: "all",
    module: "attendance",
    label: "Lihat daftar hadir (semua kelas)",
    sensitive: true,
  }),
  def({
    key: "attendance.write.assigned_classes",
    resource: "attendance",
    action: "write",
    scope: "assigned_classes",
    module: "attendance",
    label: "Isi absensi (kelas binaan)",
    // Layar input memuat roster lewat GET /api/attendance sebelum menyimpan.
    dependsOn: ["attendance.read.assigned_classes"],
  }),
  def({
    key: "attendance.write.all",
    resource: "attendance",
    action: "write",
    scope: "all",
    module: "attendance",
    label: "Isi absensi (semua kelas)",
    dependsOn: ["attendance.read.all"],
    sensitive: true,
  }),
  def({
    key: "attendance.export.assigned_classes",
    resource: "attendance",
    action: "export",
    scope: "assigned_classes",
    module: "attendance",
    label: "Ekspor absensi (kelas binaan)",
  }),
  def({
    key: "attendance.export.all",
    resource: "attendance",
    action: "export",
    scope: "all",
    module: "attendance",
    label: "Ekspor absensi (semua kelas)",
    sensitive: true,
  }),
  def({
    // School-wide secara desain: laporan ini selalu merangkum seluruh kelas,
    // sehingga tidak ada varian assigned_classes yang jujur untuknya.
    key: "reports.whatsapp.read.all",
    resource: "reports.whatsapp",
    action: "read",
    scope: "all",
    module: "attendance",
    label: "Lihat laporan WhatsApp (semua kelas)",
    sensitive: true,
  }),

  // --- students -----------------------------------------------------------
  def({
    key: "students.master.read",
    resource: "students.master",
    action: "read",
    module: "students",
    label: "Lihat data induk siswa",
    sensitive: true,
  }),
  def({
    key: "students.master.create",
    resource: "students.master",
    action: "create",
    module: "students",
    label: "Tambah siswa baru (satuan)",
    dependsOn: ["students.master.read"],
    sensitive: true,
  }),
  def({
    key: "students.master.update",
    resource: "students.master",
    action: "update",
    module: "students",
    label: "Ubah data induk siswa",
    dependsOn: ["students.master.read"],
    sensitive: true,
  }),
  def({
    // Dipisah dari create satuan: impor menulis banyak baris sekaligus dan
    // dapat menimpa data lewat berkas, sehingga kewenangannya berbeda.
    key: "students.master.import",
    resource: "students.master",
    action: "import",
    module: "students",
    label: "Impor data siswa massal",
    dependsOn: ["students.master.read"],
    sensitive: true,
  }),
  def({
    key: "students.master.delete",
    resource: "students.master",
    action: "delete",
    module: "students",
    label: "Hapus data induk siswa",
    dependsOn: ["students.master.read"],
    sensitive: true,
  }),
  def({
    key: "students.master.export",
    resource: "students.master",
    action: "export",
    module: "students",
    label: "Ekspor data induk siswa",
    sensitive: true,
  }),
  def({
    key: "students.profile.read.assigned_classes",
    resource: "students.profile",
    action: "read",
    scope: "assigned_classes",
    module: "students",
    label: "Lihat profil siswa (kelas binaan)",
  }),
  def({
    key: "students.profile.read.all",
    resource: "students.profile",
    action: "read",
    scope: "all",
    module: "students",
    label: "Lihat profil siswa (semua kelas)",
    sensitive: true,
  }),
  def({
    key: "students.violations.read.assigned_classes",
    resource: "students.violations",
    action: "read",
    scope: "assigned_classes",
    module: "students",
    label: "Lihat poin pelanggaran (kelas binaan)",
    dependsOn: ["students.profile.read.assigned_classes"],
  }),
  def({
    key: "students.violations.read.all",
    resource: "students.violations",
    action: "read",
    scope: "all",
    module: "students",
    label: "Lihat poin pelanggaran (semua kelas)",
    dependsOn: ["students.profile.read.all"],
    sensitive: true,
  }),
  def({
    // Sumbernya hanya menyediakan pencatatan; tidak ada endpoint ubah/hapus,
    // jadi tidak ada key update/delete yang dikarang di sini.
    key: "students.violations.create.assigned_classes",
    resource: "students.violations",
    action: "create",
    scope: "assigned_classes",
    module: "students",
    label: "Catat poin pelanggaran (kelas binaan)",
    dependsOn: ["students.violations.read.assigned_classes"],
  }),
  def({
    key: "students.violations.create.all",
    resource: "students.violations",
    action: "create",
    scope: "all",
    module: "students",
    label: "Catat poin pelanggaran (semua kelas)",
    dependsOn: ["students.violations.read.all"],
    sensitive: true,
  }),

  // --- teachers -----------------------------------------------------------
  def({
    key: "teachers.accounts.read",
    resource: "teachers.accounts",
    action: "read",
    module: "teachers",
    label: "Lihat akun guru",
    sensitive: true,
  }),
  def({
    key: "teachers.accounts.create",
    resource: "teachers.accounts",
    action: "create",
    module: "teachers",
    label: "Buat akun guru",
    dependsOn: ["teachers.accounts.read"],
    sensitive: true,
  }),
  def({
    key: "teachers.accounts.update",
    resource: "teachers.accounts",
    action: "update",
    module: "teachers",
    label: "Ubah data akun guru",
    dependsOn: ["teachers.accounts.read"],
    sensitive: true,
  }),
  def({
    key: "teachers.accounts.delete",
    resource: "teachers.accounts",
    action: "delete",
    module: "teachers",
    label: "Hapus akun guru",
    dependsOn: ["teachers.accounts.read"],
    sensitive: true,
  }),
  def({
    key: "teachers.accounts.export",
    resource: "teachers.accounts",
    action: "export",
    module: "teachers",
    label: "Ekspor akun guru",
    sensitive: true,
  }),
  def({
    key: "teachers.directory.read",
    resource: "teachers.directory",
    action: "read",
    module: "teachers",
    label: "Lihat direktori guru",
  }),
  def({
    key: "teachers.profile.read",
    resource: "teachers.profile",
    action: "read",
    module: "teachers",
    label: "Lihat profil kepegawaian guru",
    dependsOn: ["teachers.directory.read"],
  }),
  def({
    key: "teachers.profile.update",
    resource: "teachers.profile",
    action: "update",
    module: "teachers",
    label: "Ubah profil kepegawaian guru",
    dependsOn: ["teachers.profile.read"],
  }),
  def({
    key: "teachers.duties.manage",
    resource: "teachers.duties",
    action: "manage",
    module: "teachers",
    label: "Kelola tugas tambahan guru",
    dependsOn: ["teachers.directory.read"],
  }),
  def({
    key: "teachers.schedule.manage",
    resource: "teachers.schedule",
    action: "manage",
    module: "teachers",
    label: "Kelola jadwal mengajar guru",
    dependsOn: ["teachers.directory.read"],
  }),

  // --- accounts (kewenangan identitas lintas-modul) ------------------------
  def({
    // Dipisah dari teachers.accounts.update: mengubah sandi/e-mail berarti
    // dapat mengambil alih akun, sehingga tidak boleh ikut dalam kewenangan
    // menyunting profil biasa.
    key: "accounts.credentials.manage",
    resource: "accounts.credentials",
    action: "manage",
    module: "teachers",
    label: "Reset sandi & ubah identitas login",
    dependsOn: ["teachers.accounts.read"],
    sensitive: true,
  }),
  def({
    key: "accounts.status.manage",
    resource: "accounts.status",
    action: "manage",
    module: "teachers",
    label: "Aktif/nonaktifkan akun",
    dependsOn: ["teachers.accounts.read"],
    sensitive: true,
  }),

  // --- homerooms ----------------------------------------------------------
  def({
    key: "homerooms.read",
    resource: "homerooms",
    action: "read",
    module: "homerooms",
    label: "Lihat penugasan wali kelas",
  }),
  def({
    // Sensitif: menetapkan wali kelas mengubah SIAPA yang punya akses ke kelas
    // itu, sehingga ia adalah kewenangan yang memberi akses, bukan sekadar
    // penyuntingan data.
    key: "homerooms.assign",
    resource: "homerooms",
    action: "assign",
    module: "homerooms",
    label: "Tetapkan/lepas wali kelas",
    dependsOn: ["homerooms.read"],
    sensitive: true,
  }),
  def({
    key: "homerooms.export",
    resource: "homerooms",
    action: "export",
    module: "homerooms",
    label: "Ekspor penugasan wali kelas",
  }),

  // --- workbook -----------------------------------------------------------
  def({
    key: "workbook.links.read.own",
    resource: "workbook.links",
    action: "read",
    scope: "own",
    module: "workbook",
    label: "Lihat tautan buku kerja sendiri",
  }),
  def({
    key: "workbook.links.update.own",
    resource: "workbook.links",
    action: "update",
    scope: "own",
    module: "workbook",
    label: "Ubah tautan buku kerja sendiri",
    dependsOn: ["workbook.links.read.own"],
  }),
  def({
    key: "workbook.supervision.read",
    resource: "workbook.supervision",
    action: "read",
    module: "workbook",
    label: "Lihat supervisi buku kerja",
  }),
  def({
    key: "workbook.supervision.review",
    resource: "workbook.supervision",
    action: "review",
    module: "workbook",
    label: "Nilai supervisi buku kerja",
    dependsOn: ["workbook.supervision.read"],
  }),
  def({
    key: "workbook.scope.manage",
    resource: "workbook.scope",
    action: "manage",
    module: "workbook",
    label: "Atur cakupan supervisi buku kerja",
    dependsOn: ["workbook.supervision.read"],
    sensitive: true,
  }),

  // --- bos ----------------------------------------------------------------
  def({
    key: "bos.read",
    resource: "bos",
    action: "read",
    module: "bos",
    label: "Lihat modul BOS",
  }),
  def({
    key: "bos.entries.create",
    resource: "bos.entries",
    action: "create",
    module: "bos",
    label: "Tambah realisasi BOS",
    dependsOn: ["bos.read"],
  }),
  def({
    key: "bos.entries.update",
    resource: "bos.entries",
    action: "update",
    module: "bos",
    label: "Ubah realisasi BOS",
    dependsOn: ["bos.read"],
  }),
  def({
    key: "bos.budget.write",
    resource: "bos.budget",
    action: "write",
    module: "bos",
    label: "Ubah anggaran BOS",
    dependsOn: ["bos.read"],
    sensitive: true,
  }),
  def({
    key: "bos.categories.manage",
    resource: "bos.categories",
    action: "manage",
    module: "bos",
    label: "Kelola kategori BOS",
    dependsOn: ["bos.read"],
  }),
  def({
    key: "bos.access.manage",
    resource: "bos.access",
    action: "manage",
    module: "bos",
    label: "Kelola akses BOS (legacy)",
    description: "Digantikan rbac.assignments.manage setelah migrasi selesai.",
    dependsOn: ["bos.read"],
    sensitive: true,
  }),

  // --- sarpras ------------------------------------------------------------
  def({
    key: "sarpras.read",
    resource: "sarpras",
    action: "read",
    module: "sarpras",
    label: "Lihat modul Sarpras",
  }),
  def({
    key: "sarpras.locations.write",
    resource: "sarpras.locations",
    action: "write",
    module: "sarpras",
    label: "Kelola lokasi Sarpras",
    dependsOn: ["sarpras.read"],
  }),
  def({
    key: "sarpras.item_types.write",
    resource: "sarpras.item_types",
    action: "write",
    module: "sarpras",
    label: "Kelola jenis barang Sarpras",
    dependsOn: ["sarpras.read"],
  }),
  def({
    key: "sarpras.items.write",
    resource: "sarpras.items",
    action: "write",
    module: "sarpras",
    label: "Kelola barang Sarpras",
    dependsOn: ["sarpras.read"],
  }),
  def({
    key: "sarpras.photos.write",
    resource: "sarpras.photos",
    action: "write",
    module: "sarpras",
    label: "Kelola foto Sarpras",
    dependsOn: ["sarpras.read"],
  }),
  def({
    key: "sarpras.access.manage",
    resource: "sarpras.access",
    action: "manage",
    module: "sarpras",
    label: "Kelola akses Sarpras (legacy)",
    description: "Digantikan rbac.assignments.manage setelah migrasi selesai.",
    dependsOn: ["sarpras.read"],
    sensitive: true,
  }),

  // --- euks ---------------------------------------------------------------
  def({
    key: "euks.overview.read",
    resource: "euks.overview",
    action: "read",
    module: "euks",
    label: "Lihat Halaman Utama E-UKS",
  }),
  def({
    key: "euks.visits.read",
    resource: "euks.visits",
    action: "read",
    module: "euks",
    label: "Lihat riwayat kunjungan UKS",
  }),
  def({
    key: "euks.visits.write",
    resource: "euks.visits",
    action: "write",
    module: "euks",
    label: "Catat/ubah kunjungan UKS",
    // Form kunjungan memuat daftar keluhan siap-pilih. Sengaja TIDAK
    // menyertakan students.master.read: selector hanya butuh identitas minimal
    // siswa, bukan seluruh data induk.
    dependsOn: ["euks.visits.read", "euks.complaint_options.read"],
  }),
  def({
    key: "euks.monitoring.read",
    resource: "euks.monitoring",
    action: "read",
    module: "euks",
    label: "Lihat pantauan kesehatan",
  }),
  def({
    key: "euks.measurements.write",
    resource: "euks.measurements",
    action: "write",
    module: "euks",
    label: "Catat pengukuran tinggi/berat",
    dependsOn: ["euks.monitoring.read"],
  }),
  def({
    key: "euks.sick_absences.write",
    resource: "euks.sick_absences",
    action: "write",
    module: "euks",
    label: "Isi tindak lanjut absensi sakit",
    dependsOn: ["euks.monitoring.read"],
  }),
  def({
    key: "euks.complaint_options.read",
    resource: "euks.complaint_options",
    action: "read",
    module: "euks",
    label: "Lihat pilihan keluhan",
  }),
  def({
    key: "euks.complaint_options.manage",
    resource: "euks.complaint_options",
    action: "manage",
    module: "euks",
    label: "Kelola pilihan keluhan",
    dependsOn: ["euks.complaint_options.read"],
  }),
  def({
    key: "euks.profile.manage",
    resource: "euks.profile",
    action: "manage",
    module: "euks",
    label: "Kelola identitas UKS",
    dependsOn: ["euks.overview.read"],
  }),
  def({
    key: "euks.officers.manage",
    resource: "euks.officers",
    action: "manage",
    module: "euks",
    label: "Kelola pengurus UKS",
    dependsOn: ["euks.overview.read"],
  }),
  def({
    key: "euks.facilities.manage",
    resource: "euks.facilities",
    action: "manage",
    module: "euks",
    label: "Kelola fasilitas UKS",
    dependsOn: ["euks.overview.read"],
  }),
  def({
    key: "euks.hero_images.manage",
    resource: "euks.hero_images",
    action: "manage",
    module: "euks",
    label: "Kelola foto hero E-UKS",
    dependsOn: ["euks.overview.read"],
  }),
  def({
    key: "euks.hero_logos.manage",
    resource: "euks.hero_logos",
    action: "manage",
    module: "euks",
    label: "Kelola logo institusi E-UKS",
    dependsOn: ["euks.overview.read"],
  }),

  // --- school -------------------------------------------------------------
  def({
    key: "school.settings.read",
    resource: "school.settings",
    action: "read",
    module: "school",
    label: "Lihat pengaturan sekolah",
  }),
  def({
    key: "school.settings.write",
    resource: "school.settings",
    action: "write",
    module: "school",
    label: "Ubah pengaturan sekolah",
    dependsOn: ["school.settings.read"],
    sensitive: true,
  }),
  def({
    key: "school.class_access.write",
    resource: "school.class_access",
    action: "write",
    module: "school",
    label: "Ubah akses guru ke semua kelas",
    description:
      "Mengendalikan allowTeachersAccessAllClasses, yang melebarkan scope kelas binaan.",
    dependsOn: ["school.settings.read"],
    sensitive: true,
  }),
  def({
    key: "school.branding.write",
    resource: "school.branding",
    action: "write",
    module: "school",
    label: "Ubah identitas visual aplikasi",
    dependsOn: ["school.settings.read"],
  }),
  def({
    key: "school.holidays.read",
    resource: "school.holidays",
    action: "read",
    module: "school",
    label: "Lihat kalender libur",
  }),
  def({
    key: "school.holidays.write",
    resource: "school.holidays",
    action: "write",
    module: "school",
    label: "Ubah kalender libur",
    dependsOn: ["school.holidays.read"],
  }),
  def({
    key: "school.holidays.export",
    resource: "school.holidays",
    action: "export",
    module: "school",
    label: "Ekspor kalender libur",
  }),

  // --- database -----------------------------------------------------------
  def({
    key: "database.backup",
    resource: "database",
    action: "backup",
    module: "database",
    label: "Unduh cadangan database",
    sensitive: true,
  }),
  def({
    key: "database.restore",
    resource: "database",
    action: "restore",
    module: "database",
    label: "Pulihkan database",
    sensitive: true,
  }),

  // --- rbac ---------------------------------------------------------------
  def({
    key: "accounts.read",
    resource: "accounts",
    action: "read",
    module: "rbac",
    label: "Lihat daftar akun",
    sensitive: true,
  }),
  def({
    key: "rbac.roles.read",
    resource: "rbac.roles",
    action: "read",
    module: "rbac",
    label: "Lihat role dan permission",
  }),
  def({
    key: "rbac.roles.manage",
    resource: "rbac.roles",
    action: "manage",
    module: "rbac",
    label: "Kelola role dan isinya",
    dependsOn: ["rbac.roles.read"],
    sensitive: true,
  }),
  def({
    key: "rbac.assignments.manage",
    resource: "rbac.assignments",
    action: "manage",
    module: "rbac",
    label: "Berikan/cabut role pengguna",
    dependsOn: ["rbac.roles.read", "accounts.read"],
    sensitive: true,
  }),
  def({
    key: "rbac.audit.read",
    resource: "rbac.audit",
    action: "read",
    module: "rbac",
    label: "Lihat jejak audit RBAC",
    sensitive: true,
  }),
] as const

/// Key role system admin. Satu-satunya bypass, dan ditentukan oleh key ini —
/// bukan oleh nama tampilan maupun oleh flag `isProtected` yang bisa ikut
/// tersalin saat role diduplikasi.
export const SYSTEM_ADMIN_ROLE_KEY = "system_admin"

/// Key yang tidak boleh dipakai role buatan pengguna.
export const RESERVED_ROLE_KEYS: readonly string[] = [SYSTEM_ADMIN_ROLE_KEY]

const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSIONS.map((permission) => [permission.key, permission]),
)

/// Semua key yang dikenal, untuk validasi cepat.
export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key)

export function isKnownPermission(key: string): boolean {
  return PERMISSION_BY_KEY.has(key)
}

export function getPermission(key: string): PermissionDefinition | undefined {
  return PERMISSION_BY_KEY.get(key)
}

export function permissionsByModule(module: PermissionModule): readonly PermissionDefinition[] {
  return PERMISSIONS.filter((permission) => permission.module === module)
}

/**
 * Menyusun key dari bagian-bagiannya. Satu-satunya tempat format key dirakit,
 * supaya tidak ada penulisan key manual yang menyimpang.
 */
export function buildPermissionKey(resource: string, action: string, scope?: PermissionScope | null): string {
  return scope ? `${resource}.${action}.${scope}` : `${resource}.${action}`
}

/**
 * Memeriksa konsistensi internal katalog. Dipanggil test; bukan jalur runtime.
 * Mengembalikan daftar masalah agar pesannya bisa dibaca sekaligus.
 */
export function validateRegistry(): readonly string[] {
  const problems: string[] = []
  const seenKeys = new Set<string>()
  const seenTriples = new Set<string>()

  for (const permission of PERMISSIONS) {
    if (seenKeys.has(permission.key)) problems.push(`key ganda: ${permission.key}`)
    seenKeys.add(permission.key)

    const triple = `${permission.resource}|${permission.action}|${permission.scope ?? ""}`
    if (seenTriples.has(triple)) problems.push(`resource+action+scope ganda: ${triple}`)
    seenTriples.add(triple)

    const expected = buildPermissionKey(permission.resource, permission.action, permission.scope)
    if (permission.key !== expected) {
      problems.push(`key tidak konsisten: ${permission.key} seharusnya ${expected}`)
    }

    if (permission.action === "view") {
      problems.push(`gunakan "read", bukan "view": ${permission.key}`)
    }

    if (permission.key.includes("*")) {
      problems.push(`wildcard tidak diizinkan: ${permission.key}`)
    }

    for (const dependency of permission.dependsOn ?? []) {
      if (dependency === permission.key) {
        problems.push(`dependency ke dirinya sendiri: ${permission.key}`)
      }
      if (!seenKeysContains(dependency)) {
        problems.push(`dependency tidak dikenal: ${permission.key} → ${dependency}`)
      }
    }
  }

  return problems
}

function seenKeysContains(key: string): boolean {
  return PERMISSIONS.some((permission) => permission.key === key)
}
