import type { ReactNode } from "react"

import { requirePageAnyPermission } from "@/lib/page-guards"

/**
 * Guard server untuk /pengaturan dan seluruh sub-rutenya.
 *
 * Prefilter JWT yang dulu menjaga bagian ini sudah dihapus — tanpa guard ini
 * ia akan terbuka bagi setiap sesi yang sah.
 *
 * Daftar ini adalah gerbang KASAR: ia hanya menentukan siapa yang boleh masuk
 * ke area pengaturan sama sekali. Setiap sub-rute tetap menuntut permission
 * spesifiknya sendiri, sehingga manajer RBAC tidak memperoleh akses ke
 * pengaturan sekolah dan sebaliknya.
 *
 * Key RBAC ikut di sini karena /pengaturan/pengguna dan /pengaturan/akses
 * berada di bawah layout ini; tanpa itu manajer RBAC akan diarahkan keluar
 * sebelum guard halamannya sendiri sempat berjalan.
 */
export default async function PengaturanLayout({ children }: { children: ReactNode }) {
  await requirePageAnyPermission([
    "school.settings.read",
    "rbac.roles.read",
    "rbac.roles.manage",
    "rbac.assignments.manage",
    "rbac.audit.read",
  ])
  return children
}
