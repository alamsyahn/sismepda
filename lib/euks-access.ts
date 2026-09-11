import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import {
  euksCapabilities,
  hasEuksPermission,
  type EuksCapabilities,
  type EuksPermission,
} from "@/lib/euks"

export class EuksAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const accessSelect = {
  id: true,
  role: true,
  canViewEuks: true,
  canEditEuks: true,
} as const

export type EuksViewer = {
  id: string
  role: "ADMIN" | "GURU"
  capabilities: EuksCapabilities
}

const messages: Record<EuksPermission, string> = {
  "euks.view": "Tidak diizinkan membuka modul E-UKS",
  "euks.edit": "Tidak diizinkan mengubah data E-UKS",
}

/**
 * Resolve the caller and confirm they hold `permission`. Rights are re-read
 * from the database on every call, so revoking access takes effect immediately
 * even while a stale JWT is still in play.
 */
export async function requireEuksPermission(permission: EuksPermission): Promise<EuksViewer> {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: accessSelect,
  })
  if (!user || !hasEuksPermission(user, permission)) {
    throw new EuksAccessError(403, messages[permission])
  }
  return { id: user.id, role: user.role, capabilities: euksCapabilities(user) }
}

/** Read-only access to the E-UKS module. */
export function requireEuksViewer(): Promise<EuksViewer> {
  return requireEuksPermission("euks.view")
}

/** Write access — every mutating route handler must call this. */
export function requireEuksEditor(): Promise<EuksViewer> {
  return requireEuksPermission("euks.edit")
}

/** Only ADMIN may change E-UKS configuration content or grant rights. */
export async function requireEuksAdmin(): Promise<EuksViewer> {
  const viewer = await requireEuksPermission("euks.view")
  if (viewer.role !== "ADMIN") {
    throw new EuksAccessError(403, "Tidak diizinkan mengatur konfigurasi E-UKS")
  }
  return viewer
}

export function euksErrorResponse(error: unknown) {
  if (error instanceof EuksAccessError) return { error: error.message, status: error.status }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return { error: "Sesi tidak valid", status: 401 }
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return { error: "Tidak diizinkan", status: 403 }
  }
  return { error: "Data E-UKS tidak valid", status: 400 }
}
