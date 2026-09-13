import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  AssignmentError,
  computeAssignmentRevision,
  updateUserRoles,
  type AssignmentStore,
} from "../lib/rbac-assignment-service"

type StoredUser = {
  id: string
  name: string
  active: boolean
  roleIds: string[]
}

const ROLES = {
  "role-admin": { id: "role-admin", key: "system_admin", name: "Admin Sistem", permissionKeys: [] },
  "role-guru": { id: "role-guru", key: "guru", name: "Guru", permissionKeys: ["attendance.read.assigned_classes"] },
  "role-bos": { id: "role-bos", key: "operator_bos", name: "Operator BOS", permissionKeys: ["bos.read"] },
  "role-rbac": {
    id: "role-rbac",
    key: "manajer_rbac",
    name: "Manajer RBAC",
    permissionKeys: ["rbac.roles.manage"],
  },
}

function makeStore(users: StoredUser[], activeAdminIds: string[] = ["admin-other"]) {
  const store_ = new Map(users.map((user) => [user.id, user]))
  const audits: { action: string; summary: string }[] = []
  const admins = new Set(activeAdminIds)

  const store: AssignmentStore = {
    findUser: async (id) => {
      const user = store_.get(id)
      return user ? { id: user.id, name: user.name, active: user.active, roleIds: [...user.roleIds] } : null
    },
    findRoles: async (ids) => ids.map((id) => ROLES[id as keyof typeof ROLES]).filter(Boolean),
    replaceRoles: async (userId, roleIds) => {
      const user = store_.get(userId)!
      user.roleIds = [...roleIds]
      if (roleIds.includes("role-admin")) admins.add(userId)
      else admins.delete(userId)
    },
    countOtherActiveSystemAdmins: async (excludeUserId) =>
      [...admins].filter((id) => id !== excludeUserId).length,
    recordAudit: async (entry) => {
      audits.push({ action: entry.action, summary: entry.summary })
    },
  }

  return { store, users: store_, audits }
}

const systemAdmin = { id: "admin-1", isSystemAdmin: true, grants: new Set<string>() }

test("revisi penugasan berasal dari isi himpunan role, bukan urutannya", () => {
  const a = computeAssignmentRevision(["role-guru", "role-bos"])
  const b = computeAssignmentRevision(["role-bos", "role-guru"])
  assert.equal(a, b)

  const c = computeAssignmentRevision(["role-guru"])
  assert.notEqual(a, c)
})

test("revisi himpunan kosong stabil dan berbeda dari himpunan berisi", () => {
  assert.equal(computeAssignmentRevision([]), computeAssignmentRevision([]))
  assert.notEqual(computeAssignmentRevision([]), computeAssignmentRevision(["role-guru"]))
})

test("mengganti role pengguna menyimpan himpunan baru dan mencatat audit", async () => {
  const { store, users, audits } = makeStore([
    { id: "user-1", name: "Budi", active: true, roleIds: ["role-guru"] },
  ])

  const result = await updateUserRoles(store, {
    actor: systemAdmin,
    userId: "user-1",
    roleIds: ["role-guru", "role-bos"],
    expectedRevision: computeAssignmentRevision(["role-guru"]),
  })

  assert.deepEqual(users.get("user-1")!.roleIds.sort(), ["role-bos", "role-guru"])
  assert.equal(result.added.length, 1)
  assert.equal(audits.at(-1)?.action, "RBAC_USER_ROLES_CHANGED")
})

test("revisi basi ditolak 409 tanpa menimpa", async () => {
  const { store, users } = makeStore([
    { id: "user-1", name: "Budi", active: true, roleIds: ["role-guru", "role-bos"] },
  ])

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: systemAdmin,
        userId: "user-1",
        roleIds: ["role-guru"],
        // Klien mengira pengguna hanya punya role-guru; nyatanya sudah dua.
        expectedRevision: computeAssignmentRevision(["role-guru"]),
      }),
    (error: AssignmentError) => error.status === 409,
  )

  assert.deepEqual(users.get("user-1")!.roleIds.sort(), ["role-bos", "role-guru"])
})

test("mengosongkan seluruh role menghasilkan pengguna zero-role", async () => {
  const { store, users, audits } = makeStore([
    { id: "user-1", name: "Budi", active: true, roleIds: ["role-guru"] },
  ])

  await updateUserRoles(store, {
    actor: systemAdmin,
    userId: "user-1",
    roleIds: [],
    expectedRevision: computeAssignmentRevision(["role-guru"]),
  })

  assert.deepEqual(users.get("user-1")!.roleIds, [])
  assert.match(audits.at(-1)!.summary, /tanpa role/i)
})

test("hanya Admin Sistem yang boleh memberikan role system_admin", async () => {
  const { store } = makeStore([{ id: "user-1", name: "Budi", active: true, roleIds: [] }])
  const manager = { id: "mgr-1", isSystemAdmin: false, grants: new Set(["rbac.assignments.manage"]) }

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: manager,
        userId: "user-1",
        roleIds: ["role-admin"],
        expectedRevision: computeAssignmentRevision([]),
      }),
    (error: AssignmentError) => error.status === 403,
  )
})

test("manager non-system tidak boleh memberikan role berkewenangan sensitif", async () => {
  const { store } = makeStore([{ id: "user-1", name: "Budi", active: true, roleIds: [] }])
  const manager = {
    id: "mgr-1",
    isSystemAdmin: false,
    grants: new Set(["rbac.assignments.manage", "rbac.roles.manage"]),
  }

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: manager,
        userId: "user-1",
        roleIds: ["role-rbac"],
        expectedRevision: computeAssignmentRevision([]),
      }),
    (error: AssignmentError) => error.status === 403,
  )
})

test("manager non-system tidak boleh memberikan role biasa di luar grant miliknya", async () => {
  const { store, users } = makeStore([
    { id: "user-1", name: "Budi", active: true, roleIds: ["role-guru"] },
  ])
  const manager = {
    id: "mgr-1",
    isSystemAdmin: false,
    grants: new Set(["rbac.assignments.manage"]),
  }

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: manager,
        userId: "user-1",
        roleIds: ["role-guru", "role-bos"],
        expectedRevision: computeAssignmentRevision(["role-guru"]),
      }),
    (error: AssignmentError) => error.status === 403 && /tidak Anda miliki/i.test(error.message),
  )
  assert.deepEqual(users.get("user-1")!.roleIds, ["role-guru"], "payload ditolak seluruhnya")
})

test("mencabut system_admin terakhir ditolak", async () => {
  const { store } = makeStore(
    [{ id: "admin-1", name: "Admin", active: true, roleIds: ["role-admin"] }],
    ["admin-1"], // satu-satunya admin aktif
  )

  // Service menulis lebih dulu lalu memeriksa populasi akhir, dan melempar bila
  // kosong — sehingga `prisma.$transaction` milik pemanggil rollback. Store
  // in-memory tidak bertransaksi, jadi yang dibuktikan di sini adalah
  // penolakannya; pemulihan baris diuji terhadap database nyata di
  // tests/rbac-invariants.integration.test.ts.
  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: systemAdmin,
        userId: "admin-1",
        roleIds: [],
        expectedRevision: computeAssignmentRevision(["role-admin"]),
        confirmSelfRevoke: true,
      }),
    (error: AssignmentError) => error.status === 409 && /Admin Sistem aktif/i.test(error.message),
  )
})

test("mencabut system_admin dari diri sendiri butuh konfirmasi eksplisit", async () => {
  const { store } = makeStore(
    [{ id: "admin-1", name: "Admin", active: true, roleIds: ["role-admin"] }],
    ["admin-1", "admin-2"],
  )

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: systemAdmin,
        userId: "admin-1",
        roleIds: [],
        expectedRevision: computeAssignmentRevision(["role-admin"]),
      }),
    (error: AssignmentError) => error.status === 409 && /konfirmasi/i.test(error.message),
  )
})

test("role yang tidak ada ditolak, bukan diabaikan diam-diam", async () => {
  const { store } = makeStore([{ id: "user-1", name: "Budi", active: true, roleIds: [] }])

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: systemAdmin,
        userId: "user-1",
        roleIds: ["role-guru", "role-hantu"],
        expectedRevision: computeAssignmentRevision([]),
      }),
    (error: AssignmentError) => error.status === 400,
  )
})

test("penugasan tanpa perubahan tidak menulis audit", async () => {
  const { store, audits } = makeStore([
    { id: "user-1", name: "Budi", active: true, roleIds: ["role-guru"] },
  ])

  await updateUserRoles(store, {
    actor: systemAdmin,
    userId: "user-1",
    roleIds: ["role-guru"],
    expectedRevision: computeAssignmentRevision(["role-guru"]),
  })

  assert.equal(audits.length, 0)
})
