/**
 * Template role bawaan.
 *
 * CLIENT-SAFE: tidak mengimpor Prisma.
 *
 * Template hanya dipakai sebagai NILAI AWAL saat sebuah role belum ada. Seed
 * tidak pernah menimpa isi role yang sudah ada, karena admin boleh menyesuaikan
 * permission lewat UI dan penyesuaian itu tidak boleh dikembalikan diam-diam
 * setiap kali deploy berjalan.
 *
 * Tidak ada implikasi otomatis di sini: setiap key ditulis lengkap, termasuk
 * pasangan read-nya. Aturan legacy semacam "boleh edit berarti boleh lihat"
 * direproduksi sebagai daftar eksplisit, bukan sebagai aturan evaluator.
 */

import { SYSTEM_ADMIN_ROLE_KEY } from "@/lib/rbac-permissions"

export type RoleTemplate = {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly isSystem: boolean
  readonly isProtected: boolean
  /**
   * Permission awal role ini. Kosong untuk `system_admin` karena kewenangannya
   * berasal dari bypass terkontrol berbasis key, bukan dari baris
   * RolePermission — menyalin role ini tidak menyalin bypass-nya.
   */
  readonly permissionKeys: readonly string[]
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: SYSTEM_ADMIN_ROLE_KEY,
    name: "Admin Sistem",
    description:
      "Akses penuh terkendali. Tidak dapat dihapus; kewenangannya melekat pada key role, bukan pada daftar permission.",
    isSystem: true,
    isProtected: true,
    permissionKeys: [],
  },
  {
    key: "guru",
    name: "Guru",
    description: "Mengelola absensi dan profil siswa pada kelas binaannya.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "attendance.dashboard.read.assigned_classes",
      "attendance.reports.read.assigned_classes",
      "attendance.read.assigned_classes",
      "attendance.write.assigned_classes",
      "attendance.export.assigned_classes",
      "reports.whatsapp.read",
      "students.profile.read.assigned_classes",
      "students.violations.write.assigned_classes",
      "teachers.directory.read",
      "workbook.links.read.own",
      "workbook.links.write.own",
    ],
  },
  {
    key: "pengawas",
    name: "Pengawas",
    description: "Memantau absensi seluruh kelas dan menilai supervisi buku kerja.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "attendance.dashboard.read.all",
      "attendance.reports.read.all",
      "attendance.export.all",
      "students.profile.read.all",
      "teachers.directory.read",
      "workbook.supervision.read",
      "workbook.supervision.write",
    ],
  },
  {
    key: "kepala_sekolah",
    name: "Kepala Sekolah",
    description: "Melihat seluruh modul tanpa kewenangan mengubah data operasional.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "attendance.dashboard.read.all",
      "attendance.reports.read.all",
      "attendance.export.all",
      "reports.whatsapp.read",
      "students.profile.read.all",
      "teachers.directory.read",
      "workbook.supervision.read",
      "bos.read",
      "sarpras.read",
      "euks.overview.read",
      "euks.visits.read",
      "euks.monitoring.read",
    ],
  },
  {
    key: "pengurus_uks",
    name: "Pengurus UKS",
    description: "Mengelola seluruh modul E-UKS.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "euks.overview.read",
      "euks.visits.read",
      "euks.visits.write",
      "euks.monitoring.read",
      "euks.measurements.write",
      "euks.sick_absences.write",
      "euks.complaint_options.read",
      "euks.complaint_options.manage",
      "euks.profile.manage",
      "euks.officers.manage",
      "euks.facilities.manage",
      "euks.hero_images.manage",
      "euks.hero_logos.manage",
    ],
  },
  {
    key: "pengurus_bos",
    name: "Pengurus BOS",
    description: "Mengelola realisasi dan anggaran BOS.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "bos.read",
      "bos.entries.create",
      "bos.entries.update",
      "bos.budget.write",
      "bos.categories.manage",
    ],
  },
  {
    key: "pengurus_sarpras",
    name: "Pengurus Sarpras",
    description: "Mengelola data sarana dan prasarana.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "sarpras.read",
      "sarpras.locations.write",
      "sarpras.item_types.write",
      "sarpras.items.write",
      "sarpras.photos.write",
    ],
  },
  {
    key: "siswa",
    name: "Siswa",
    description:
      "Belum memiliki permission: tautan User↔Student belum ada, sehingga tidak ada data yang bisa dibatasi dengan benar.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [],
  },
  {
    key: "wali_murid",
    name: "Wali Murid",
    description:
      "Belum memiliki permission: resolver hubungan wali↔anak belum ada.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [],
  },
]

export function getRoleTemplate(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((template) => template.key === key)
}
