/**
 * Guard supervisi buku kerja.
 *
 * Sejak Phase 4 keputusan berasal dari permission RBAC, bukan flag boolean pada
 * `User`. `workbookSupervised` tetap atribut POPULASI (siapa yang disupervisi)
 * dan tidak pernah berubah makna menjadi kewenangan menyupervisi.
 */
import { requirePermission, requireUser } from "@/lib/rbac-access"
import { can } from "@/lib/rbac-access"

export class WorkbookAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "WorkbookAccessError"
  }
}

export type WorkbookViewer = {
  id: string
  canSupervise: boolean
}

/// Membuka halaman supervisi (read-only sudah cukup).
export async function requireWorkbookViewer(): Promise<WorkbookViewer> {
  await requirePermission("workbook.supervision.read")
  const user = await requireUser()
  // Tombol penilaian hanya muncul bila memang punya kewenangan menilai.
  return { id: user.id, canSupervise: await can("workbook.supervision.review") }
}

/// Mengubah status checklist supervisi.
export async function requireWorkbookSupervisor(): Promise<WorkbookViewer> {
  await requirePermission("workbook.supervision.review")
  const user = await requireUser()
  return { id: user.id, canSupervise: true }
}

export function workbookErrorResponse(error: unknown) {
  if (error instanceof WorkbookAccessError) return { error: error.message, status: error.status }
  return { error: "Data supervisi tidak valid", status: 400 }
}
