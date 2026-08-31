import assert from "node:assert/strict"
import test from "node:test"

import {
  absenteeSummaryLabel,
  countAbsenteesByStatus,
  groupAbsentees,
  indexAbsenteesByClass,
  repeatedAbsenceLabel,
} from "../lib/class-absentees"
import type { AbsentStudent } from "../lib/dashboard-data"

function student(overrides: Partial<AbsentStudent> & Pick<AbsentStudent, "id" | "name" | "status">): AbsentStudent {
  return {
    nis: null,
    nisn: null,
    classId: "kelas-7a",
    className: "VII A",
    note: "-",
    history: { sakit: 0, izin: 0, alfa: 0, dispensasi: 0 },
    ...overrides,
  }
}

test("indexes absentees by their class", () => {
  const index = indexAbsenteesByClass([
    student({ id: "1", name: "Ali", status: "alfa" }),
    student({ id: "2", name: "Budi", status: "izin", classId: "kelas-8b", className: "VIII B" }),
    student({ id: "3", name: "Citra", status: "sakit" }),
  ])
  assert.deepEqual(index.get("kelas-7a")?.map((s) => s.name), ["Ali", "Citra"])
  assert.deepEqual(index.get("kelas-8b")?.map((s) => s.name), ["Budi"])
})

test("groups absentees by status, most actionable first, names sorted", () => {
  const groups = groupAbsentees([
    student({ id: "1", name: "Zaki", status: "sakit" }),
    student({ id: "2", name: "Ani", status: "sakit" }),
    student({ id: "3", name: "Budi", status: "alfa" }),
  ])
  assert.deepEqual(
    groups.map((g) => [g.status, g.students.map((s) => s.name)]),
    [
      ["alfa", ["Budi"]],
      ["sakit", ["Ani", "Zaki"]],
    ],
  )
})

test("empty status groups are omitted", () => {
  assert.deepEqual(groupAbsentees([]), [])
})

test("counts absentees per status", () => {
  assert.deepEqual(
    countAbsenteesByStatus([
      student({ id: "1", name: "Ali", status: "alfa" }),
      student({ id: "2", name: "Budi", status: "alfa" }),
      student({ id: "3", name: "Citra", status: "izin" }),
    ]),
    { alfa: 2, izin: 1, sakit: 0, dispensasi: 0 },
  )
})

test("repeat context only appears from the second occurrence", () => {
  assert.equal(
    repeatedAbsenceLabel(student({ id: "1", name: "Ali", status: "alfa", history: { sakit: 0, izin: 0, alfa: 1, dispensasi: 0 } })),
    null,
  )
  assert.equal(
    repeatedAbsenceLabel(student({ id: "1", name: "Ali", status: "alfa", history: { sakit: 0, izin: 0, alfa: 3, dispensasi: 0 } })),
    "3× alfa tercatat",
  )
})

test("summary label reads naturally in both states", () => {
  assert.equal(absenteeSummaryLabel([]), "Semua siswa hadir")
  assert.equal(absenteeSummaryLabel([student({ id: "1", name: "Ali", status: "alfa" })]), "1 siswa tidak hadir")
})
