import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  RoleMutationError,
  cloneRole,
  createRole,
  deleteRole,
  updateRolePermissions,
  updateRoleProfile,
  type RoleStore,
} from "../lib/rbac-role-service"

type StoredRole = {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  isProtected: boolean
  version: number
  permissionKeys: string[]
  memberIds: string[]
}

/** Store in-memory yang meniru kontrak transaksi tanpa menyentuh database. */
function makeStore(seed: StoredRole[] = []) {
  const roles = new Map<string, StoredRole>(seed.map((role) => [role.id, role]))
  const audits: { action: string; entityId: string }[] = []
  let failAudit = false

  const store: RoleStore = {
    findRoleById: async (id) => {
      const role = roles.get(id)
      return role ? structuredClone(role) : null
    },
    findRoleByKey: async (key) => {
      const role = [...roles.values()].find((entry) => entry.key === key)
      return role ? structuredClone(role) : null
    },
    createRole: async (data) => {
      const role: StoredRole = {
        id: `role-${roles.size + 1}`,
        key: data.key,
        name: data.name,
        description: data.description,
        isSystem: false,
        isProtected: false,
        version: 1,
        permissionKeys: [...data.permissionKeys],
        memberIds: [],
      }
      roles.set(role.id, role)
      return structuredClone(role)
    },
    updateRole: async (id, data) => {
      const role = roles.get(id)!
      if (data.name !== undefined) role.name = data.name
      if (data.description !== undefined) role.description = data.description
      if (data.permissionKeys !== undefined) role.permissionKeys = [...data.permissionKeys]
      role.version += 1
      return structuredClone(role)
    },
    deleteRole: async (id) => {
      roles.delete(id)
    },
    removeAllMembers: async (id) => {
      const role = roles.get(id)!
      const count = role.memberIds.length
      role.memberIds = []
      return count
    },
    recordAudit: async (entry) => {
      if (failAudit) throw new Error("audit gagal")
      audits.push({ action: entry.action, entityId: entry.entityId })
    },
  }

  return {
    store,
    roles,
    audits,
    breakAudit: () => {
      failAudit = true
    },
  }
}

const systemAdmin = { id: "admin-1", isSystemAdmin: true, grants: new Set<string>() }

function ordinary(id: string): StoredRole {
  return {
    id,
    key: "operator_bos",
    name: "Operator BOS",
    description: null,
    isSystem: false,
    isProtected: false,
    version: 3,
    permissionKeys: ["bos.read"],
    memberIds: [],
  }
}

function protectedRole(): StoredRole {
  return {
    id: "role-sys",
    key: "system_admin",
    name: "Admin Sistem",
    description: null,
    isSystem: true,
    isProtected: true,
    version: 1,
    permissionKeys: [],
    memberIds: ["admin-1"],
  }
}

test("membuat role biasa menyimpan permission dan mencatat audit", async () => {
  const { store, audits } = makeStore()

  const role = await createRole(store, {
    actor: systemAdmin,
    key: "operator_sarpras",
    name: "Operator Sarpras",
    description: "Mengelola inventaris",
    permissionKeys: ["sarpras.read"],
  })

  assert.equal(role.key, "operator_sarpras")
  assert.deepEqual(role.permissionKeys, ["sarpras.read"])
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, "RBAC_ROLE_CREATED")
})

test("key role baru tidak boleh memakai key yang dicadangkan", async () => {
  const { store } = makeStore()

  await assert.rejects(
    () =>
      createRole(store, {
        actor: systemAdmin,
        key: "system_admin",
        name: "Tiruan",
        description: null,
        permissionKeys: [],
      }),
    (error: RoleMutationError) => error.status === 400,
  )
})

test("role biasa bernama Admin Sistem tetap dibuat tanpa metadata istimewa", async () => {
  const { store } = makeStore()

  const role = await createRole(store, {
    actor: systemAdmin,
    key: "admin_sistem_palsu",
    name: "Admin Sistem",
    description: null,
    permissionKeys: ["bos.read"],
  })

  // Nama boleh sama; yang menentukan bypass hanyalah key.
  assert.equal(role.name, "Admin Sistem")
  assert.equal(role.isSystem, false)
  assert.equal(role.isProtected, false)
  assert.notEqual(role.key, "system_admin")
})

test("mengganti nama role terproteksi diizinkan, mengubah metadata sistemnya tidak", async () => {
  const { store } = makeStore([protectedRole()])

  const renamed = await updateRoleProfile(store, {
    actor: systemAdmin,
    roleId: "role-sys",
    expectedVersion: 1,
    name: "Administrator Sekolah",
    description: "Kewenangan penuh",
  })
  assert.equal(renamed.name, "Administrator Sekolah")
  // Key tidak ikut berubah — otorisasi tidak pernah memeriksa nama tampilan.
  assert.equal(renamed.key, "system_admin")
  assert.equal(renamed.isProtected, true)
})

test("role terproteksi tidak dapat dihapus, bahkan oleh Admin Sistem", async () => {
  const { store } = makeStore([protectedRole()])

  await assert.rejects(
    () => deleteRole(store, { actor: systemAdmin, roleId: "role-sys", expectedVersion: 1 }),
    (error: RoleMutationError) => error.status === 403 && /terproteksi/i.test(error.message),
  )
})

test("duplikasi role tidak menyalin metadata sistem maupun bypass", async () => {
  const { store } = makeStore([protectedRole()])

  const clone = await cloneRole(store, {
    actor: systemAdmin,
    sourceRoleId: "role-sys",
    key: "salinan_admin",
    name: "Salinan Admin Sistem",
  })

  assert.equal(clone.key, "salinan_admin")
  assert.equal(clone.isSystem, false)
  assert.equal(clone.isProtected, false)
})

test("update dengan versi basi ditolak 409 tanpa menimpa", async () => {
  const { store, roles } = makeStore([ordinary("role-1")])

  await assert.rejects(
    () =>
      updateRoleProfile(store, {
        actor: systemAdmin,
        roleId: "role-1",
        expectedVersion: 2, // versi tersimpan 3
        name: "Nama Baru",
        description: null,
      }),
    (error: RoleMutationError) => error.status === 409,
  )

  assert.equal(roles.get("role-1")!.name, "Operator BOS", "tidak boleh tertimpa")
  assert.equal(roles.get("role-1")!.version, 3)
})

test("perubahan permission menghormati batas kewenangan aktor", async () => {
  const { store } = makeStore([ordinary("role-1")])
  const manager = {
    id: "mgr-1",
    isSystemAdmin: false,
    grants: new Set(["rbac.roles.manage", "bos.read"]),
  }

  await assert.rejects(
    () =>
      updateRolePermissions(store, {
        actor: manager,
        roleId: "role-1",
        expectedVersion: 3,
        permissionKeys: ["bos.read", "database.restore"],
      }),
    (error: RoleMutationError) => error.status === 403,
  )
})

test("payload permission ditolak seluruhnya, bukan disaring sebagian", async () => {
  const { store, roles } = makeStore([ordinary("role-1")])
  const manager = {
    id: "mgr-1",
    isSystemAdmin: false,
    grants: new Set(["rbac.roles.manage", "bos.read", "bos.entries.create"]),
  }

  await assert.rejects(() =>
    updateRolePermissions(store, {
      actor: manager,
      roleId: "role-1",
      expectedVersion: 3,
      permissionKeys: ["bos.read", "bos.entries.create", "accounts.status.manage"],
    }),
  )

  // Yang sah pun tidak boleh ikut tersimpan.
  assert.deepEqual(roles.get("role-1")!.permissionKeys, ["bos.read"])
})

test("menghapus role yang masih punya anggota mengembalikan 409", async () => {
  const role = ordinary("role-1")
  role.memberIds = ["user-1", "user-2"]
  const { store } = makeStore([role])

  await assert.rejects(
    () => deleteRole(store, { actor: systemAdmin, roleId: "role-1", expectedVersion: 3 }),
    (error: RoleMutationError) => error.status === 409 && error.memberCount === 2,
  )
})

test("penghapusan kaskade eksplisit mencabut seluruh anggota lalu menghapus", async () => {
  const role = ordinary("role-1")
  role.memberIds = ["user-1", "user-2"]
  const { store, roles, audits } = makeStore([role])

  const result = await deleteRole(store, {
    actor: systemAdmin,
    roleId: "role-1",
    expectedVersion: 3,
    revokeFromAllMembers: true,
  })

  assert.equal(result.revokedMemberCount, 2)
  assert.equal(roles.has("role-1"), false)
  assert.equal(audits.at(-1)?.action, "RBAC_ROLE_DELETED")
})

test("kegagalan audit merambat keluar sehingga transaksi pemanggil rollback", async () => {
  const { store, breakAudit } = makeStore([ordinary("role-1")])
  breakAudit()

  // Store in-memory tidak punya transaksi, jadi ia TIDAK bisa membuktikan
  // rollback. Yang dibuktikan di sini adalah prasyaratnya: kegagalan audit
  // tidak ditelan diam-diam, melainkan dilempar supaya `prisma.$transaction`
  // milik pemanggil membatalkan perubahan. Rollback sungguhan diuji terhadap
  // database nyata di tests/rbac-role-service.integration.test.ts.
  await assert.rejects(
    () =>
      updateRoleProfile(store, {
        actor: systemAdmin,
        roleId: "role-1",
        expectedVersion: 3,
        name: "Nama Baru",
        description: null,
      }),
    /audit gagal/,
  )
})

test("perubahan tanpa efek tidak menulis audit", async () => {
  const { store, audits } = makeStore([ordinary("role-1")])

  await updateRolePermissions(store, {
    actor: systemAdmin,
    roleId: "role-1",
    expectedVersion: 3,
    permissionKeys: ["bos.read"],
  })

  assert.equal(audits.length, 0, "no-op tidak boleh membanjiri audit")
})

test("dependency permission yang belum lengkap ditolak", async () => {
  const { store } = makeStore([ordinary("role-1")])

  await assert.rejects(
    () =>
      updateRolePermissions(store, {
        actor: systemAdmin,
        roleId: "role-1",
        expectedVersion: 3,
        permissionKeys: ["bos.entries.create"], // butuh bos.read
      }),
    (error: RoleMutationError) => error.status === 400 && /bos\.read/.test(error.message),
  )
})
