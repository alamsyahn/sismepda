import assert from "node:assert/strict"
import { test } from "node:test"

import {
  businessDateColumnTypeQuery,
  businessDateColumns,
  businessDateInvariantQuery,
  columnKey,
  evaluateBusinessDateInvariant,
  parseBusinessDateColumnTypes,
  planLegacyDateRepair,
} from "@/lib/legacy-date-repair"

const DATE = "date"
const LEGACY = "timestamp without time zone"

/** Peta tipe untuk ketujuh kolom sekaligus. */
function allColumns(type: string): Record<string, string> {
  return Object.fromEntries(businessDateColumns.map((c) => [columnKey(c), type]))
}

test("schema date-only melewati repair, bukan menjalankannya", () => {
  const plan = planLegacyDateRepair(allColumns(DATE))
  assert.equal(plan.action, "skip")
  assert.match(plan.reason, /sudah bertipe `date`/)
})

test("schema legacy timestamp tetap menjalankan repair", () => {
  const plan = planLegacyDateRepair(allColumns(LEGACY))
  assert.equal(plan.action, "repair")
  assert.match(plan.reason, /pra-migrasi/)
})

test("keputusan idempoten: input sama selalu menghasilkan rencana sama", () => {
  const observed = allColumns(DATE)
  const first = planLegacyDateRepair(observed)
  const second = planLegacyDateRepair(observed)
  assert.deepEqual(first, second)
  // Menjalankan ulang terhadap clone yang sudah date-only tidak pernah berubah
  // menjadi `repair`, sehingga refresh berulang tidak menyentuh data yang benar.
  assert.equal(second.action, "skip")
})

test("schema bercampur dibatalkan, bukan ditambal", () => {
  const observed = allColumns(DATE)
  observed["BosEntry.occurredAt"] = LEGACY
  const plan = planLegacyDateRepair(observed)
  assert.equal(plan.action, "abort")
  assert.match(plan.reason, /bercampur/)
  assert.match(plan.reason, /BosEntry\.occurredAt/)
})

test("kolom hilang dibatalkan dengan menyebut kolomnya", () => {
  const observed = allColumns(DATE)
  delete observed["AttendanceDay.date"]
  const plan = planLegacyDateRepair(observed)
  assert.equal(plan.action, "abort")
  assert.match(plan.reason, /AttendanceDay\.date/)
})

test("tipe tak dikenal dibatalkan alih-alih diperlakukan sebagai legacy", () => {
  const observed = allColumns(DATE)
  observed["User.teachingSince"] = "timestamp with time zone"
  const plan = planLegacyDateRepair(observed)
  assert.equal(plan.action, "abort")
  assert.match(plan.reason, /timestamp with time zone/)
})

test("peta tipe kosong dibatalkan, tidak dianggap sudah date-only", () => {
  const plan = planLegacyDateRepair({})
  assert.equal(plan.action, "abort")
})

test("parser membaca keluaran psql -At dan menolak baris rusak", () => {
  const parsed = parseBusinessDateColumnTypes("AttendanceDay.date|date\nUser.teachingSince|DATE\n")
  assert.deepEqual(parsed, { "AttendanceDay.date": "date", "User.teachingSince": "date" })
  assert.equal(parseBusinessDateColumnTypes("AttendanceDay.date"), null)
  assert.equal(parseBusinessDateColumnTypes("|date"), null)
  assert.deepEqual(parseBusinessDateColumnTypes(""), {})
})

test("query tipe kolom hanya membaca information_schema public", () => {
  const sql = businessDateColumnTypeQuery()
  assert.match(sql, /^select/)
  assert.match(sql, /information_schema\.columns/)
  assert.match(sql, /table_schema = 'public'/)
  for (const column of businessDateColumns) {
    assert.ok(sql.includes(`('${column.table}','${column.column}')`), columnKey(column))
  }
})

test("tujuh kolom tanggal bisnis sama persis dengan yang dikonversi migrasi date-only", () => {
  assert.deepEqual(
    businessDateColumns.map(columnKey).sort(),
    [
      "AdditionalDuty.startDate",
      "AttendanceDay.date",
      "BosEntry.occurredAt",
      "SarprasItem.acquisitionDate",
      "SchoolHoliday.date",
      "StudentViolationPoint.occurredAt",
      "User.teachingSince",
    ],
  )
})

test("invariant tanpa tabrakan diterima", () => {
  const result = evaluateBusinessDateInvariant("0|0\n")
  assert.equal(result.ok, true)
})

test("invariant dengan tabrakan ditolak dan menyebut jumlahnya", () => {
  const result = evaluateBusinessDateInvariant("15|2")
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.reason, /15 tabrakan AttendanceDay/)
    assert.match(result.reason, /2 tabrakan SchoolHoliday/)
  }
})

test("hasil invariant tidak terbaca ditolak, tidak dianggap lolos", () => {
  assert.equal(evaluateBusinessDateInvariant("").ok, false)
  assert.equal(evaluateBusinessDateInvariant("0").ok, false)
  assert.equal(evaluateBusinessDateInvariant("a|b").ok, false)
})

test("query invariant read-only: tidak memuat pernyataan tulis apa pun", () => {
  const sql = businessDateInvariantQuery()
  assert.match(sql, /^select/i)
  assert.doesNotMatch(sql, /\b(update|delete|insert|alter|drop|truncate|create)\b/i)
})

test("seluruh SQL TD-014 tidak pernah menargetkan produksi", () => {
  // Modul ini hanya menghasilkan SQL; pemilihan target tetap milik
  // lib/database-target.ts. Yang dikunci di sini: tidak ada nama database
  // produksi yang bocor ke dalam SQL, sehingga tidak ada jalur yang dapat
  // mengarahkan pernyataan ini ke produksi lewat teks query.
  for (const sql of [businessDateColumnTypeQuery(), businessDateInvariantQuery()]) {
    assert.doesNotMatch(sql, /\bsismepda\b/)
    assert.doesNotMatch(sql, /dblink|postgres_fdw/i)
  }
})
