import { requirePermission } from "@/lib/rbac-access"
import { bosCapabilities, type BosCapabilities, type BosPermission } from "@/lib/bos"

export type BosViewer = {
  id: string
  capabilities: BosCapabilities
}

/** Resolve every BOS capability from current database RBAC on this request. */
export async function requireBosPermission(permission: BosPermission): Promise<BosViewer> {
  const context = await requirePermission(permission)
  return { id: context.user.id, capabilities: bosCapabilities(context.grants) }
}

/** Read-only access to the BOS module. */
export function requireBosViewer(): Promise<BosViewer> {
  return requireBosPermission("bos.read")
}
