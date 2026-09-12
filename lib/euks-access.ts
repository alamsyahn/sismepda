import { describeAuthFailure } from "@/lib/api-errors"
import { requirePermission } from "@/lib/rbac-access"

/**
 * E-UKS permissions are deliberately school-wide. This guard delegates to the
 * DB-current RBAC evaluator and never consults homeroom assignments or legacy
 * User.canViewEuks/User.canEditEuks flags.
 */
export async function requireEuksPermission(permission: string) {
  const context = await requirePermission(permission)
  return { id: context.user.id }
}

/** Compatibility response shape for existing E-UKS route handlers. */
export function euksErrorResponse(error: unknown) {
  const failure = describeAuthFailure(error)
  return {
    error: failure.status === 500 ? "Data E-UKS tidak valid" : failure.error,
    status: failure.status,
  }
}
