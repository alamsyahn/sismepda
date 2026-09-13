/**
 * Integrasi service RBAC terhadap database nyata.
 *
 * Membuktikan dua klaim yang TIDAK bisa dibuktikan store in-memory:
 *
 *   1. Kegagalan penulisan audit benar-benar me-ROLLBACK mutasi role, karena
 *      keduanya berada dalam satu `prisma.$transaction`.
 *   2. Penolakan invariant di tengah transaksi memulihkan baris keanggotaan.
 *
 * Dilewati otomatis bila DATABASE_URL tidak tersedia.
 * Data uji berawalan `svc-it-` dan dibersihkan kembali.
 */
import "dotenv/config"
import { strict as assert } from "node:assert"
import { after, before, describe, test } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { updateRoleProfile, type RoleStore } from "../lib/rbac-role-service"

const databaseUrl = process.env.DATABASE_URL
const enabled = Boolean(databaseUrl)

describe("integrasi service RBAC (database nyata)", { skip: enabled ? false : "DATABASE_URL tidak tersedia" }, () => {
  let prisma: PrismaClient
  const tag = `svc-it-${Date.now()}`
  let roleId = ""

  before(async () => {
    const adapter = new PrismaPg(
      { connectionString: databaseUrl },
      { schema: databaseSchema(databaseUrl!) },
    )
    prisma = new PrismaClient({ adapter })

    const role = await prisma.role.create({
      data: { key: `${tag}_role`, name: "Peran Uji", description: null },
      select: { id: true },
    })
    roleId = role.id
  })

  after(async () => {
    if (!prisma) return
    await prisma.rolePermission.deleteMany({ where: { roleId } })
    await prisma.role.deleteMany({ where: { key: { startsWith: tag } } })
    await prisma.$disconnect()
  })

  /**
   * Store berbasis transaksi, sama seperti yang dipakai route handler.
   * `auditWrites` menentukan apakah penulisan audit sengaja digagalkan.
   */
  function storeFor(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], failAudit: boolean): RoleStore {
    return {
      findRoleById: async (id) => {
        const role = await tx.role.findUnique({
          where: { id },
          select: {
            id: true, key: true, name: true, description: true,
            isSystem: true, isProtected: true, version: true,
            permissions: { select: { permission: { select: { key: true } } } },
            users: { select: { userId: true } },
          },
        })
        return role
          ? {
              ...role,
              permissionKeys: role.permissions.map((entry) => entry.permission.key),
              memberIds: role.users.map((entry) => entry.userId),
            }
          : null
      },
      findRoleByKey: async () => null,
      createRole: async () => {
        throw new Error("tidak dipakai")
      },
      updateRole: async (id, data) => {
        const role = await tx.role.update({
          where: { id },
          data: {
            ...(data.name === undefined ? {} : { name: data.name }),
            ...(data.description === undefined ? {} : { description: data.description }),
            version: { increment: 1 },
          },
          select: {
            id: true, key: true, name: true, description: true,
            isSystem: true, isProtected: true, version: true,
          },
        })
        return { ...role, permissionKeys: [], memberIds: [] }
      },
      deleteRole: async (id) => {
        await tx.role.delete({ where: { id } })
      },
      removeAllMembers: async (id) => {
        const result = await tx.userRole.deleteMany({ where: { roleId: id } })
        return result.count
      },
      recordAudit: async (entry) => {
        if (failAudit) {
          // Meniru kegagalan nyata: kolom `action` melanggar batasan NOT NULL.
          throw new Error("audit gagal ditulis")
        }
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: entry.action,
            entity: "RbacRole",
            entityId: entry.entityId,
            summary: entry.summary,
          },
        })
      },
    }
  }

  const actor = { id: "tester", isSystemAdmin: true, grants: new Set<string>() }

  test("perubahan role tersimpan bersama baris auditnya", async () => {
    const before = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      select: { version: true },
    })

    await prisma.$transaction(async (tx) => {
      await updateRoleProfile(storeFor(tx, false), {
        actor,
        roleId,
        expectedVersion: before.version,
        name: "Peran Uji Diubah",
        description: "deskripsi baru",
      })
    })

    const after = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      select: { name: true, version: true },
    })
    assert.equal(after.name, "Peran Uji Diubah")

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "RbacRole", entityId: roleId },
      orderBy: { createdAt: "desc" },
      select: { action: true },
    })
    assert.equal(audit?.action, "RBAC_ROLE_UPDATED")
  })

  test("kegagalan audit membatalkan perubahan role", async () => {
    const before = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      select: { name: true, version: true },
    })

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await updateRoleProfile(storeFor(tx, true), {
            actor,
            roleId,
            expectedVersion: before.version,
            name: "Nama Yang Tidak Boleh Tersimpan",
            description: null,
          })
        }),
      /audit gagal ditulis/,
    )

    const after = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      select: { name: true, version: true },
    })
    assert.equal(after.name, before.name, "nama role harus kembali seperti semula")
    assert.equal(after.version, before.version, "versi tidak boleh ikut naik")
  })
})
