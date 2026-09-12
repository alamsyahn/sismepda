/**
 * Guard pengelolaan data kepegawaian guru.
 *
 * Sejak Phase 4 keputusan berasal dari permission RBAC, bukan flag
 * `canManageTeacherProfiles` pada `User`.
 */
import { requirePermission, requireUser } from "@/lib/rbac-access"

export class TeacherAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "TeacherAccessError"
  }
}

/// Pemanggil yang boleh mengubah data kepegawaian guru.
export async function requireTeacherManager() {
  await requirePermission("teachers.profile.update")
  return requireUser()
}

export function teacherErrorResponse(error: unknown) {
  if (error instanceof TeacherAccessError) return { error: error.message, status: error.status }
  return { error: "Data guru tidak valid", status: 400 }
}
