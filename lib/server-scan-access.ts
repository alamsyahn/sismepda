import { requirePermission } from "@/lib/rbac-access"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { verifySameOrigin } from "@/lib/same-origin"
import { ApiError } from "@/lib/api-errors"
import type { ScanMode } from "@/lib/scan"

export function assertScanOrigin(request: Request) {
  const result = verifySameOrigin(request)
  if (!result.ok) throw new ApiError(result.status, result.error)
}
export async function scanWriteAccess(mode: ScanMode) {
  const context = await requirePermission(mode === "attendance" ? "scan.attendance.use" : "scan.uks.use")
  if (mode === "uks") {
    await requirePermission("euks.visits.create")
    return { context, where: {} }
  }
  const scope = await requireClassScopeFor("attendance", "write")
  return { context, where: scope.where }
}
export async function scanReadAccess(mode: ScanMode) {
  const context = await requirePermission("scan.history.read")
  if (mode === "uks") {
    await requirePermission("euks.visits.read")
    return { context, where: {} }
  }
  const scope = await requireClassScopeFor("attendance", "read")
  return { context, where: scope.where }
}
