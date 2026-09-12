import type { ReactNode } from "react"

import { requirePageAnyPermission } from "@/lib/page-guards"

/**
 * Guard server untuk /siswa/input.
 *
 * Halamannya sendiri client component, sehingga penjagaan diletakkan di layout
 * agar tetap berjalan di server sebelum apa pun dirender.
 */
export default async function SiswaInputLayout({ children }: { children: ReactNode }) {
  await requirePageAnyPermission(["students.master.create", "students.master.import"])
  return children
}
