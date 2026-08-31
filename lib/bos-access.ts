import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import {
  bosCapabilities,
  hasBosPermission,
  type BosCapabilities,
  type BosPermission,
} from "@/lib/bos"

export class BosAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const accessSelect = {
  id: true,
  role: true,
  canViewBos: true,
  canCreateBos: true,
  canEditBos: true,
  canManageBosCategories: true,
  canManageBosAccess: true,
} as const

export type BosViewer = {
  id: string
  role: "ADMIN" | "GURU"
  capabilities: BosCapabilities
}

const messages: Record<BosPermission, string> = {
  "bos.view": "Tidak diizinkan membuka modul BOS",
  "bos.create": "Tidak diizinkan menambah entry BOS",
  "bos.edit": "Tidak diizinkan mengubah data BOS",
  "bos.manage_categories": "Tidak diizinkan mengelola kategori BOS",
  "bos.manage_access": "Tidak diizinkan mengatur akses BOS",
}

/**
 * Resolve the caller and confirm they hold `permission`. Rights are re-read
 * from the database on every call, so revoking access takes effect immediately
 * even while a stale JWT is still in play.
 */
export async function requireBosPermission(permission: BosPermission): Promise<BosViewer> {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: accessSelect })
  if (!user || !hasBosPermission(user, permission)) {
    throw new BosAccessError(403, messages[permission])
  }
  return { id: user.id, role: user.role, capabilities: bosCapabilities(user) }
}

/** Read-only access to the BOS module. */
export function requireBosViewer(): Promise<BosViewer> {
  return requireBosPermission("bos.view")
}

export function bosErrorResponse(error: unknown) {
  if (error instanceof BosAccessError) return { error: error.message, status: error.status }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return { error: "Sesi tidak valid", status: 401 }
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return { error: "Tidak diizinkan", status: 403 }
  }
  return { error: "Data BOS tidak valid", status: 400 }
}
