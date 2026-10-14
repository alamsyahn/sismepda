import assert from "node:assert/strict"
import { test } from "node:test"
import { fitnessBatchSchema, fitnessCategory, sameFitnessInput, type FitnessInputRow } from "../lib/fitness"
import { canSeeNavItem, mainNav, flattenNav } from "../lib/nav"

const base = { status: "TESTED", protocol: "TKSI_D_20M_2023", level: 4, shuttle: 4, genderAtTest: "LAKI_LAKI", gradeAtTest: "VII" }
test("TKSI beep categories preserve integer level/balikan boundaries and gender", () => {
  assert.equal(fitnessCategory(base), "Baik")
  assert.equal(fitnessCategory({ ...base, shuttle: 3 }), "Sedang")
  assert.equal(fitnessCategory({ ...base, level: 7, shuttle: 7 }), "Baik")
  assert.equal(fitnessCategory({ ...base, level: 7, shuttle: 8 }), "Baik sekali")
  assert.equal(fitnessCategory({ ...base, genderAtTest: "PEREMPUAN", shuttle: 5 }), "Baik")
  assert.equal(fitnessCategory({ ...base, genderAtTest: "PEREMPUAN", shuttle: 6 }), "Baik sekali")
  assert.equal(fitnessCategory({ ...base, genderAtTest: "PEREMPUAN", level: 1, shuttle: 8 }), "Batas norma perlu verifikasi")
  assert.equal(fitnessCategory({ ...base, level: 4, shuttle: 10 }), "Baik")
})
test("missing gender, other protocol, outside phase and nonparticipants are never graded as zero", () => {
  assert.equal(fitnessCategory({ ...base, genderAtTest: null }), "Jenis kelamin belum diisi")
  assert.equal(fitnessCategory({ ...base, protocol: "BEEP_20M_OTHER" }), "Tanpa norma")
  assert.equal(fitnessCategory({ ...base, gradeAtTest: "VI" }), "Di luar Fase D")
  for (const status of ["ABSENT", "INVALID", "NOT_TESTED"]) assert.equal(fitnessCategory({ ...base, status }), "—")
})
const row: FitnessInputRow = { studentId: "a", version: 0, status: "TESTED", level: 4, shuttle: 4, note: "" }
const payload = { classId: "c", testedAt: "2026-10-14", protocol: "TKSI_D_20M_2023", audioLabel: "Audio TKSI", rows: [row] }
test("batch validation rejects partial, fractional, duplicate, forged and invalid-date data", () => {
  assert.ok(fitnessBatchSchema.safeParse(payload).success)
  for (const changed of [{level:null}, {shuttle:null}, {level:4.1}, {shuttle:0}, {status:"ABSENT"}]) {
    assert.ok(!fitnessBatchSchema.safeParse({ ...payload, rows:[{...row,...changed}] }).success)
  }
  assert.ok(!fitnessBatchSchema.safeParse({...payload,rows:[row,row]}).success)
  assert.ok(!fitnessBatchSchema.safeParse({...payload,testedAt:"2026-02-30"}).success)
  assert.ok(!fitnessBatchSchema.safeParse({...payload,recordedById:"forged"}).success)
  assert.ok(!fitnessBatchSchema.safeParse({...payload,audioLabel:" "}).success)
  assert.ok(fitnessBatchSchema.safeParse({...payload,rows:[{...row,status:"INVALID",level:null,shuttle:null}]}).success)
  assert.equal(sameFitnessInput(row,{...row,version:99}),true)
  assert.equal(sameFitnessInput(row,{...row,shuttle:5}),false)
})
test("fitness navigation is limited to its own read permission", () => {
  const item = flattenNav(mainNav).find(n=>n.href==="/e-uks/kebugaran")!
  assert.ok(item)
  assert.equal(canSeeNavItem(item,{grants:["euks.monitoring.read"]}),false)
  assert.equal(canSeeNavItem(item,{grants:["euks.fitness.read"]}),true)
})
