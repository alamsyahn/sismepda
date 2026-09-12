import { getAuthorizationContext, requirePermission } from "@/lib/rbac-access"
import {
  sarprasCapabilitiesFromGrants,
  type SarprasCapabilities,
  type SarprasRuntimePermission,
} from "@/lib/sarpras-authorization"

export type SarprasViewer = {
  id: string
  capabilities: SarprasCapabilities
}

/**
 * Resolve one exact Sarpras permission from database-current RBAC state.
 * No runtime decision is made from legacy user columns or JWT claims.
 */
export async function requireSarprasPermission(
  permission: SarprasRuntimePermission,
): Promise<SarprasViewer> {
  const context = await requirePermission(permission)
  return {
    id: context.user.id,
    capabilities: sarprasCapabilitiesFromGrants(context.grants),
  }
}

export function requireSarprasViewer(): Promise<SarprasViewer> {
  return requireSarprasPermission("sarpras.read")
}

/** Capabilities for an already-authorized Sarpras server component. */
export async function readSarprasCapabilities(): Promise<SarprasCapabilities> {
  const context = await getAuthorizationContext()
  return sarprasCapabilitiesFromGrants(context.grants)
}
