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
  def({
    // Dipisah dari accounts.status.manage: menonaktifkan dapat dibatalkan,
    // menghapus tidak. Penghapusan juga memutus atribusi historis (siapa
    // mencatat pelanggaran, siapa mengirim absensi), jadi ia menuntut
    // kewenangan tersendiri dan bukan konsekuensi dari hak menonaktifkan.
    key: "accounts.delete",
    resource: "accounts",
    action: "delete",
    module: "teachers",
    label: "Hapus akun permanen",
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
  def({ key: "bos.read", resource: "bos", action: "read", module: "bos", label: "Lihat modul BOS" }),
  def({ key: "bos.entries.create", resource: "bos.entries", action: "create", module: "bos", label: "Tambah realisasi BOS", dependsOn: ["bos.read"] }),
  def({ key: "bos.entries.update", resource: "bos.entries", action: "update", module: "bos", label: "Ubah realisasi BOS", dependsOn: ["bos.read"] }),
  def({ key: "bos.budget.update", resource: "bos.budget", action: "update", module: "bos", label: "Ubah anggaran BOS", dependsOn: ["bos.read"], sensitive: true }),
  def({ key: "bos.categories.create", resource: "bos.categories", action: "create", module: "bos", label: "Tambah kategori BOS", dependsOn: ["bos.read"] }),
  def({ key: "bos.categories.update", resource: "bos.categories", action: "update", module: "bos", label: "Ubah/aktifkan kategori BOS", dependsOn: ["bos.read"] }),
  def({ key: "bos.access.manage", resource: "bos.access", action: "manage", module: "bos", label: "Kelola bundle akses BOS", description: "Hanya memberi atau mencabut bundle BOS tetap yang diizinkan server.", dependsOn: ["bos.read"], sensitive: true }),

  // --- sarpras ------------------------------------------------------------
  def({ key: "sarpras.read", resource: "sarpras", action: "read", module: "sarpras", label: "Lihat modul Sarpras" }),
  def({ key: "sarpras.history.read", resource: "sarpras.history", action: "read", module: "sarpras", label: "Lihat riwayat Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.photos.read", resource: "sarpras.photos", action: "read", module: "sarpras", label: "Lihat foto Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.locations.create", resource: "sarpras.locations", action: "create", module: "sarpras", label: "Tambah lokasi Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.locations.update", resource: "sarpras.locations", action: "update", module: "sarpras", label: "Ubah lokasi Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.locations.delete", resource: "sarpras.locations", action: "delete", module: "sarpras", label: "Hapus lokasi Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.item_types.create", resource: "sarpras.item_types", action: "create", module: "sarpras", label: "Tambah jenis barang Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.item_types.update", resource: "sarpras.item_types", action: "update", module: "sarpras", label: "Ubah jenis barang Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.item_types.delete", resource: "sarpras.item_types", action: "delete", module: "sarpras", label: "Hapus jenis barang Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.items.create", resource: "sarpras.items", action: "create", module: "sarpras", label: "Tambah barang Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.items.update", resource: "sarpras.items", action: "update", module: "sarpras", label: "Ubah barang Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.items.delete", resource: "sarpras.items", action: "delete", module: "sarpras", label: "Hapus barang Sarpras", dependsOn: ["sarpras.read"] }),
  def({ key: "sarpras.photos.create", resource: "sarpras.photos", action: "create", module: "sarpras", label: "Unggah foto Sarpras", dependsOn: ["sarpras.read", "sarpras.photos.read"] }),
  def({ key: "sarpras.photos.delete", resource: "sarpras.photos", action: "delete", module: "sarpras", label: "Hapus foto Sarpras", dependsOn: ["sarpras.read", "sarpras.photos.read"] }),

  // --- euks ---------------------------------------------------------------
  def({ key: "euks.content.read", resource: "euks.content", action: "read", module: "euks", label: "Lihat konten profil E-UKS" }),
  def({ key: "euks.overview.read", resource: "euks.overview", action: "read", module: "euks", label: "Lihat ringkasan kesehatan E-UKS" }),
  def({ key: "euks.visits.read", resource: "euks.visits", action: "read", module: "euks", label: "Lihat kunjungan UKS" }),
  def({ key: "euks.visits.create", resource: "euks.visits", action: "create", module: "euks", label: "Catat kunjungan UKS", dependsOn: ["euks.visits.read", "euks.complaint_options.read"] }),
  def({ key: "euks.visits.update", resource: "euks.visits", action: "update", module: "euks", label: "Ubah kunjungan UKS", dependsOn: ["euks.visits.read", "euks.complaint_options.read"] }),
  def({ key: "euks.visits.delete", resource: "euks.visits", action: "delete", module: "euks", label: "Hapus kunjungan UKS", dependsOn: ["euks.visits.read"] }),
  def({ key: "euks.monitoring.read", resource: "euks.monitoring", action: "read", module: "euks", label: "Buka pantauan kesehatan" }),
  def({ key: "euks.measurements.read", resource: "euks.measurements", action: "read", module: "euks", label: "Lihat pengukuran kesehatan", dependsOn: ["euks.monitoring.read"] }),
  def({ key: "euks.measurements.create", resource: "euks.measurements", action: "create", module: "euks", label: "Catat pengukuran kesehatan", dependsOn: ["euks.monitoring.read", "euks.measurements.read"] }),
  def({ key: "euks.measurements.delete", resource: "euks.measurements", action: "delete", module: "euks", label: "Hapus pengukuran kesehatan", dependsOn: ["euks.monitoring.read", "euks.measurements.read"] }),
  def({ key: "euks.sick_absences.read", resource: "euks.sick_absences", action: "read", module: "euks", label: "Lihat absensi sakit", dependsOn: ["euks.monitoring.read"] }),
  def({ key: "euks.sick_absences.update", resource: "euks.sick_absences", action: "update", module: "euks", label: "Isi catatan/tindak lanjut absensi sakit", dependsOn: ["euks.monitoring.read", "euks.sick_absences.read"] }),
  def({ key: "euks.complaint_options.read", resource: "euks.complaint_options", action: "read", module: "euks", label: "Lihat pilihan keluhan" }),
  def({ key: "euks.complaint_options.create", resource: "euks.complaint_options", action: "create", module: "euks", label: "Tambah pilihan keluhan", dependsOn: ["euks.complaint_options.read"] }),
  def({ key: "euks.complaint_options.update", resource: "euks.complaint_options", action: "update", module: "euks", label: "Ubah/nonaktifkan pilihan keluhan", dependsOn: ["euks.complaint_options.read"] }),
  def({ key: "euks.profile.update", resource: "euks.profile", action: "update", module: "euks", label: "Ubah identitas UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.officers.create", resource: "euks.officers", action: "create", module: "euks", label: "Tambah pengurus UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.officers.update", resource: "euks.officers", action: "update", module: "euks", label: "Ubah pengurus UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.officers.delete", resource: "euks.officers", action: "delete", module: "euks", label: "Hapus pengurus UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.facilities.create", resource: "euks.facilities", action: "create", module: "euks", label: "Tambah fasilitas UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.facilities.update", resource: "euks.facilities", action: "update", module: "euks", label: "Ubah fasilitas UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.facilities.delete", resource: "euks.facilities", action: "delete", module: "euks", label: "Hapus fasilitas UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.hero_images.create", resource: "euks.hero_images", action: "create", module: "euks", label: "Tambah gambar hero UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.hero_images.update", resource: "euks.hero_images", action: "update", module: "euks", label: "Ubah gambar hero UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.hero_images.delete", resource: "euks.hero_images", action: "delete", module: "euks", label: "Hapus gambar hero UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.hero_logos.create", resource: "euks.hero_logos", action: "create", module: "euks", label: "Tambah logo hero UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.hero_logos.update", resource: "euks.hero_logos", action: "update", module: "euks", label: "Ubah logo hero UKS", dependsOn: ["euks.content.read"] }),
  def({ key: "euks.hero_logos.delete", resource: "euks.hero_logos", action: "delete", module: "euks", label: "Hapus logo hero UKS", dependsOn: ["euks.content.read"] }),

  // --- school -------------------------------------------------------------
  def({ key: "school.settings.read", resource: "school.settings", action: "read", module: "school", label: "Lihat pengaturan sekolah" }),
  def({ key: "school.settings.update", resource: "school.settings", action: "update", module: "school", label: "Ubah pengaturan sekolah", dependsOn: ["school.settings.read"], sensitive: true }),
  def({ key: "school.class_access.manage", resource: "school.class_access", action: "manage", module: "school", label: "Atur akses guru ke semua kelas", description: "Mengendalikan allowTeachersAccessAllClasses.", dependsOn: ["school.settings.read"], sensitive: true }),
  def({ key: "school.branding.update", resource: "school.branding", action: "update", module: "school", label: "Ubah identitas visual aplikasi" }),
  def({ key: "school.upload_policy.read", resource: "school.upload_policy", action: "read", module: "school", label: "Lihat pengaturan unggah" }),
  def({ key: "school.upload_policy.update", resource: "school.upload_policy", action: "update", module: "school", label: "Ubah batas ukuran unggah", description: "Mengendalikan batas global per kategori dan override per slot unggah.", dependsOn: ["school.upload_policy.read"], sensitive: true }),
  def({ key: "school.holidays.read", resource: "school.holidays", action: "read", module: "school", label: "Lihat kalender libur" }),
  def({ key: "school.holidays.create", resource: "school.holidays", action: "create", module: "school", label: "Tambah kalender libur", dependsOn: ["school.holidays.read"] }),
  def({ key: "school.holidays.update", resource: "school.holidays", action: "update", module: "school", label: "Ubah kalender libur", dependsOn: ["school.holidays.read"] }),
  def({ key: "school.holidays.delete", resource: "school.holidays", action: "delete", module: "school", label: "Hapus kalender libur", dependsOn: ["school.holidays.read"] }),
  def({ key: "school.holidays.export", resource: "school.holidays", action: "export", module: "school", label: "Ekspor kalender libur" }),

  // --- database -----------------------------------------------------------
  def({ key: "database.backup", resource: "database", action: "backup", module: "database", label: "Unduh cadangan database", sensitive: true }),
  def({ key: "database.restore", resource: "database", action: "restore", module: "database", label: "Pulihkan database", sensitive: true }),

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
    description: "Mengungkap struktur kewenangan sekolah, termasuk siapa yang memegang role sensitif.",
    sensitive: true,
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

/**
 * Keluarga permission yang merupakan KEWENANGAN SENSITIF: mengubah siapa yang
 * punya akses, menyentuh identitas/kredensial akun, atau menyentuh berkas
 * database.
 *
 * Notasi di sini adalah METADATA, bukan wildcard runtime. Tidak ada evaluator
 * yang pernah memberi grant berdasarkan prefiks: `isSensitiveAuthority`
 * hanya MENGKLASIFIKASIKAN key yang sudah ada di registry, dipakai untuk
 * membatasi pendelegasian dan untuk memberi tanda di UI.
 *
 * Pencocokan dilakukan per SEGMEN key, sehingga `teachers.accounts.read`
 * (kewenangan direktori guru biasa) tidak tertarik oleh keluarga `accounts`.
 */
export const SENSITIVE_AUTHORITY_FAMILIES: readonly string[] = [
  "rbac",
  "accounts",
  "database",
  "school.class_access.manage",
  "homerooms.assign",
]

/**
 * Apakah sebuah key termasuk kewenangan sensitif.
 *
 * Sebuah key cocok bila ia sama dengan nama keluarga, atau berada langsung di
 * bawahnya sebagai segmen penuh (`rbac` cocok dengan `rbac.roles.manage`,
 * tetapi TIDAK dengan `rbacx.foo` maupun dengan `teachers.accounts.read`).
 */
export function isSensitiveAuthority(key: string): boolean {
  return SENSITIVE_AUTHORITY_FAMILIES.some(
    (family) => key === family || key.startsWith(`${family}.`),
  )
}

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
