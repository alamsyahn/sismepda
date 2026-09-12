import type { ReactNode } from "react"

import { requirePagePermission } from "@/lib/page-guards"

/// Guard server untuk /guru/input (halamannya client component).
export default async function GuruInputLayout({ children }: { children: ReactNode }) {
  await requirePagePermission("teachers.accounts.create")
  return children
}
