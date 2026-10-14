import { hash } from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { recordAuditLog } from "@/lib/audit-log"
import { lockSystemAdminPopulation } from "@/lib/rbac-invariants-db"
import { provisionStudentAccount, StudentAccountError } from "@/lib/student-account-service"

export type StudentAccountRosterRow = {
  id: string
  name: string
  schoolClass: { name: string }
  account: { id: string; active: boolean } | null
}

export async function readStudentAccountRoster(): Promise<StudentAccountRosterRow[]> {
  await requirePermission("students.accounts.manage")
  return prisma.student.findMany({
    where: { active: true, gender: "PEREMPUAN" },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, schoolClass: { select: { name: true } }, account: { select: { id: true, active: true } } },
  })
}

export async function createStudentAccount(input: unknown) {
  const { user: actor } = await requirePermission("students.accounts.manage")
  try {
    return await prisma.$transaction(async (tx) => {
      // Role edits use this lock too: do not assign a role that changes during validation.
      await lockSystemAdminPopulation(tx)
      return provisionStudentAccount(input, actor.id, {
        findStudent: (id) => tx.student.findUnique({ where: { id }, select: { id: true, name: true, active: true, gender: true, account: { select: { id: true } } } }),
        findEmail: (email) => tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
        async findStudentRole() {
          const role = await tx.role.findUnique({ where: { key: "siswa" }, select: { id: true, key: true, isProtected: true, permissions: { select: { permission: { select: { key: true } } } } } })
          return role ? { id: role.id, key: role.key, isProtected: role.isProtected, permissionKeys: role.permissions.map((row) => row.permission.key) } : null
        },
        createAccount: ({ roleId, ...data }) => tx.user.create({
          data: { ...data, rbacRoles: { create: { roleId } } },
          select: { id: true, name: true, email: true, active: true, studentId: true },
        }),
        async audit({ actorId, userId, studentId, roleId, roleKey }) {
          await recordAuditLog({ actorId, action: "RBAC_ACCOUNT_CREATED", entity: "UserAuthority", entityId: userId, targetUserId: userId,
            summary: "Akun pribadi siswa dibuat dan ditautkan oleh administrator.",
            after: { studentId, roleId, roleKey, active: true, isTeacher: false },
          }, tx)
        },
      }, (password) => hash(password, 12))
    }, { isolationLevel: "Serializable" })
  } catch (error) {
    // Do not log Prisma exceptions: their query data may include password hashes.
    if (error !== null && typeof error === "object" && "code" in error && (error.code === "P2002" || error.code === "P2034")) {
      throw new StudentAccountError(409, "Akun atau email berubah bersamaan. Muat ulang daftar sebelum mencoba lagi.")
    }
    throw error
  }
}
