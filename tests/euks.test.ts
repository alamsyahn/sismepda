import { strict as assert } from "node:assert"
import { test } from "node:test"

import { canViewEuks, euksCapabilities, hasEuksPermission } from "../lib/euks"

const admin = { role: "ADMIN" as const }
const guru = { role: "GURU" as const }

test("ADMIN selalu lolos setiap hak E-UKS", () => {
  assert.equal(hasEuksPermission(admin, "euks.view"), true)
  assert.equal(hasEuksPermission(admin, "euks.edit"), true)
})

test("GURU polos tidak memegang hak E-UKS apa pun", () => {
  assert.equal(hasEuksPermission(guru, "euks.view"), false)
  assert.equal(hasEuksPermission(guru, "euks.edit"), false)
  assert.equal(canViewEuks(guru), false)
})

test("hak kelola menyiratkan hak lihat", () => {
  const editor = { role: "GURU" as const, canEditEuks: true }
  assert.equal(hasEuksPermission(editor, "euks.view"), true)
  assert.equal(canViewEuks(editor), true)
})

test("hak lihat tidak menyiratkan hak kelola", () => {
  const viewer = { role: "GURU" as const, canViewEuks: true }
  assert.equal(hasEuksPermission(viewer, "euks.view"), true)
  assert.equal(hasEuksPermission(viewer, "euks.edit"), false)
})

test("capabilities merangkum kedua hak", () => {
  assert.deepEqual(euksCapabilities({ role: "GURU", canViewEuks: true }), {
    canView: true,
    canEdit: false,
  })
  assert.deepEqual(euksCapabilities(admin), { canView: true, canEdit: true })
})
