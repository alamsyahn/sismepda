import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  RBAC_AUDIT_ACTIONS,
  RBAC_AUDIT_ENTITIES,
  isRbacAuditEntity,
  redactAuditPayload,
  summarizePermissionChange,
  summarizeRoleAssignment,
} from "../lib/rbac-audit"

test("entitas audit RBAC dikenali, entitas biasa tidak", () => {
  for (const entity of RBAC_AUDIT_ENTITIES) {
    assert.equal(isRbacAuditEntity(entity), true)
  }
  assert.equal(isRbacAuditEntity("TeacherWorkbook"), false)
  assert.equal(isRbacAuditEntity("BosEntry"), false)
  // Perubahan authority pada akun adalah audit RBAC, bukan audit profil guru.
  assert.equal(isRbacAuditEntity("UserAuthority"), true)
})

test("setiap aksi RBAC punya nama yang eksplisit dan tanpa duplikat", () => {
  const actions = [...RBAC_AUDIT_ACTIONS]
  assert.equal(new Set(actions).size, actions.length)
  for (const action of actions) {
    assert.match(action, /^RBAC_[A-Z_]+$/)
  }
})

test("redaksi membuang rahasia dari payload audit", () => {
  const redacted = redactAuditPayload({
    id: "user-1",
    name: "Budi",
    email: "budi@sekolah.id",
    password: "rahasia123",
    passwordHash: "$2b$10$abcdef",
    sessionToken: "tok_123",
    active: true,
    roles: [{ id: "r1", key: "guru", name: "Guru" }],
  })

  assert.deepEqual(redacted, {
    id: "user-1",
    name: "Budi",
    email: "budi@sekolah.id",
    active: true,
    roles: [{ id: "r1", key: "guru", name: "Guru" }],
  })
})

test("redaksi bersifat rekursif dan menutup varian penamaan rahasia", () => {
  const redacted = redactAuditPayload({
    user: {
      hashedPassword: "x",
      password_hash: "y",
      accessToken: "z",
      refresh_token: "w",
      secret: "s",
      apiKey: "k",
      name: "Ani",
    },
    healthRecord: { weightKg: 40 },
    env: { DATABASE_URL: "postgres://..." },
  })

  assert.deepEqual(redacted, { user: { name: "Ani" } })
})

test("redaksi mempertahankan array dan nilai null yang bermakna", () => {
  const redacted = redactAuditPayload({
    roles: [
      { id: "r1", key: "guru", name: "Guru" },
      { id: "r2", key: "operator_bos", name: "Operator BOS" },
    ],
    description: null,
  })

  assert.deepEqual(redacted, {
    roles: [
      { id: "r1", key: "guru", name: "Guru" },
      { id: "r2", key: "operator_bos", name: "Operator BOS" },
    ],
    description: null,
  })
})

test("ringkasan perubahan permission menyebut jumlah tambah dan cabut", () => {
  const summary = summarizePermissionChange({
    roleName: "Operator BOS",
    added: ["bos.read", "bos.entries.create"],
    removed: ["bos.budget.update"],
  })

  assert.match(summary, /Operator BOS/)
  assert.match(summary, /2/)
  assert.match(summary, /1/)
})

test("ringkasan penugasan role menyebut nama role, bukan hanya id", () => {
  const summary = summarizeRoleAssignment({
    userName: "Budi",
    added: [{ id: "r1", key: "operator_bos", name: "Operator BOS" }],
    removed: [{ id: "r2", key: "guru", name: "Guru" }],
  })

  assert.match(summary, /Budi/)
  assert.match(summary, /Operator BOS/)
  assert.match(summary, /Guru/)
})

test("ringkasan menyebut zero-role saat seluruh role dicabut", () => {
  const summary = summarizeRoleAssignment({
    userName: "Budi",
    added: [],
    removed: [{ id: "r2", key: "guru", name: "Guru" }],
    resultingRoleCount: 0,
  })

  assert.match(summary, /tanpa role/i)
})
