import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  assertAccountMutationAllowed,
  assertSystemAdminRemains,
  type AccountMutation,
} from "../lib/rbac-invariants"

test("mencabut system_admin ditolak saat ia satu-satunya yang aktif", () => {
  const denial = assertSystemAdminRemains({
    remainingActiveAdminIds: [],
    actorId: "admin-1",
    targetId: "admin-1",
  })
  assert.equal(denial?.reason, "last_system_admin")
})

test("mencabut system_admin diizinkan saat masih ada admin aktif lain", () => {
  assert.equal(
    assertSystemAdminRemains({
      remainingActiveAdminIds: ["admin-2"],
      actorId: "admin-1",
      targetId: "admin-1",
    }),
    null,
  )
})

test("target yang tetap Admin Sistem setelah perubahan tidak ditolak", () => {
  // `remainingActiveAdminIds` adalah KONDISI AKHIR yang dibaca setelah
  // perubahan ditulis, jadi target yang masih menyandang Admin Sistem memang
  // muncul di sana dan harus dihitung. Mengecualikannya di sini membuat
  // perubahan role lain — misalnya melepas Guru legacy — ikut tertolak walau
  // populasi admin tidak pernah berkurang.
  assert.equal(
    assertSystemAdminRemains({
      remainingActiveAdminIds: ["admin-1"],
      actorId: "admin-1",
      targetId: "admin-1",
    }),
    null,
  )
})

test("kondisi akhir tanpa Admin Sistem tetap ditolak walau target bukan aktornya", () => {
  const denial = assertSystemAdminRemains({
    remainingActiveAdminIds: [],
    actorId: "admin-1",
    targetId: "admin-2",
  })
  assert.equal(denial?.reason, "last_system_admin")
})

function mutation(overrides: Partial<AccountMutation> = {}): AccountMutation {
  return {
    actorId: "admin-1",
    actorIsSystemAdmin: true,
    target: {
      id: "user-2",
      isSystemAdmin: false,
      hasSensitiveAuthority: false,
      active: true,
    },
    intent: "update_status",
    ...overrides,
  }
}

test("admin tidak boleh menonaktifkan dirinya sendiri", () => {
  const denial = assertAccountMutationAllowed(
    mutation({
      target: { id: "admin-1", isSystemAdmin: true, hasSensitiveAuthority: true, active: true },
      intent: "deactivate",
    }),
  )
  assert.equal(denial?.reason, "self_disable")
})

test("admin tidak boleh menghapus dirinya sendiri", () => {
  const denial = assertAccountMutationAllowed(
    mutation({
      target: { id: "admin-1", isSystemAdmin: true, hasSensitiveAuthority: true, active: true },
      intent: "delete",
    }),
  )
  assert.equal(denial?.reason, "self_delete")
})

test("non-system-admin tidak boleh mengubah kredensial akun istimewa", () => {
  const denial = assertAccountMutationAllowed(
    mutation({
      actorIsSystemAdmin: false,
      target: { id: "admin-9", isSystemAdmin: true, hasSensitiveAuthority: true, active: true },
      intent: "update_credentials",
    }),
  )
  assert.equal(denial?.reason, "privileged_target")
})

test("pemegang kewenangan sensitif juga target istimewa, walau bukan system_admin", () => {
  // Melindungi hanya literal system_admin akan membiarkan pengambilalihan
  // akun manager RBAC lewat reset password.
  const denial = assertAccountMutationAllowed(
    mutation({
      actorIsSystemAdmin: false,
      target: { id: "manager-1", isSystemAdmin: false, hasSensitiveAuthority: true, active: true },
      intent: "update_credentials",
    }),
  )
  assert.equal(denial?.reason, "privileged_target")
})

test("non-system-admin tidak boleh mengubah status akun istimewa", () => {
  const denial = assertAccountMutationAllowed(
    mutation({
      actorIsSystemAdmin: false,
      target: { id: "manager-1", isSystemAdmin: false, hasSensitiveAuthority: true, active: true },
      intent: "deactivate",
    }),
  )
  assert.equal(denial?.reason, "privileged_target")
})

test("non-system-admin boleh mengelola akun biasa", () => {
  assert.equal(
    assertAccountMutationAllowed(
      mutation({
        actorIsSystemAdmin: false,
        target: { id: "guru-1", isSystemAdmin: false, hasSensitiveAuthority: false, active: true },
        intent: "update_credentials",
      }),
    ),
    null,
  )
})

test("hanya system admin yang boleh memberi atau mencabut system_admin", () => {
  for (const intent of ["grant_system_admin", "revoke_system_admin"] as const) {
    const denial = assertAccountMutationAllowed(
      mutation({
        actorIsSystemAdmin: false,
        target: { id: "user-2", isSystemAdmin: false, hasSensitiveAuthority: false, active: true },
        intent,
      }),
    )
    assert.equal(denial?.reason, "system_admin_grant_requires_system_admin")
  }
})

test("mencabut system_admin milik sendiri menuntut konfirmasi eksplisit", () => {
  const withoutConfirmation = assertAccountMutationAllowed(
    mutation({
      target: { id: "admin-1", isSystemAdmin: true, hasSensitiveAuthority: true, active: true },
      intent: "revoke_system_admin",
    }),
  )
  assert.equal(withoutConfirmation?.reason, "self_revoke_requires_confirmation")

  assert.equal(
    assertAccountMutationAllowed(
      mutation({
        target: { id: "admin-1", isSystemAdmin: true, hasSensitiveAuthority: true, active: true },
        intent: "revoke_system_admin",
        confirmSelfRevoke: true,
      }),
    ),
    null,
  )
})
