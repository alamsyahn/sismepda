import { getAuthorizationContext, requirePermission } from "@/lib/rbac-access"
import {
  scheduleCapabilitiesFromGrants,
  type ScheduleCapabilities,
  type ScheduleRuntimePermission,
} from "@/lib/schedule-authorization"

export type ScheduleViewer = {
  readonly id: string
  readonly isTeacher: boolean
  readonly capabilities: ScheduleCapabilities
}

/**
 * Menuntut SATU permission Jadwal yang tepat, dinilai dari keadaan RBAC di
 * database saat ini — bukan dari klaim token maupun kolom legacy.
 *
 * SERVER-ONLY (lewat `lib/rbac-access.ts`).
 */
export async function requireSchedulePermission(
  permission: ScheduleRuntimePermission,
): Promise<ScheduleViewer> {
  const context = await requirePermission(permission)
  return {
    id: context.user.id,
    isTeacher: context.user.isTeacher,
    capabilities: scheduleCapabilitiesFromGrants(context.grants),
  }
}

/** Kemampuan Jadwal untuk server component yang sudah lolos guard halaman. */
export async function readScheduleViewer(): Promise<ScheduleViewer> {
  const context = await getAuthorizationContext()
  return {
    id: context.user.id,
    isTeacher: context.user.isTeacher,
    capabilities: scheduleCapabilitiesFromGrants(context.grants),
  }
}
