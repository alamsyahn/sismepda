import { strict as assert } from "node:assert"
import { test } from "node:test"

import { roleKeyFromName } from "../lib/rbac-role-key"

test("key role dibuat deterministik dari nama Indonesia", () => {
  assert.equal(roleKeyFromName("  Operator Sarana & Prasarana  "), "operator_sarana_prasarana")
})

test("key role kosong bila nama tidak mengandung huruf atau angka", () => {
  assert.equal(roleKeyFromName("---"), "")
})

test("key role selalu diawali huruf", () => {
  assert.equal(roleKeyFromName("123 Operator"), "role_123_operator")
})

test("key role tidak pernah melebihi batas 64 karakter route", () => {
  // POST /api/rbac/roles menolak key > 64 karakter. Nama panjang yang sah
  // harus tetap menghasilkan key yang diterima, bukan 400 dari UI sendiri.
  const key = roleKeyFromName("Koordinator " + "Sarana ".repeat(20))
  assert.ok(key.length > 0)
  assert.ok(key.length <= 64, `key terlalu panjang: ${key.length}`)
  assert.ok(!key.endsWith("_"), `key tidak boleh berakhir pemisah: ${key}`)
})
