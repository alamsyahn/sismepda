import assert from "node:assert/strict"
import { test } from "node:test"

import {
  LEGACY_BACKFILL_MARKER_KEY,
  evaluateRbacReadiness,
  legacyBackfillMarkerQuery,
  parseBackfillMarkerStatus,
  planLegacyRbacBackfill,
  rbacReadinessQuery,
} from "@/lib/prodclone-rbac-bootstrap"

test("marker COMPLETED melewati backfill alih-alih mengulang apply", () => {
  const plan = planLegacyRbacBackfill("COMPLETED")
  assert.equal(plan.action, "skip")
  assert.match(plan.reason, /sudah COMPLETED/)
})

test("marker belum ada tetap menjalankan backfill sebagai jalur forward", () => {
  const plan = planLegacyRbacBackfill("ABSENT")
  assert.equal(plan.action, "apply")
  assert.match(plan.reason, /pra-RBAC/)
})

test("marker RUNNING dan FAILED dilanjutkan, bukan dilewati", () => {
  assert.equal(planLegacyRbacBackfill("RUNNING").action, "apply")
  assert.equal(planLegacyRbacBackfill("FAILED").action, "apply")
})

test("keputusan idempoten: status sama selalu menghasilkan rencana sama", () => {
  assert.deepEqual(planLegacyRbacBackfill("COMPLETED"), planLegacyRbacBackfill("COMPLETED"))
  assert.deepEqual(planLegacyRbacBackfill("ABSENT"), planLegacyRbacBackfill("ABSENT"))
})

test("status marker tak dikenal ditolak, tidak dianggap belum pernah jalan", () => {
  assert.equal(parseBackfillMarkerStatus("PENDING"), null)
  assert.equal(parseBackfillMarkerStatus(""), null)
  assert.equal(parseBackfillMarkerStatus("completed"), "COMPLETED")
  assert.equal(parseBackfillMarkerStatus(" ABSENT \n"), "ABSENT")
})

test("query marker read-only dan menyebut kunci backfill kanonik", () => {
  const sql = legacyBackfillMarkerQuery()
  assert.match(sql, /^select/i)
  assert.ok(sql.includes(LEGACY_BACKFILL_MARKER_KEY))
  assert.doesNotMatch(sql, /\b(update|delete|insert|alter|drop|truncate)\b/i)
})

test("kesiapan RBAC diterima hanya bila role dan keanggotaan terisi", () => {
  const ready = evaluateRbacReadiness("22|53")
  assert.equal(ready.ok, true)
  if (ready.ok) {
    assert.equal(ready.roles, 22)
    assert.equal(ready.memberships, 53)
  }
})

test("clone tanpa keanggotaan membatalkan refresh", () => {
  const result = evaluateRbacReadiness("22|0")
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /tanpa satu pun izin/)
  assert.equal(evaluateRbacReadiness("0|0").ok, false)
})

test("hasil kesiapan tidak terbaca ditolak, tidak dianggap lolos", () => {
  assert.equal(evaluateRbacReadiness("").ok, false)
  assert.equal(evaluateRbacReadiness("22").ok, false)
  assert.equal(evaluateRbacReadiness("a|b").ok, false)
})

test("query kesiapan read-only", () => {
  const sql = rbacReadinessQuery()
  assert.match(sql, /^select/i)
  assert.doesNotMatch(sql, /\b(update|delete|insert|alter|drop|truncate)\b/i)
})

test("SQL bootstrap tidak pernah menargetkan produksi", () => {
  for (const sql of [legacyBackfillMarkerQuery(), rbacReadinessQuery()]) {
    assert.doesNotMatch(sql, /\bsismepda\b/)
    assert.doesNotMatch(sql, /dblink|postgres_fdw/i)
  }
})
