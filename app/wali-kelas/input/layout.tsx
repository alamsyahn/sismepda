import type { ReactNode } from "react"

import { requirePagePermission } from "@/lib/page-guards"

/// Guard server untuk /wali-kelas/input.
export default async function WaliKelasInputLayout({ children }: { children: ReactNode }) {
  await requirePagePermission("homerooms.read")
  return children
}
