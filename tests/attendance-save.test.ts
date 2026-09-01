import assert from "node:assert/strict"
import test from "node:test"

import {
  isClassRecapComplete,
  isFilledWireStatus,
  planAttendanceWrite,
  UNFILLED_WIRE_STATUS,
  type WireRecord,
} from "../lib/attendance-save"

function roster(entries: Array<[string, WireRecord["status"]]>): WireRecord[] {
  return entries.map(([studentId, status]) => ({ studentId, status }))
}

test("Scenario A — partial pertama kali: hanya siswa terisi yang ditulis", () => {
  const records = roster([
    ["s1", "HADIR"],
    ["s2", "SAKIT"],
    ["s3", "IZIN"],
    ...Array.from({ length: 27 }, (_, i) => [`x${i}`, UNFILLED_WIRE_STATUS] as [string, WireRecord["status"]]),
  ])
  const plan = planAttendanceWrite(records)

  assert.deepEqual(plan.upserts.map((u) => [u.studentId, u.status]), [["s1", "HADIR"], ["s2", "SAKIT"], ["s3", "IZIN"]])
  assert.equal(plan.clears.length, 27)
  // 3 dari 30 tercatat -> kelas belum lengkap.
  assert.equal(isClassRecapComplete({ totalStudents: 30, recorded: plan.upserts.length }), false)
})

test("Scenario B — melanjutkan pengisian tidak menghapus data lama", () => {
  // Form mengirim ulang seluruh roster, termasuk status lama yang tidak disentuh.
  const plan = planAttendanceWrite(roster([
    ["andi", "HADIR"],
    ["budi", "SAKIT"],
    ["citra", "IZIN"],
    ["dedi", UNFILLED_WIRE_STATUS],
  ]))

  assert.deepEqual(plan.upserts.map((u) => u.studentId), ["andi", "budi", "citra"])
  // Siswa yang tidak disentuh tetap ikut sebagai upsert dengan nilai lamanya.
  assert.equal(plan.upserts.find((u) => u.studentId === "andi")?.status, "HADIR")
  assert.equal(plan.upserts.find((u) => u.studentId === "budi")?.status, "SAKIT")
  assert.deepEqual(plan.clears, ["dedi"])
})

test("Scenario C — edit existing hanya mengubah siswa yang dimaksud", () => {
  const before = planAttendanceWrite(roster([["andi", "HADIR"], ["budi", "SAKIT"]]))
  const after = planAttendanceWrite(roster([["andi", "SAKIT"], ["budi", "SAKIT"]]))

  assert.equal(before.upserts.find((u) => u.studentId === "andi")?.status, "HADIR")
  assert.equal(after.upserts.find((u) => u.studentId === "andi")?.status, "SAKIT")
  assert.equal(after.upserts.find((u) => u.studentId === "budi")?.status, "SAKIT")
  assert.deepEqual(after.clears, [])
})

test("Scenario D — roster lengkap menandai kelas selesai", () => {
  const plan = planAttendanceWrite(roster([
    ["s1", "HADIR"], ["s2", "ALFA"], ["s3", "DISPENSASI"],
  ]))
  assert.equal(plan.clears.length, 0)
  assert.equal(isClassRecapComplete({ totalStudents: 3, recorded: plan.upserts.length }), true)
})

test("Scenario E — Clear All mengosongkan kembali seluruh siswa", () => {
  const plan = planAttendanceWrite(roster([
    ["s1", UNFILLED_WIRE_STATUS], ["s2", UNFILLED_WIRE_STATUS], ["s3", UNFILLED_WIRE_STATUS],
  ]))
  assert.deepEqual(plan.upserts, [])
  assert.deepEqual(plan.clears, ["s1", "s2", "s3"])
  assert.equal(isClassRecapComplete({ totalStudents: 3, recorded: 0 }), false)
})

test("catatan kosong dinormalkan menjadi null, catatan terisi dipertahankan", () => {
  const plan = planAttendanceWrite([
    { studentId: "s1", status: "SAKIT", note: "  demam  " },
    { studentId: "s2", status: "HADIR", note: "   " },
    { studentId: "s3", status: "HADIR" },
  ])
  assert.deepEqual(plan.upserts.map((u) => u.note), ["demam", null, null])
})

test("kelas tanpa siswa aktif tidak pernah dianggap lengkap", () => {
  assert.equal(isClassRecapComplete({ totalStudents: 0, recorded: 0 }), false)
})

test("status BELUM bukan status terisi", () => {
  assert.equal(isFilledWireStatus(UNFILLED_WIRE_STATUS), false)
  assert.equal(isFilledWireStatus("HADIR"), true)
})
