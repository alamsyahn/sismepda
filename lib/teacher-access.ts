import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { canManageTeacherProfile } from "@/lib/teacher-profile"

export class TeacherAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Resolve the caller and confirm they may edit teacher employment data. */
export async function requireTeacherManager() {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, role: true, canManageTeacherProfiles: true },
  })
  if (!user || !canManageTeacherProfile(user)) {
    throw new TeacherAccessError(403, "Tidak diizinkan mengubah data kepegawaian guru")
  }
  return user
}

export function teacherErrorResponse(error: unknown) {
  if (error instanceof TeacherAccessError) return { error: error.message, status: error.status }
  return { error: "Data guru tidak valid", status: 400 }
}
