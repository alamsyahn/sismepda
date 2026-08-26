import assert from "node:assert/strict"
import test from "node:test"

import { databaseSchema } from "../lib/database-config"

test("reads an isolated PostgreSQL schema from DATABASE_URL", () => {
  assert.equal(
    databaseSchema("postgresql://user:pass@localhost:5432/sismepda?schema=sismepda_local"),
    "sismepda_local",
  )
})

test("uses public when DATABASE_URL has no schema", () => {
  assert.equal(databaseSchema("postgresql://user:pass@localhost:5432/sismepda"), "public")
})
