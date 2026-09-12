/**
 * Template role bawaan.
 *
 * CLIENT-SAFE: tidak mengimpor Prisma.
 *
 * Template hanya dipakai sebagai NILAI AWAL saat sebuah role belum ada. Seed
 * tidak pernah menimpa isi role yang sudah ada, karena admin boleh menyesuaikan
 * permission lewat UI dan penyesuaian itu tidak boleh dikembalikan diam-diam
 * setiap kali deploy berjalan. Template BUKAN otoritas permanen.
 *
 * Tidak ada implikasi otomatis di sini: setiap key ditulis lengkap, termasuk
 * pasangan read-nya. Aturan legacy semacam "boleh edit berarti boleh lihat"
 * direproduksi sebagai daftar eksplisit, bukan sebagai aturan evaluator.
 *
 * Granularitas key mengikuti guard yang benar-benar ada di kode (lihat
 * lib/rbac-permissions.ts): satu key `*.write` menutup create/update/delete
 * bila ketiganya dijaga guard yang sama di HEAD. Pemisahan lebih halus
 * membutuhkan guard baru, bukan sekadar key baru.
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
    description:
      "Mengelola absensi, profil, dan pelanggaran siswa pada kelas binaannya. Tidak otomatis memperoleh BOS, Sarpras, E-UKS, supervisi, maupun laporan WhatsApp sekolah.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "attendance.dashboard.read.assigned_classes",
      "attendance.reports.read.assigned_classes",
      "attendance.read.assigned_classes",
      "attendance.write.assigned_classes",
      "attendance.export.assigned_classes",
      "students.profile.read.assigned_classes",
      "students.violations.read.assigned_classes",
      "students.violations.create.assigned_classes",
      "teachers.directory.read",
      "workbook.links.read.own",
      "workbook.links.update.own",
    ],
  },
  {
    key: "pengawas",
    name: "Pengawas",
    description:
      "Memantau dashboard dan laporan absensi seluruh kelas serta membaca supervisi buku kerja. Tanpa kewenangan menulis, menilai, atau mengekspor.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "attendance.dashboard.read.all",
      "attendance.reports.read.all",
      "teachers.directory.read",
      "workbook.supervision.read",
    ],
  },
  {
    key: "kepala_sekolah",
    name: "Kepala Sekolah",
    description:
      "Pemantauan Pengawas ditambah ringkasan BOS dan data Sarpras. Data kesehatan per siswa tidak otomatis; bukan bypass admin.",
    isSystem: true,
    isProtected: false,
    permissionKeys: [
      "attendance.dashboard.read.all",
      "attendance.reports.read.all",
      "teachers.directory.read",
      "workbook.supervision.read",
      "bos.read",
      "sarpras.read",
    ],
  },
  {
    key: "pengurus_uks",
    name: "Pengurus UKS",
    description:
      "Mencatat kunjungan, pengukuran, dan tindak lanjut absensi sakit di E-UKS. Pengaturan profil/pengurus/fasilitas UKS bukan bawaan.",
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
    ],
  },
  {
    key: "pengurus_bos",
    name: "Pengurus BOS",
    description:
      "Mencatat dan memperbaiki realisasi BOS serta menambah kategori. Anggaran, pengelolaan kategori, dan akses BOS bukan bawaan.",
    isSystem: true,
    isProtected: false,
    // `bos.entries.create` menutup POST /api/bos/categories (pembuatan
    // kategori) karena di HEAD keduanya dijaga hak yang sama (bos.create).
    permissionKeys: ["bos.read", "bos.entries.create", "bos.entries.update"],
  },
  {
    key: "pengurus_sarpras",
    name: "Pengurus Sarpras",
    description:
      "Mengelola lokasi, jenis, barang, dan foto sarana prasarana.",
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
