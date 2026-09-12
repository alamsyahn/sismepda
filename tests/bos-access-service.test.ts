import { strict as assert } from "node:assert"
import { test } from "node:test"

import { assignBosBundle, type BosBundleStore } from "../lib/bos-access-service"

function storeFixture(options: {
  rolePermissions?: string[]
  protectedTarget?: boolean
  existing?: Array<{ userId: string; roleId: string }>
} = {}) {
  const memberships = [...(options.existing ?? [{ userId: "target", roleId: "other-role" }])]
  const store: BosBundleStore = {
    findBundleRole: async (key) => key === "legacy_bos_view" ? {
      id: "view-role",
      key,
      permissionKeys: options.rolePermissions ?? ["bos.read"],
    } : null,
    findTarget: async (userId) => userId === "target" ? {
      id: userId,
      hasProtectedRole: options.protectedTarget ?? false,
    } : null,
    hasMembership: async (userId, roleId) => memberships.some((row) => row.userId === userId && row.roleId === roleId),
    createMembership: async (userId, roleId) => { memberships.push({ userId, roleId }) },
    deleteMembership: async (userId, roleId) => {
      const index = memberships.findIndex((row) => row.userId === userId && row.roleId === roleId)
      if (index >= 0) memberships.splice(index, 1)
    },
  }
  return { store, memberships }
}

test("assignBosBundle menambah hanya membership bundle yang diminta dan mempertahankan grant lain", async () => {
  const fixture = storeFixture()

  const result = await assignBosBundle(fixture.store, {
    userId: "target",
    bundleKey: "legacy_bos_view",
    assigned: true,
  })

  assert.deepEqual(result, { userId: "target", bundleKey: "legacy_bos_view", assigned: true })
  assert.deepEqual(fixture.memberships, [
    { userId: "target", roleId: "other-role" },
    { userId: "target", roleId: "view-role" },
  ])
})

test("assignBosBundle mencabut hanya membership bundle yang diminta", async () => {
  const fixture = storeFixture({ existing: [
    { userId: "target", roleId: "other-role" },
    { userId: "target", roleId: "view-role" },
  ] })
  await assignBosBundle(fixture.store, { userId: "target", bundleKey: "legacy_bos_view", assigned: false })
  assert.deepEqual(fixture.memberships, [{ userId: "target", roleId: "other-role" }])
})

test("assignBosBundle menolak key role arbitrer", async () => {
  const fixture = storeFixture()
  await assert.rejects(
    assignBosBundle(fixture.store, { userId: "target", bundleKey: "guru", assigned: true }),
    (error: unknown) => error instanceof Error && error.message === "Bundle BOS tidak diizinkan",
  )
  assert.deepEqual(fixture.memberships, [{ userId: "target", roleId: "other-role" }])
})

test("assignBosBundle menolak bundle dengan permission tambahan atau kurang", async () => {
  for (const rolePermissions of [[], ["bos.read", "roles.manage"]]) {
    const fixture = storeFixture({ rolePermissions })
    await assert.rejects(
      assignBosBundle(fixture.store, { userId: "target", bundleKey: "legacy_bos_view", assigned: true }),
      (error: unknown) => error instanceof Error && error.message === "Bundle BOS terkontaminasi",
    )
    assert.deepEqual(fixture.memberships, [{ userId: "target", roleId: "other-role" }])
  }
})

test("assignBosBundle menolak target yang memiliki role isProtected", async () => {
  const fixture = storeFixture({ protectedTarget: true })
  await assert.rejects(
    assignBosBundle(fixture.store, { userId: "target", bundleKey: "legacy_bos_view", assigned: true }),
    (error: unknown) => error instanceof Error && error.message.includes("role terlindungi"),
  )
})

test("assignBosBundle gagal tertutup bila role allowlist tidak terselesaikan", async () => {
  const fixture = storeFixture()
  fixture.store.findBundleRole = async () => null
  await assert.rejects(
    assignBosBundle(fixture.store, { userId: "target", bundleKey: "legacy_bos_view", assigned: true }),
    (error: unknown) => error instanceof Error && error.message === "Bundle BOS tidak tersedia",
  )
})

test("assignBosBundle idempoten saat membership sudah sesuai", async () => {
  const fixture = storeFixture({ existing: [{ userId: "target", roleId: "view-role" }] })
  await assignBosBundle(fixture.store, { userId: "target", bundleKey: "legacy_bos_view", assigned: true })
  assert.deepEqual(fixture.memberships, [{ userId: "target", roleId: "view-role" }])
})
