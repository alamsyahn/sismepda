import assert from "node:assert/strict"
import test from "node:test"

import { planLocalTestUser } from "../lib/local-test-user"

const validEnv = {
  ALLOW_LOCAL_TEST_USER: "true",
  DATABASE_URL: "postgresql://sismepda_dev:pw@localhost:5432/sismepda_dev?schema=sismepda_local",
  DEV_TEST_USER_EMAIL: "Hermes.Test@sismepda.test",
  DEV_TEST_USER_PASSWORD: "kata-sandi-uji-lokal",
  DEV_TEST_USER_NAME: "Akun Uji Hermes",
}

function reasonOf(env: Record<string, string | undefined>) {
  const decision = planLocalTestUser(env)
  assert.equal(decision.ok, false)
  return decision.ok ? "" : decision.reason
}

test("mengizinkan penulisan pada database development lokal", () => {
  const decision = planLocalTestUser(validEnv)
  assert.equal(decision.ok, true)
  if (!decision.ok) return
  assert.equal(decision.plan.email, "hermes.test@sismepda.test")
  assert.equal(decision.plan.databaseName, "sismepda_dev")
  assert.equal(decision.plan.databaseHost, "localhost")
  assert.equal(decision.plan.name, "Akun Uji Hermes")
})

test("nama default dipakai saat DEV_TEST_USER_NAME kosong", () => {
  const decision = planLocalTestUser({ ...validEnv, DEV_TEST_USER_NAME: "  " })
  assert.equal(decision.ok, true)
  if (decision.ok) assert.equal(decision.plan.name, "Akun Uji Lokal")
})

test("menolak saat ALLOW_LOCAL_TEST_USER tidak persis true", () => {
  for (const value of [undefined, "", "1", "TRUE", "yes"]) {
    assert.match(reasonOf({ ...validEnv, ALLOW_LOCAL_TEST_USER: value }), /ALLOW_LOCAL_TEST_USER/)
  }
})

test("menolak runtime produksi", () => {
  assert.match(reasonOf({ ...validEnv, NODE_ENV: "production" }), /NODE_ENV=production/)
})

test("menolak host database non-lokal", () => {
  assert.match(
    reasonOf({ ...validEnv, DATABASE_URL: "postgresql://u:p@db.sismepda.sch.id:5432/sismepda_dev" }),
    /bukan host lokal/,
  )
})

test("menolak nama database produksi walau host lokal", () => {
  assert.match(
    reasonOf({ ...validEnv, DATABASE_URL: "postgresql://u:p@localhost:5432/sismepda" }),
    /bukan database development/,
  )
})

test("menolak tanpa fallback saat DATABASE_URL gagal diparse", () => {
  for (const value of [undefined, "", "bukan-url", "postgresql://"]) {
    const reason = reasonOf({ ...validEnv, DATABASE_URL: value })
    assert.ok(/DATABASE_URL/.test(reason), reason)
  }
})

test("menolak DATABASE_URL non-PostgreSQL", () => {
  assert.match(reasonOf({ ...validEnv, DATABASE_URL: "mysql://u:p@localhost:3306/sismepda_dev" }), /bukan PostgreSQL/)
})

test("menolak email di luar domain khusus pengujian", () => {
  assert.match(reasonOf({ ...validEnv, DEV_TEST_USER_EMAIL: "admin@sismepda.sch.id" }), /domain khusus pengujian/)
  assert.match(reasonOf({ ...validEnv, DEV_TEST_USER_EMAIL: "bukan-email" }), /bukan email yang valid/)
  assert.match(reasonOf({ ...validEnv, DEV_TEST_USER_EMAIL: undefined }), /DEV_TEST_USER_EMAIL/)
})

test("menolak password kosong atau terlalu pendek", () => {
  assert.match(reasonOf({ ...validEnv, DEV_TEST_USER_PASSWORD: undefined }), /DEV_TEST_USER_PASSWORD/)
  assert.match(reasonOf({ ...validEnv, DEV_TEST_USER_PASSWORD: "pendek" }), /minimal 12 karakter/)
})
