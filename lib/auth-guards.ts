import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function requireUser() {
  const session = await auth()
  if (!session?.user) throw new Error("UNAUTHORIZED")
  const activeUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { active: true } })
  if (!activeUser?.active) throw new Error("UNAUTHORIZED")
  return session.user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN")
  return user
}
