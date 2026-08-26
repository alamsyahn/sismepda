import { prisma } from "@/lib/prisma"

type UserIdentity = {
  id: string
  role: "ADMIN" | "GURU"
}

export type ClassAccess = {
  allClasses: boolean
  where: { homeroomUserId?: string }
}

/** Resolve the class scope once per request and reuse it for every related query. */
export async function getClassAccess(user: UserIdentity): Promise<ClassAccess> {
  if (user.role === "ADMIN") return { allClasses: true, where: {} }

  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { allowTeachersAccessAllClasses: true },
  })
  const allClasses = setting?.allowTeachersAccessAllClasses ?? false

  return {
    allClasses,
    where: allClasses ? {} : { homeroomUserId: user.id },
  }
}

export function canAccessClass(
  access: ClassAccess,
  schoolClass: { homeroomUserId: string | null },
  userId: string,
): boolean {
  return access.allClasses || schoolClass.homeroomUserId === userId
}
