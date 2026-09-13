import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  assertRoleMutationAllowed,
  describeAuthorityDenial,
  type AuthorityActor,
  type TargetRole,
} from "../lib/rbac-authority"

const ordinaryRole: TargetRole = {
  key: "operator_bos",
  name: "Operator BOS",
  isProtected: false,
  isSystem: false,
}

const protectedRole: TargetRole = {
  key: "system_admin",
  name: "Admin Sistem",
  isProtected: true,
  isSystem: true,
}

/** Manager global non-system: boleh kelola role, tetapi hanya sebatas haknya. */
function manager(grants: string[]): AuthorityActor {
  return { isSystemAdmin: false, grants: new Set(grants) }
}

const systemAdmin: AuthorityActor = { isSystemAdmin: true, grants: new Set() }

test("system admin boleh memberi permission sensitif apa pun", () => {
  assert.equal(
    assertRoleMutationAllowed({
      actor: systemAdmin,
      role: ordinaryRole,
      addedKeys: ["rbac.roles.manage", "database.restore"],
      removedKeys: [],
    }),
    null,
  )
})

test("manager non-system tidak boleh memberi permission yang tidak ia pegang sendiri", () => {
  const denial = assertRoleMutationAllowed({
    actor: manager(["rbac.roles.read", "rbac.roles.manage", "attendance.read.all"]),
    role: ordinaryRole,
    addedKeys: ["attendance.read.all", "students.master.update"],
    removedKeys: [],
  })

  assert.equal(denial?.reason, "beyond_own_authority")
  assert.deepEqual(denial?.keys, ["students.master.update"])
})

test("manager non-system tidak boleh memberi kewenangan sensitif meski ia memegangnya", () => {
  // Memegang sebuah kewenangan sensitif tidak berarti berhak MENDELEGASIKANNYA.
  // Tanpa aturan ini, satu manager bisa mengkloning dirinya tanpa batas.
  const denial = assertRoleMutationAllowed({
    actor: manager(["rbac.roles.read", "rbac.roles.manage", "accounts.credentials.manage"]),
    role: ordinaryRole,
    addedKeys: ["accounts.credentials.manage"],
    removedKeys: [],
  })

  assert.equal(denial?.reason, "sensitive_requires_system_admin")
  assert.deepEqual(denial?.keys, ["accounts.credentials.manage"])
})

test("manager non-system tidak boleh menyentuh role terproteksi", () => {
  const denial = assertRoleMutationAllowed({
    actor: manager(["rbac.roles.read", "rbac.roles.manage"]),
    role: protectedRole,
    addedKeys: [],
    removedKeys: ["attendance.read.all"],
  })

  assert.equal(denial?.reason, "protected_role")
})

test("mencabut kewenangan sensitif juga menuntut system admin", () => {
  // Mencabut adalah perubahan kewenangan sensitif: manager tidak boleh
  // melumpuhkan role pengawas lain lalu mengisi kekosongannya.
  const denial = assertRoleMutationAllowed({
    actor: manager(["rbac.roles.read", "rbac.roles.manage"]),
    role: ordinaryRole,
    addedKeys: [],
    removedKeys: ["rbac.assignments.manage"],
  })

  assert.equal(denial?.reason, "sensitive_requires_system_admin")
  assert.deepEqual(denial?.keys, ["rbac.assignments.manage"])
})

test("manager non-system boleh mengelola permission biasa yang ia pegang", () => {
  assert.equal(
    assertRoleMutationAllowed({
      actor: manager(["rbac.roles.read", "rbac.roles.manage", "bos.read", "bos.entries.create"]),
      role: ordinaryRole,
      addedKeys: ["bos.read", "bos.entries.create"],
      removedKeys: [],
    }),
    null,
  )
})

test("seluruh mutasi ditolak, bukan permission terlarang yang dibuang diam-diam", () => {
  const denial = assertRoleMutationAllowed({
    actor: manager(["rbac.roles.read", "rbac.roles.manage", "bos.read"]),
    role: ordinaryRole,
    addedKeys: ["bos.read", "database.restore"],
    removedKeys: [],
  })

  // Kontraknya: kembalikan penolakan untuk SELURUH payload. Tidak ada bentuk
  // pengembalian "daftar yang disetujui" yang bisa dipakai pemanggil untuk
  // menyimpan sebagian.
  assert.notEqual(denial, null)
  assert.equal(Object.hasOwn(denial ?? {}, "allowedKeys"), false)
  assert.equal(Object.hasOwn(denial ?? {}, "sanitized"), false)
})

test("key di luar registry ditolak sebagai tidak dikenal, bukan diabaikan", () => {
  const denial = assertRoleMutationAllowed({
    actor: systemAdmin,
    role: ordinaryRole,
    addedKeys: ["bos.read", "tidak.ada.di.registry"],
    removedKeys: [],
  })

  assert.equal(denial?.reason, "unknown_permission")
  assert.deepEqual(denial?.keys, ["tidak.ada.di.registry"])
})

test("describeAuthorityDenial memetakan tiap alasan ke 403 dengan pesan yang bisa dibaca", () => {
  for (const reason of [
    "beyond_own_authority",
    "sensitive_requires_system_admin",
    "protected_role",
  ] as const) {
    const failure = describeAuthorityDenial({ reason, keys: ["rbac.roles.manage"] })
    assert.equal(failure.status, 403)
    assert.equal(typeof failure.error, "string")
    assert.ok(failure.error.length > 0)
  }

  // Payload tidak valid adalah kesalahan permintaan, bukan kekurangan hak.
  assert.equal(describeAuthorityDenial({ reason: "unknown_permission", keys: ["x"] }).status, 400)
})
