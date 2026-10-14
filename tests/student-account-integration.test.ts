import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { provisionStudentAccount, StudentAccountError, type StudentAccountStore } from "../lib/student-account-service"

// Real PostgreSQL persistence, injected temporary role template; never edit siswa.
test("local provisioning transaction persists an own-only account and refuses empty template", { skip: process.env.SISMEPDA_DB_ROLE !== "local" }, async () => {
  const url = process.env.DATABASE_URL!
  const parsed = new URL(url)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  assert.equal(parsed.pathname, "/sismepda_dev")
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }) })
  const counts = async () => ({ students: await db.student.count(), users: await db.user.count(), classes: await db.schoolClass.count(), attendance: await db.attendance.count(), roles: await db.role.count(), permissions: await db.permission.count(), rolePermissions: await db.rolePermission.count(), userRoles: await db.userRole.count(), audit: await db.auditLog.count(), records: await db.menstruationRecord.count(), history: await db.menstruationHistory.count(), conflicts: await db.menstruationConflict.count(), requests: await db.menstruationRequest.count() })
  assert.equal((await db.$queryRaw<{ name: string }[]>`SELECT current_database() as name`)[0].name, "sismepda_dev")
  const before = await counts()
  const suffix = randomUUID()
  let classId = "", roleId = "", actorId = ""
  const keys = ["euks.menstruation.read.own", "euks.menstruation.create.own", "euks.menstruation.update.own"]
  try {
    classId = (await db.schoolClass.create({ data: { name: `TEMP account ${suffix}`, grade: "TEST" } })).id
    const student = await db.student.create({ data: { name: "TEMP account female", nis: `ACCT-${suffix}`, gender: "PEREMPUAN", classId } })
    actorId = (await db.user.create({ data: { name: "TEMP account actor", email: `actor-${suffix}@example.invalid`, passwordHash: "not-a-valid-login-hash", active: true, isTeacher: false } })).id
    const permissions = await db.permission.findMany({ where: { key: { in: keys } }, select: { id: true } })
    assert.equal(permissions.length, keys.length)
    roleId = (await db.role.create({ data: { key: `temp_account_${suffix}`, name: "TEMP account own-only template", isProtected: false, permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } })).id
    // Random validation-only input is not a real account password. No login,
    // vault, bcrypt or password output; the fixture's hash cannot authenticate.
    const input = { studentId: student.id, email: `student-${suffix}@example.invalid`, password: randomUUID() }
    let hashCalls = 0
    const provision = (empty: boolean) => db.$transaction(async tx => {
      const store: StudentAccountStore = {
        findStudent: id => tx.student.findUnique({ where: { id }, select: { id: true, name: true, active: true, gender: true, account: { select: { id: true } } } }),
        findEmail: email => tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
        async findStudentRole() {
          const role = await tx.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } })
          return { id: role.id, key: "siswa", isProtected: role.isProtected, permissionKeys: empty ? [] : role.permissions.map(p => p.permission.key) }
        },
        createAccount: ({ roleId, ...data }) => tx.user.create({ data: { ...data, rbacRoles: { create: { roleId } } }, select: { id: true, name: true, email: true, active: true, studentId: true } }),
        async audit(a) { await tx.auditLog.create({ data: { actorId: a.actorId, action: "RBAC_ACCOUNT_CREATED", entity: "UserAuthority", entityId: a.userId, summary: "Temporary local provisioning acceptance", targetUserId: a.userId } }) },
      }
      return provisionStudentAccount(input, actorId, store, async () => { hashCalls++; return "not-a-valid-login-hash" })
    })
    await assert.rejects(() => provision(true), (error: unknown) => error instanceof StudentAccountError && error.status === 503)
    assert.equal(hashCalls, 0); assert.equal(await db.user.count({ where: { studentId: student.id } }), 0)
    const account = await provision(false)
    const saved = await db.user.findUniqueOrThrow({ where: { id: account.id }, include: { rbacRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } })
    assert.equal(saved.studentId, student.id); assert.equal(saved.isTeacher, false); assert.equal(saved.workbookSupervised, false); assert.equal(saved.nip, null); assert.equal(saved.active, true)
    assert.deepEqual(saved.rbacRoles.flatMap(r => r.role.permissions.map(p => p.permission.key)).sort(), [...keys].sort())
    await assert.rejects(() => provision(false), (error: unknown) => error instanceof StudentAccountError && error.status === 409)
    assert.equal(hashCalls, 1); assert.equal(await db.auditLog.count({ where: { actorId } }), 1)
    console.log(JSON.stringify({ provisioning: { persisted: true, emptyTemplateStatus: 503, duplicateStatus: 409, exactOwnGrants: true }, before }))
  } finally {
    if (actorId) await db.auditLog.deleteMany({ where: { actorId } })
    if (classId) {
      const students = await db.student.findMany({ where: { classId }, select: { id: true } })
      await db.user.deleteMany({ where: { OR: [{ id: actorId }, { studentId: { in: students.map(s => s.id) } }] } })
      await db.student.deleteMany({ where: { classId } }); await db.schoolClass.delete({ where: { id: classId } })
    } else if (actorId) await db.user.delete({ where: { id: actorId } })
    if (roleId) await db.role.delete({ where: { id: roleId } })
    try { const after = await counts(); console.log(JSON.stringify({ after, restored: JSON.stringify(before) === JSON.stringify(after) })); assert.deepEqual(after, before) } finally { await db.$disconnect() }
  }
})
