import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import {
  hasSarprasPermission,
  sarprasCapabilities,
  type SarprasCapabilities,
  type SarprasPermission,
} from "@/lib/sarpras"

export class SarprasAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const accessSelect = {
  id: true,
  role: true,
  canViewSarpras: true,
  canEditSarpras: true,
} as const

export type SarprasViewer = {
  id: string
  role: "ADMIN" | "GURU"
  capabilities: SarprasCapabilities
}

const messages: Record<SarprasPermission, string> = {
  "sarpras.view": "Tidak diizinkan membuka modul Sarpras",
  "sarpras.edit": "Tidak diizinkan mengubah data Sarpras",
}

/**
 * Resolve the caller and confirm they hold `permission`. Rights are re-read
 * from the database on every call, so revoking access takes effect immediately
 * even while a stale JWT is still in play.
 */
export async function requireSarprasPermission(
  permission: SarprasPermission,
): Promise<SarprasViewer> {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: accessSelect,
  })
  if (!user || !hasSarprasPermission(user, permission)) {
    throw new SarprasAccessError(403, messages[permission])
  }
  return { id: user.id, role: user.role, capabilities: sarprasCapabilities(user) }
}

/** Read-only access to the Sarpras module. */
export function requireSarprasViewer(): Promise<SarprasViewer> {
  return requireSarprasPermission("sarpras.view")
}

/** Write access — every mutating route handler must call this. */
export function requireSarprasEditor(): Promise<SarprasViewer> {
  return requireSarprasPermission("sarpras.edit")
}

/** Only ADMIN may grant or revoke Sarpras rights. */
export async function requireSarprasAccessManager(): Promise<SarprasViewer> {
  const viewer = await requireSarprasPermission("sarpras.view")
  if (viewer.role !== "ADMIN") {
    throw new SarprasAccessError(403, "Tidak diizinkan mengatur akses Sarpras")
  }
  return viewer
}

export function sarprasErrorResponse(error: unknown) {
  if (error instanceof SarprasAccessError) return { error: error.message, status: error.status }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return { error: "Sesi tidak valid", status: 401 }
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return { error: "Tidak diizinkan", status: 403 }
  }
  return { error: "Data Sarpras tidak valid", status: 400 }
}
