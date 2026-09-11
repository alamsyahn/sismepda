import assert from "node:assert/strict"
import test from "node:test"

import {
  buildClassRecap,
  parseClassRecapRange,
  statusCode,
  type ClassRecapStudent,
} from "../lib/class-recap-period"

test("accepts a valid period up to 31 days", () => {
  const range = parseClassRecapRange("2026-08-01", "2026-08-31")
  assert.equal(range.ok, true)
  if (range.ok) {
    assert.equal(range.dates.length, 31)
    assert.equal(range.from.toISOString(), "2026-08-01T00:00:00.000Z")
    assert.equal(range.to.toISOString(), "2026-08-31T00:00:00.000Z")
  }
})

test("rejects impossible, reversed, and overlong ranges", () => {
  assert.equal(parseClassRecapRange("2026-02-31", "2026-03-02").ok, false)
  assert.equal(parseClassRecapRange("2026-08-20", "2026-08-01").ok, false)
  assert.equal(parseClassRecapRange("2026-07-01", "2026-08-15").ok, false)
})

test("maps attendance states to compact matrix codes", () => {
  assert.equal(statusCode("HADIR"), "—")
  assert.equal(statusCode("ALFA"), "A")
  assert.equal(statusCode("SAKIT"), "S")
  assert.equal(statusCode("IZIN"), "I")
  assert.equal(statusCode("DISPENSASI"), "D")
  assert.equal(statusCode("NOT_SUBMITTED"), "·")
  assert.equal(statusCode("HOLIDAY"), "L")
})

test("builds cumulative counts and distinguishes missing input from attendance", () => {
  const students: ClassRecapStudent[] = [
    { id: "1", nis: "101", nisn: null, name: "Ahmad" },
    { id: "2", nis: "102", nisn: null, name: "Siti" },
  ]
  const dates = [new Date("2026-08-03T00:00:00.000Z"), new Date("2026-08-04T00:00:00.000Z"), new Date("2026-08-05T00:00:00.000Z")]
  const result = buildClassRecap({
    students,
    dates,
    holidays: new Set(["2026-08-05"]),
    submittedDates: new Set(["2026-08-03"]),
    records: [
      { studentId: "1", date: new Date("2026-08-03T00:00:00.000Z"), status: "ALFA" },
      { studentId: "2", date: new Date("2026-08-03T00:00:00.000Z"), status: "HADIR" },
    ],
  })

  assert.deepEqual(result.rows[0].codes, ["A", "·", "L"])
  assert.deepEqual(result.rows[1].codes, ["—", "·", "L"])
  assert.equal(result.rows[0].counts.alfa, 1)
  assert.equal(result.rows[0].totalAbsent, 1)
  assert.equal(result.rows[1].totalAbsent, 0)
  assert.equal(result.schoolDayCount, 2)
  assert.equal(result.submittedDayCount, 1)
})

test("sorts cumulative rows by most absences then name", () => {
  const result = buildClassRecap({
    students: [
      { id: "a", nis: null, nisn: null, name: "Zaki" },
      { id: "b", nis: null, nisn: null, name: "Ahmad" },
    ],
    dates: [new Date("2026-08-03T00:00:00.000Z")],
    holidays: new Set(),
    submittedDates: new Set(["2026-08-03"]),
    records: [{ studentId: "a", date: new Date("2026-08-03T00:00:00.000Z"), status: "SAKIT" }],
  })
  assert.deepEqual(result.cumulativeRows.map((row) => row.name), ["Zaki", "Ahmad"])
})


test("matches canonical Prisma DATE values without timezone projection", () => {
  const result = buildClassRecap({
    students: [{ id: "a", nis: null, nisn: null, name: "Ahmad" }],
    dates: [new Date("2026-08-01T00:00:00.000Z")],
    holidays: new Set(),
    submittedDates: new Set(["2026-08-01"]),
    records: [{ studentId: "a", date: new Date("2026-08-01T00:00:00.000Z"), status: "SAKIT" }],
  })
  assert.equal(result.rows[0].codes[0], "S")
})

test("hari terisi parsial: siswa tanpa record tetap 'belum diinput', bukan hadir", () => {
  const result = buildClassRecap({
    students: [
      { id: "a", nis: null, nisn: null, name: "Andi" },
      { id: "b", nis: null, nisn: null, name: "Budi" },
    ],
    dates: [new Date("2026-08-03T00:00:00.000Z")],
    holidays: new Set(),
    submittedDates: new Set(["2026-08-03"]),
    // Hanya Andi yang diisi; Budi belum.
    records: [{ studentId: "a", date: new Date("2026-08-03T00:00:00.000Z"), status: "SAKIT" }],
  })

  assert.deepEqual(result.rows[0].codes, ["S"])
  assert.deepEqual(result.rows[1].codes, ["·"])
  assert.equal(result.rows[1].counts.hadir, 0)
  assert.equal(result.rows[1].totalAbsent, 0)
})

test("does not count a submitted attendance day when it is a holiday", () => {
  const result = buildClassRecap({
    students: [{ id: "a", nis: null, nisn: null, name: "Ahmad" }],
    dates: [new Date("2026-08-17T00:00:00.000Z")],
    holidays: new Set(["2026-08-17"]),
    submittedDates: new Set(["2026-08-17"]),
    records: [{ studentId: "a", date: new Date("2026-08-17T00:00:00.000Z"), status: "ALFA" }],
  })
  assert.equal(result.rows[0].codes[0], "L")
  assert.equal(result.schoolDayCount, 0)
  assert.equal(result.submittedDayCount, 0)
})
