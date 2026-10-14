import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { PERMISSIONS } from "../lib/rbac-permissions"

const migrationPath = "prisma/migrations/20261014140000_register_menstruation_permissions/migration.sql"
const keys = [
  "euks.menstruation.read", "euks.menstruation.create", "euks.menstruation.update",
  "euks.menstruation.review", "euks.menstruation.read.own",
  "euks.menstruation.create.own", "euks.menstruation.update.own", "students.accounts.manage",
]

function sql() {
  return readFileSync(migrationPath, "utf8").replace(/--[^\n]*/g, "")
}

test("forward migration registers exactly eight catalog rows with registry metadata", () => {
  const source = sql()
  assert.match(source, /INSERT INTO "Permission"\s*\("id",\s*"key",\s*"resource",\s*"action",\s*"scope",\s*"label",\s*"description",\s*"module",\s*"createdAt",\s*"updatedAt"\)/)
  const rows = [...source.matchAll(/\('((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(NULL|'(?:[^']|'')*'),\s*'((?:[^']|'')*)',\s*(NULL|'(?:[^']|'')*'),\s*'((?:[^']|'')*)',\s*NOW\(\),\s*NOW\(\)\)/g)]
  assert.deepEqual(rows.map((row) => row[2]).sort(), [...keys].sort())
  const decode = (value: string) => value === "NULL" ? null : value.slice(1, -1).replace(/''/g, "'")
  for (const row of rows) {
    const definition = PERMISSIONS.find((permission) => permission.key === row[2])!
    assert.ok(definition)
    assert.equal(row[1], `perm:${definition.key}`)
    assert.equal(row[3], definition.resource)
    assert.equal(row[4], definition.action)
    assert.equal(decode(row[5]), definition.scope ?? null)
    assert.equal(row[6].replace(/''/g, "'"), definition.label)
    assert.equal(decode(row[7]), definition.description ?? null)
    assert.equal(row[8], definition.module)
    assert.equal([row[3], row[4], decode(row[5])].filter(Boolean).join("."), definition.key)
  }
})

test("migration only upserts permission metadata and never changes grants or membership", () => {
  const source = sql()
  const statements = source.replace(/'(?:[^']|'')*'/g, "''")
  assert.doesNotMatch(statements, /\b(?:DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i)
  assert.doesNotMatch(source, /\b(?:RolePermission|UserRole|RbacRole|User)\b/i)
  assert.equal((source.match(/\bINSERT\s+INTO\b/gi) ?? []).length, 1)
  assert.equal((source.match(/;/g) ?? []).length, 1)
  const update = source.match(/ON CONFLICT\s*\("key"\)\s*DO UPDATE SET\s*([\s\S]*);\s*$/i)
  assert.ok(update, "existing catalog rows must be refreshed by key")
  const assignments = update[1].split(",").map((value) => value.trim())
  assert.deepEqual(assignments.sort(), [
    '"resource" = EXCLUDED."resource"', '"action" = EXCLUDED."action"',
    '"scope" = EXCLUDED."scope"', '"label" = EXCLUDED."label"',
    '"description" = EXCLUDED."description"', '"module" = EXCLUDED."module"',
    '"updatedAt" = EXCLUDED."updatedAt"',
  ].sort())
})
