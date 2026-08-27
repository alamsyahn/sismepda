import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { canSuperviseWorkbooks, canViewWorkbookSupervision } from "@/lib/workbook"

export class WorkbookAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const accessSelect = {
  id: true,
  role: true,
  canSuperviseWorkbooks: true,
  canViewWorkbookSupervision: true,
} as const

export type WorkbookViewer = {
  id: string
  role: "ADMIN" | "GURU"
  canSupervise: boolean
}

/** Resolve the caller and confirm they may open the supervision page (read-only is enough). */
export async function requireWorkbookViewer(): Promise<WorkbookViewer> {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: accessSelect })
  if (!user || !canViewWorkbookSupervision(user)) {
    throw new WorkbookAccessError(403, "Tidak diizinkan membuka Supervisi Buku Kerja")
  }
  return { id: user.id, role: user.role, canSupervise: canSuperviseWorkbooks(user) }
}

/** Resolve the caller and confirm they may change supervision status. */
export async function requireWorkbookSupervisor(): Promise<WorkbookViewer> {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: accessSelect })
  if (!user || !canSuperviseWorkbooks(user)) {
    throw new WorkbookAccessError(403, "Tidak diizinkan mengubah status supervisi")
  }
  return { id: user.id, role: user.role, canSupervise: true }
}

export function workbookErrorResponse(error: unknown) {
  if (error instanceof WorkbookAccessError) return { error: error.message, status: error.status }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return { error: "Sesi tidak valid", status: 401 }
  }
  return { error: "Data supervisi tidak valid", status: 400 }
}
