import assert from "node:assert/strict"
import { test } from "node:test"

import {
  assertDestroyableClone,
  databaseTargets,
  describeTarget,
  isDatabaseRole,
  parseDatabaseUrl,
  parseEnvFile,
  planDatabaseTarget,
  verifyServedDatabase,
} from "@/lib/database-target"

const devUrl = "postgresql://u:p@localhost:5432/sismepda_dev?schema=sismepda_local"
const cloneUrl = "postgresql://u:p@localhost:5434/sismepda_prodclone"

function reasonOf(decision: ReturnType<typeof planDatabaseTarget>): string {
  assert.equal(decision.ok, false)
  return decision.ok ? "" : decision.reason
}

test("peran local hanya menerima database development", () => {
  const decision = planDatabaseTarget(databaseTargets.local, devUrl)
  assert.equal(decision.ok, true)
  if (decision.ok) {
    assert.equal(decision.parsed.database, "sismepda_dev")
    assert.equal(decision.parsed.schema, "sismepda_local")
  }
})

test("peran prodclone hanya menerima database clone", () => {
  const decision = planDatabaseTarget(databaseTargets.prodclone, cloneUrl)
  assert.equal(decision.ok, true)
  if (decision.ok) assert.equal(decision.parsed.port, 5434)
})

test("peran tidak boleh tertukar antar database", () => {
  assert.match(
    reasonOf(planDatabaseTarget(databaseTargets.prodclone, devUrl)),
    /wajib memakai database "sismepda_prodclone"/,
  )
  assert.match(
    reasonOf(planDatabaseTarget(databaseTargets.local, cloneUrl)),
    /wajib memakai database "sismepda_dev"/,
  )
})

test("database produksi ditolak meski host terbaca lokal", () => {
  const reason = reasonOf(
    planDatabaseTarget(databaseTargets.prodclone, "postgresql://u:p@localhost:5432/sismepda"),
  )
  assert.match(reason, /PRODUKSI/)
})

test("host non-lokal ditolak", () => {
  assert.match(
    reasonOf(planDatabaseTarget(databaseTargets.prodclone, "postgresql://u:p@db:5432/sismepda_prodclone")),
    /bukan host lokal/,
  )
})

test("URL rusak atau kosong membatalkan tanpa nilai default permisif", () => {
  assert.match(reasonOf(planDatabaseTarget(databaseTargets.local, undefined)), /belum dikonfigurasi/)
  assert.match(reasonOf(planDatabaseTarget(databaseTargets.local, "bukan url")), /tidak dapat diparse/)
  assert.match(
    reasonOf(planDatabaseTarget(databaseTargets.local, "mysql://u:p@localhost/sismepda_dev")),
    /bukan PostgreSQL/,
  )
})

test("operasi destruktif menolak database development persisten", () => {
  const parsed = parseDatabaseUrl(devUrl)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.throws(() => assertDestroyableClone(parsed.parsed), /development persisten/)
})

test("operasi destruktif menolak database produksi", () => {
  const parsed = parseDatabaseUrl("postgresql://u:p@localhost:5432/sismepda")
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.throws(() => assertDestroyableClone(parsed.parsed), /database produksi/)
})

test("operasi destruktif hanya lolos untuk prodclone lokal", () => {
  const parsed = parseDatabaseUrl(cloneUrl)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.doesNotThrow(() => assertDestroyableClone(parsed.parsed))
})

test("nama database yang dilayani server harus cocok", () => {
  assert.throws(() => verifyServedDatabase("sismepda", "sismepda_prodclone"), /Server melayani/)
  assert.doesNotThrow(() => verifyServedDatabase("sismepda_prodclone", "sismepda_prodclone"))
})

test("ringkasan target tidak memuat kredensial", () => {
  const parsed = parseDatabaseUrl("postgresql://rahasia_user:rahasia_pass@localhost:5434/sismepda_prodclone")
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const summary = describeTarget(parsed.parsed)
  assert.equal(summary.includes("rahasia_pass"), false)
  assert.equal(summary.includes("rahasia_user"), false)
  assert.equal(summary, "localhost:5434/sismepda_prodclone (schema public)")
})

test("peran yang dikenal hanya local dan prodclone", () => {
  assert.equal(isDatabaseRole("local"), true)
  assert.equal(isDatabaseRole("prodclone"), true)
  assert.equal(isDatabaseRole("production"), false)
  assert.equal(isDatabaseRole(""), false)
})

test("parser env membaca nilai berkutip dan mengabaikan komentar", () => {
  const parsed = parseEnvFile(['# komentar', 'DATABASE_URL="postgresql://u:p@localhost/db"', "", "KOSONG"].join("\n"))
  assert.equal(parsed.DATABASE_URL, "postgresql://u:p@localhost/db")
  assert.equal(Object.keys(parsed).length, 1)
})
