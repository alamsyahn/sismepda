/**
 * Regresi RBAC untuk tiga kegagalan yang saling berkaitan:
 *
 *   1. Admin Sistem membuka modul Jadwal dan tidak melihat satu bagian pun.
 *   2. Role Guru legacy tidak dapat dilepas dari akun yang juga Admin Sistem.
 *   3. Permission kategori Schedule gagal disimpan di editor role.
 *
 * Ketiganya berbagi satu akar: himpunan permission yang dipakai untuk
 * MEMUTUSKAN berbeda dari himpunan yang dipakai untuk MENAMPILKAN/MENYIMPAN.
 *
 * Berkas ini mengunci perilaku yang benar tanpa database: seluruh store
 * disuntikkan sebagai objek biasa, persis seperti yang dilakukan route handler
 * dengan client transaksi.
 */
import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  collectGrants,
  effectiveGrants,
  hasPermission,
  type AuthorizationSubject,
} from "../lib/rbac"
import { PERMISSION_KEYS, SYSTEM_ADMIN_ROLE_KEY } from "../lib/rbac-permissions"
import { assertSystemAdminRemains } from "../lib/rbac-invariants"
import {
  AssignmentError,
  computeAssignmentRevision,
  updateUserRoles,
  type AssignmentRole,
  type AssignmentStore,
} from "../lib/rbac-assignment-service"
import {
  RoleMutationError,
  updateRolePermissions,
  type RoleRecord,
  type RoleStore,
} from "../lib/rbac-role-service"
import {
  SCHEDULE_PAGE_PERMISSIONS,
  scheduleCapabilitiesFromGrants,
  visibleScheduleTabs,
} from "../lib/schedule-authorization"

const SCHEDULE_KEYS = [
  "schedule.own.read",
  "schedule.classes.read",
  "schedule.teachers.read",
  "schedule.free_teachers.read",
  "schedule.entries.create",
  "schedule.entries.update",
  "schedule.entries.delete",
  "schedule.time.manage",
  "schedule.import",
  "schedule.revisions.read",
  "schedule.revisions.rollback",
] as const

function subject(
  roles: { key: string; permissionKeys: string[] }[],
  isTeacher = false,
): AuthorizationSubject {
  return {
    userId: "u-1",
    isTeacher,
    roles: roles.map((role, index) => ({
      id: `r-${index}`,
      key: role.key,
      name: role.key,
      permissionKeys: role.permissionKeys,
    })),
  }
}

// ---------------------------------------------------------------------------
// A. Permission Schedule dikenal registry dan dapat disimpan
// ---------------------------------------------------------------------------

test("A1: seluruh schedule.* dikenal canonical permission registry", () => {
  const known = new Set(PERMISSION_KEYS)
  for (const key of SCHEDULE_KEYS) {
    assert.ok(known.has(key), `permission schedule tidak ada di registry: ${key}`)
  }
})

/**
 * Store role in-memory. Sengaja memodelkan HANYA aturan service; kegagalan
 * katalog database diuji terpisah karena ia hidup di adapter Prisma.
 */
function roleStore(initial: RoleRecord) {
  let record = { ...initial, permissionKeys: [...initial.permissionKeys] }
  const audits: string[] = []

  const store: RoleStore = {
    findRoleById: async (id) => (id === record.id ? { ...record } : null),
    findRoleByKey: async (key) => (key === record.key ? { ...record } : null),
    createRole: async () => {
      throw new Error("tidak dipakai")
    },
    updateRole: async (id, expectedVersion, data) => {
      if (id !== record.id || record.version !== expectedVersion) return null
      record = {
        ...record,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.description === undefined ? {} : { description: data.description }),
        ...(data.permissionKeys === undefined ? {} : { permissionKeys: [...data.permissionKeys] }),
        version: record.version + 1,
      }
      return { ...record }
    },
    deleteRole: async () => true,
    removeAllMembers: async () => 0,
    recordAudit: async (entry) => {
      audits.push(entry.summary)
    },
  }

  return { store, audits, current: () => record }
}

function baseRole(permissionKeys: string[] = []): RoleRecord {
  return {
    id: "role-1",
    key: "kurikulum",
    name: "Kurikulum",
    description: null,
    isSystem: false,
    isProtected: false,
    version: 1,
    permissionKeys,
    memberIds: [],
  }
}

const systemAdminActor = {
  id: "actor-admin",
  isSystemAdmin: true,
  grants: new Set<string>(),
}

test("A2: role dengan schedule.own.read dapat menyimpan permission", async () => {
  const { store, current } = roleStore(baseRole())

  const updated = await updateRolePermissions(store, {
    actor: systemAdminActor,
    roleId: "role-1",
    expectedVersion: 1,
    permissionKeys: ["schedule.own.read"],
  })

  assert.deepEqual(updated.permissionKeys, ["schedule.own.read"])
  assert.deepEqual(current().permissionKeys, ["schedule.own.read"])
})

test("A3: role dengan SELURUH schedule.* dapat menyimpan permission", async () => {
  const { store } = roleStore(baseRole())

  const updated = await updateRolePermissions(store, {
    actor: systemAdminActor,
    roleId: "role-1",
    expectedVersion: 1,
    permissionKeys: [...SCHEDULE_KEYS],
  })

  assert.deepEqual([...updated.permissionKeys].sort(), [...SCHEDULE_KEYS].sort())
})

test("A4: permission schedule dapat diberikan lalu dicabut kembali", async () => {
  const { store } = roleStore(baseRole())

  const granted = await updateRolePermissions(store, {
    actor: systemAdminActor,
    roleId: "role-1",
    expectedVersion: 1,
    permissionKeys: ["schedule.classes.read", "schedule.revisions.read"],
  })
  assert.equal(granted.permissionKeys.length, 2)

  const revoked = await updateRolePermissions(store, {
    actor: systemAdminActor,
    roleId: "role-1",
    expectedVersion: granted.version,
    permissionKeys: ["schedule.classes.read"],
  })
  assert.deepEqual(revoked.permissionKeys, ["schedule.classes.read"])
})

test("A5: permission non-schedule yang sudah bekerja tetap bekerja", async () => {
  const { store } = roleStore(baseRole(["bos.read"]))

  const updated = await updateRolePermissions(store, {
    actor: systemAdminActor,
    roleId: "role-1",
    expectedVersion: 1,
    permissionKeys: ["bos.read", "sarpras.read"],
  })

  assert.deepEqual([...updated.permissionKeys].sort(), ["bos.read", "sarpras.read"])
})

test("A6: menyimpan schedule bersama permission modul lain tetap satu payload utuh", async () => {
  const { store } = roleStore(baseRole(["bos.read"]))

  const updated = await updateRolePermissions(store, {
    actor: systemAdminActor,
    roleId: "role-1",
    expectedVersion: 1,
    permissionKeys: ["bos.read", "schedule.own.read", "schedule.classes.read"],
  })

  assert.deepEqual([...updated.permissionKeys].sort(), [
    "bos.read",
    "schedule.classes.read",
    "schedule.own.read",
  ])
})

test("A7: key schedule yang salah ketik tetap ditolak registry", async () => {
  const { store } = roleStore(baseRole())

  await assert.rejects(
    () =>
      updateRolePermissions(store, {
        actor: systemAdminActor,
        roleId: "role-1",
        expectedVersion: 1,
        permissionKeys: ["schedule.own.reed"],
      }),
    (error: unknown) => error instanceof RoleMutationError && error.status === 400,
  )
})

// ---------------------------------------------------------------------------
// B. Permission efektif = union OR seluruh role
// ---------------------------------------------------------------------------

test("B1: dua role schedule digabung sebagai union", () => {
  const actor = subject([
    { key: "role-a", permissionKeys: ["schedule.own.read"] },
    { key: "role-b", permissionKeys: ["schedule.teachers.read"] },
  ])

  const grants = effectiveGrants(actor)
  assert.ok(grants.has("schedule.own.read"))
  assert.ok(grants.has("schedule.teachers.read"))
  assert.equal(grants.size, 2)

  assert.equal(hasPermission(actor, "schedule.own.read"), true)
  assert.equal(hasPermission(actor, "schedule.teachers.read"), true)
  assert.equal(hasPermission(actor, "schedule.import"), false)
})

test("B2: role yang tumpang tindih tidak menggandakan grant", () => {
  const actor = subject([
    { key: "role-a", permissionKeys: ["schedule.own.read", "schedule.classes.read"] },
    { key: "role-b", permissionKeys: ["schedule.own.read", "schedule.import"] },
  ])

  assert.deepEqual([...effectiveGrants(actor)].sort(), [
    "schedule.classes.read",
    "schedule.import",
    "schedule.own.read",
  ])
})

// ---------------------------------------------------------------------------
// C. Akses halaman Jadwal
// ---------------------------------------------------------------------------

test("C1: tanpa permission schedule, tidak ada tab yang terbuka", () => {
  const actor = subject([{ key: "guru", permissionKeys: ["attendance.read.assigned_classes"] }], true)
  const tabs = visibleScheduleTabs(scheduleCapabilitiesFromGrants(effectiveGrants(actor)))
  assert.deepEqual(tabs, [])
})

test("C2: schedule.own.read membuka jadwal diri sendiri", () => {
  const actor = subject([{ key: "guru", permissionKeys: ["schedule.own.read"] }], true)
  const capabilities = scheduleCapabilitiesFromGrants(effectiveGrants(actor))

  assert.equal(capabilities.ownRead, true)
  assert.equal(capabilities.classRead, false)
  assert.deepEqual(visibleScheduleTabs(capabilities), ["saya"])
})

test("C3: schedule.classes.read membuka jadwal kelas", () => {
  const actor = subject([{ key: "wakur", permissionKeys: ["schedule.classes.read"] }])
  const capabilities = scheduleCapabilitiesFromGrants(effectiveGrants(actor))

  assert.equal(capabilities.classRead, true)
  assert.deepEqual(visibleScheduleTabs(capabilities), ["kelas"])
})

test("C4: beberapa permission membuka gabungan section", () => {
  const actor = subject([
    { key: "a", permissionKeys: ["schedule.own.read", "schedule.classes.read"] },
    { key: "b", permissionKeys: ["schedule.free_teachers.read", "schedule.time.manage"] },
  ])
  const capabilities = scheduleCapabilitiesFromGrants(effectiveGrants(actor))

  assert.deepEqual(visibleScheduleTabs(capabilities), ["saya", "kelas", "jam-kosong", "waktu"])
})

/**
 * Regresi BUG 1.
 *
 * Role `system_admin` sengaja TIDAK memiliki baris `RolePermission`. Modul yang
 * menurunkan kemampuannya dari baris mentah karena itu melihat himpunan kosong
 * dan menampilkan "Anda belum memiliki izin untuk melihat bagian mana pun dari
 * modul Jadwal" — padahal guard halamannya lolos lewat bypass.
 */
test("C5: Admin Sistem tanpa RolePermission membuka SELURUH section Jadwal", () => {
  const admin = subject([{ key: SYSTEM_ADMIN_ROLE_KEY, permissionKeys: [] }])

  // Baris mentah memang kosong — itulah kondisi yang memicu bug.
  assert.equal(collectGrants(admin).size, 0)

  const grants = effectiveGrants(admin)
  for (const key of SCHEDULE_KEYS) {
    assert.ok(grants.has(key), `grant efektif kehilangan ${key}`)
  }

  const capabilities = scheduleCapabilitiesFromGrants(grants)
  assert.deepEqual(visibleScheduleTabs(capabilities), [
    "saya",
    "kelas",
    "jam-kosong",
    "kelola",
    "waktu",
  ])
  assert.equal(capabilities.rollback, true)
})

test("C6: guard halaman dan isi modul sepakat untuk Admin Sistem", () => {
  const admin = subject([{ key: SYSTEM_ADMIN_ROLE_KEY, permissionKeys: [] }])

  // Guard halaman memakai hasPermission; isi modul memakai grants efektif.
  // Keduanya harus memberi jawaban yang sama, kalau tidak halaman terbuka
  // tetapi kosong — persis gejala yang dilaporkan.
  const pageAllowed = SCHEDULE_PAGE_PERMISSIONS.some((key) => hasPermission(admin, key))
  const tabs = visibleScheduleTabs(scheduleCapabilitiesFromGrants(effectiveGrants(admin)))

  assert.equal(pageAllowed, true)
  assert.ok(tabs.length > 0, "guard meloloskan halaman tetapi tidak ada tab yang tampil")
})

test("C7: bypass hanya milik key system_admin, bukan role yang sekadar bernama sama", () => {
  const impostor: AuthorizationSubject = {
    userId: "u-impostor",
    isTeacher: false,
    roles: [{ id: "r-x", key: "admin_sistem_tiruan", name: "Admin Sistem", permissionKeys: [] }],
  }

  assert.equal(effectiveGrants(impostor).size, 0)
  assert.equal(hasPermission(impostor, "schedule.own.read"), false)
})

// ---------------------------------------------------------------------------
// D. Proteksi Admin Sistem terakhir
// ---------------------------------------------------------------------------

function assignmentStore(input: {
  userId: string
  roleIds: string[]
  roles: AssignmentRole[]
  otherActiveAdmins: number
}) {
  let assigned = [...input.roleIds]
  const store: AssignmentStore = {
    findUser: async (id) =>
      id === input.userId
        ? { id: input.userId, name: "Target", active: true, roleIds: [...assigned] }
        : null,
    findRoles: async (ids) => input.roles.filter((role) => ids.includes(role.id)),
    replaceRoles: async (_userId, roleIds) => {
      assigned = [...roleIds]
    },
    countOtherActiveSystemAdmins: async () => input.otherActiveAdmins,
    recordAudit: async () => {},
  }
  return { store, assigned: () => assigned }
}

const ADMIN_ROLE: AssignmentRole = {
  id: "role-admin",
  key: SYSTEM_ADMIN_ROLE_KEY,
  name: "Admin Sistem",
  permissionKeys: [],
}
const GURU_ROLE: AssignmentRole = {
  id: "role-guru",
  key: "legacy_guru",
  name: "Kompatibilitas: Guru",
  permissionKeys: ["attendance.read.assigned_classes"],
}

/**
 * Regresi BUG 2.
 *
 * Invariant pernah membuang target dari daftar admin tersisa, sehingga
 * satu-satunya Admin Sistem dinyatakan "tidak ada" walau ia TETAP admin setelah
 * perubahan — melepas Guru legacy pun ikut ditolak.
 */
test("D1: melepas Guru legacy sementara Admin Sistem dipertahankan → SUKSES", async () => {
  const { store, assigned } = assignmentStore({
    userId: "user-a",
    roleIds: [ADMIN_ROLE.id, GURU_ROLE.id],
    roles: [ADMIN_ROLE, GURU_ROLE],
    otherActiveAdmins: 0,
  })

  const result = await updateUserRoles(store, {
    actor: { id: "user-a", isSystemAdmin: true, grants: new Set() },
    userId: "user-a",
    roleIds: [ADMIN_ROLE.id],
    expectedRevision: computeAssignmentRevision([ADMIN_ROLE.id, GURU_ROLE.id]),
  })

  assert.deepEqual(result.removed.map((role) => role.key), ["legacy_guru"])
  assert.deepEqual(assigned(), [ADMIN_ROLE.id])
})

test("D2: mencabut Admin Sistem terakhir → DITOLAK", async () => {
  const { store } = assignmentStore({
    userId: "user-a",
    roleIds: [ADMIN_ROLE.id],
    roles: [ADMIN_ROLE, GURU_ROLE],
    otherActiveAdmins: 0,
  })

  await assert.rejects(
    () =>
      updateUserRoles(store, {
        actor: { id: "user-a", isSystemAdmin: true, grants: new Set() },
        userId: "user-a",
        roleIds: [GURU_ROLE.id],
        expectedRevision: computeAssignmentRevision([ADMIN_ROLE.id]),
        confirmSelfRevoke: true,
      }),
    (error: unknown) => error instanceof AssignmentError && error.status === 409,
  )
})

test("D3: mencabut Admin Sistem sendiri saat masih ada admin aktif lain → SUKSES", async () => {
  const { store, assigned } = assignmentStore({
    userId: "user-a",
    roleIds: [ADMIN_ROLE.id],
    roles: [ADMIN_ROLE, GURU_ROLE],
    otherActiveAdmins: 1,
  })

  await updateUserRoles(store, {
    actor: { id: "user-a", isSystemAdmin: true, grants: new Set() },
    userId: "user-a",
    roleIds: [GURU_ROLE.id],
    expectedRevision: computeAssignmentRevision([ADMIN_ROLE.id]),
    confirmSelfRevoke: true,
  })

  assert.deepEqual(assigned(), [GURU_ROLE.id])
})

test("D4: perubahan role yang tidak menyentuh Admin Sistem tidak disentuh invariant", async () => {
  const OTHER: AssignmentRole = {
    id: "role-uks",
    key: "pengurus_uks",
    name: "Pengurus UKS",
    permissionKeys: ["euks.overview.read"],
  }
  const { store, assigned } = assignmentStore({
    userId: "user-b",
    roleIds: [GURU_ROLE.id],
    roles: [GURU_ROLE, OTHER],
    otherActiveAdmins: 0,
  })

  await updateUserRoles(store, {
    actor: { id: "actor-admin", isSystemAdmin: true, grants: new Set() },
    userId: "user-b",
    roleIds: [GURU_ROLE.id, OTHER.id],
    expectedRevision: computeAssignmentRevision([GURU_ROLE.id]),
  })

  assert.deepEqual(assigned().sort(), [GURU_ROLE.id, OTHER.id].sort())
})

test("D5: invariant menilai KONDISI AKHIR, bukan identitas target", () => {
  // Target masih admin setelah perubahan: harus lolos meski ia satu-satunya.
  assert.equal(
    assertSystemAdminRemains({
      remainingActiveAdminIds: ["user-a"],
      actorId: "user-a",
      targetId: "user-a",
    }),
    null,
  )

  // Tidak ada admin tersisa sama sekali: harus ditolak.
  assert.equal(
    assertSystemAdminRemains({
      remainingActiveAdminIds: [],
      actorId: "user-a",
      targetId: "user-a",
    })?.reason,
    "last_system_admin",
  )
})
