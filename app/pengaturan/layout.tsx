import type { ReactNode } from "react"

import { requirePagePermission } from "@/lib/page-guards"

/**
 * Guard server untuk /pengaturan.
 *
 * Halaman ini di luar scope Phase 4, tetapi prefilter JWT yang dulu menjaganya
 * sudah dihapus — tanpa guard ini ia akan terbuka bagi setiap sesi yang sah.
 * Modul pengaturannya sendiri dimigrasikan pada fase berikutnya.
 */
export default async function PengaturanLayout({ children }: { children: ReactNode }) {
  await requirePagePermission("school.settings.read")
  return children
}
