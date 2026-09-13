import { strict as assert } from "node:assert"
import { test } from "node:test"

import { PERMISSIONS, SENSITIVE_AUTHORITY_FAMILIES, isSensitiveAuthority } from "../lib/rbac-permissions"

test("keluarga authority sensitif mencakup rbac, accounts, database, class_access, dan homerooms.assign", () => {
  assert.deepEqual([...SENSITIVE_AUTHORITY_FAMILIES].sort(), [
    "accounts",
    "database",
    "homerooms.assign",
    "rbac",
    "school.class_access.manage",
  ])
})

test("isSensitiveAuthority mengenali anggota keluarga berdasarkan segmen key, bukan substring", () => {
  assert.equal(isSensitiveAuthority("rbac.roles.manage"), true)
  assert.equal(isSensitiveAuthority("rbac.audit.read"), true)
  assert.equal(isSensitiveAuthority("accounts.credentials.manage"), true)
  assert.equal(isSensitiveAuthority("accounts.read"), true)
  assert.equal(isSensitiveAuthority("database.restore"), true)
  assert.equal(isSensitiveAuthority("school.class_access.manage"), true)
  assert.equal(isSensitiveAuthority("homerooms.assign"), true)

  // Bukan anggota: nama yang hanya mirip di awal tidak boleh ikut tertarik.
  assert.equal(isSensitiveAuthority("attendance.read.all"), false)
  assert.equal(isSensitiveAuthority("teachers.accounts.read"), false)
  assert.equal(isSensitiveAuthority("homerooms.read"), false)
  assert.equal(isSensitiveAuthority("school.settings.update"), false)
})

test("notasi keluarga hanya metadata: tidak ada key wildcard di registry", () => {
  for (const family of SENSITIVE_AUTHORITY_FAMILIES) {
    assert.equal(family.includes("*"), false, `keluarga ${family} tidak boleh memakai wildcard`)
  }
  for (const permission of PERMISSIONS) {
    assert.equal(permission.key.includes("*"), false, `key ${permission.key} tidak boleh wildcard`)
  }
})

test("setiap permission anggota keluarga sensitif ditandai sensitive di registry", () => {
  const unflagged = PERMISSIONS
    .filter((permission) => isSensitiveAuthority(permission.key))
    .filter((permission) => permission.sensitive !== true)
    .map((permission) => permission.key)

  assert.deepEqual(unflagged, [])
})
