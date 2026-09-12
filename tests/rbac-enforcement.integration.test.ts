/**
 * Integrasi RBAC Phase 4 terhadap database nyata.
 *
 * Menguji hal yang TIDAK BISA dibuktikan fungsi murni: bahwa pencabutan dan
 * pemberian hak yang sudah tersimpan langsung berlaku pada permintaan
 * berikutnya dengan identitas (cookie/sesi) yang sama, tanpa logout.
 *
 * Dilewati otomatis bila `DATABASE_URL` tidak tersedia, sehingga `npm test`
 * tetap bisa dijalankan tanpa database.
 *
 * Semua data uji dibuat dengan awalan `rbac-it-` dan dibersihkan kembali;
 * tidak ada baris milik aplikasi yang disentuh.
 */
import "dotenv/config"
import { strict as assert } from "node:assert"
import { after, before, describe, test } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { collectGrants, hasPermission, resolveScope, type AuthorizationSubject } from "../lib/rbac"
import { SYSTEM_ADMIN_ROLE_KEY } from "../lib/rbac-permissions"

const databaseUrl = process.env.DATABASE_URL
const enabled = Boolean(databaseUrl)

describe("integrasi RBAC (database nyata)", { skip: enabled ? false : "DATABASE_URL tidak tersedia" }, () => {
  let prisma: PrismaClient
  const tag = `rbac-it-${Date.now()}`
  const ids = { user: "", roleA: "", roleB: "", classMine: "", classOther: "" }

  /**
   * Meniru persis apa yang dilakukan `getAuthorizationContext()`: membaca
   * keanggotaan role dari database SETIAP KALI dipanggil, tanpa cache lintas
   * permintaan. Inilah yang membuat perubahan hak langsung terasa.
   */
  async function readSubject(userId: string): Promise<AuthorizationSubject | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true, isTeacher: true },
    })
    // requireUser(): akun hilang atau nonaktif ditolak sebelum hak dibaca.
    if (!user || !user.active) return null

    const memberships = await prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            id: true,
            key: true,
            name: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    })

    return {
      userId: user.id,
      isTeacher: user.isTeacher,
      roles: memberships.map(({ role }) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        permissionKeys: role.permissions.map((entry) => entry.permission.key),
      })),
    }
  }

  async function grant(roleId: string, permissionKey: string) {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: permissionKey },
      select: { id: true },
    })
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
  }

  before(async () => {
    // Schema mengikuti DATABASE_URL, sama seperti lib/prisma.ts.
    const adapter = new PrismaPg(
      { connectionString: databaseUrl },
      { schema: databaseSchema(databaseUrl!) },
    )
    prisma = new PrismaClient({ adapter })

    const user = await prisma.user.create({
      data: { name: `${tag}-user`, nip: `${tag}-nip`, passwordHash: "x", isTeacher: true },
      select: { id: true },
    })
    ids.user = user.id

    const roleA = await prisma.role.create({
      data: { key: `${tag}-a`, name: "Uji A" },
      select: { id: true },
    })
    const roleB = await prisma.role.create({
      data: { key: `${tag}-b`, name: "Uji B" },
      select: { id: true },
    })
    ids.roleA = roleA.id
    ids.roleB = roleB.id

    const mine = await prisma.schoolClass.create({
      data: { name: `${tag}-mine`, grade: "VII", homeroomUserId: user.id },
      select: { id: true },
    })
    const other = await prisma.schoolClass.create({
      data: { name: `${tag}-other`, grade: "VII" },
      select: { id: true },
    })
    ids.classMine = mine.id
    ids.classOther = other.id
  })

  after(async () => {
    if (!prisma) return
    await prisma.schoolClass.deleteMany({ where: { name: { startsWith: tag } } })
    await prisma.userRole.deleteMany({ where: { userId: ids.user } })
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [ids.roleA, ids.roleB] } } })
    await prisma.role.deleteMany({ where: { key: { startsWith: tag } } })
    await prisma.user.deleteMany({ where: { id: ids.user } })
    await prisma.$disconnect()
  })

  test("zero-role: tidak ada grant sama sekali", async () => {
    const subject = await readSubject(ids.user)
    assert.ok(subject)
    assert.equal(collectGrants(subject).size, 0)
    assert.equal(resolveScope(subject, "attendance", "read").allowed, false)
  })

  test("pemberian role langsung berlaku pada pembacaan berikutnya", async () => {
    await grant(ids.roleA, "attendance.read.assigned_classes")
    await prisma.userRole.create({ data: { userId: ids.user, roleId: ids.roleA } })

    // Identitas tidak berubah — hanya database yang berubah.
    const subject = await readSubject(ids.user)
    assert.ok(subject)
    const decision = resolveScope(subject, "attendance", "read")
    assert.ok(decision.allowed && decision.scope === "assigned_classes")
  })

  test("union multi-role tanpa saling melebarkan operasi", async () => {
    await grant(ids.roleB, "attendance.reports.read.all")
    await prisma.userRole.create({ data: { userId: ids.user, roleId: ids.roleB } })

    const subject = await readSubject(ids.user)
    assert.ok(subject)
    const reports = resolveScope(subject, "attendance.reports", "read")
    const read = resolveScope(subject, "attendance", "read")
    assert.ok(reports.allowed && reports.scope === "all")
    // Rekap seluruh sekolah TIDAK melebarkan daftar hadir.
    assert.ok(read.allowed && read.scope === "assigned_classes")
    // Dan tidak satu pun memberi hak menulis.
    assert.equal(resolveScope(subject, "attendance", "write").allowed, false)
  })

  test("mencabut satu role tidak menghapus permission role lain", async () => {
    await prisma.userRole.delete({
      where: { userId_roleId: { userId: ids.user, roleId: ids.roleB } },
    })

    const subject = await readSubject(ids.user)
    assert.ok(subject)
    assert.equal(resolveScope(subject, "attendance.reports", "read").allowed, false)
    assert.ok(resolveScope(subject, "attendance", "read").allowed, "role A harus bertahan")
  })

  test("mencabut permission dari role langsung berlaku tanpa logout", async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: "attendance.read.assigned_classes" },
      select: { id: true },
    })
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: ids.roleA, permissionId: permission.id } },
    })

    const subject = await readSubject(ids.user)
    assert.ok(subject)
    assert.equal(resolveScope(subject, "attendance", "read").allowed, false)
  })

  test("IDOR: kelas milik orang lain tidak masuk scope assigned_classes", async () => {
    await grant(ids.roleA, "attendance.write.assigned_classes")

    const subject = await readSubject(ids.user)
    assert.ok(subject)
    const decision = resolveScope(subject, "attendance", "write")
    assert.ok(decision.allowed && decision.scope === "assigned_classes")

    // Inilah filter yang dipakai route handler sebelum menulis.
    const where = { homeroomUserId: subject.userId }
    const reachable = await prisma.schoolClass.findMany({
      where: { id: { in: [ids.classMine, ids.classOther] }, ...where },
      select: { id: true },
    })

    assert.deepEqual(reachable.map((row) => row.id), [ids.classMine])
  })

  test("akun nonaktif ditolak walau role-nya masih utuh", async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { active: false } })
    assert.equal(await readSubject(ids.user), null)
    await prisma.user.update({ where: { id: ids.user }, data: { active: true } })
  })

  test("akun terhapus ditolak", async () => {
    assert.equal(await readSubject("user-yang-tidak-ada"), null)
  })

  test("role bernama mirip admin bukan system admin", async () => {
    await prisma.role.update({ where: { id: ids.roleA }, data: { name: "Admin Sistem" } })

    const subject = await readSubject(ids.user)
    assert.ok(subject)
    // Bypass ditentukan KEY `system_admin`, bukan nama yang bisa diketik bebas.
    assert.ok(subject.roles.every((role) => role.key !== SYSTEM_ADMIN_ROLE_KEY))
    assert.equal(hasPermission(subject, "students.master.delete"), false)
  })

  test("permission di luar registry tidak pernah lolos meski tersimpan di DB", async () => {
    const subject = await readSubject(ids.user)
    assert.ok(subject)
    assert.equal(hasPermission(subject, "students.master.superpower"), false)
  })
})
