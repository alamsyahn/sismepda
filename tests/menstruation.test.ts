import test from "node:test"
import assert from "node:assert/strict"
import { menstruationMutationSchema, validateMenstruationDates, knownMenstruationDays } from "../lib/menstruation"

const base = { action: "episode", requestId: "123e4567-e89b-42d3-a456-426614174000", startDate: "2026-10-01", endDate: null, complaint: null }
test("strict episode contract rejects invented dates, technical fields and missing CAS", () => {
  assert.equal(menstruationMutationSchema.safeParse(base).success, true)
  for (const extra of [{ source: "UKS" }, { startDate: "2026-02-30" }, { id: "episode" }]) assert.equal(menstruationMutationSchema.safeParse({ ...base, ...extra }).success, false)
  assert.throws(() => validateMenstruationDates(menstruationMutationSchema.parse({ ...base, startDate: "2026-10-15" }), "2026-10-14"))
})
test("weekly HAD does not require or invent an episode", () => {
  assert.equal(menstruationMutationSchema.safeParse({ action: "weekly", requestId: base.requestId, classId: "class", weekStart: "2026-10-12", rows: [{ studentId: "student", status: "HAD" }] }).success, true)
})

test("weekly nested actual dates must intersect its week", () => {
 const value=menstruationMutationSchema.parse({action:"weekly",requestId:base.requestId,classId:"c",weekStart:"2026-10-12",rows:[{studentId:"s",status:"HAD",episode:{startDate:"2026-10-01",endDate:null,complaint:null}}]})
 assert.throws(()=>validateMenstruationDates(value,"2026-10-14"))
})
test("unknown end marks the start only, not every day until today", () => {
  assert.deepEqual(knownMenstruationDays({ startDate: "2026-10-01", endDate: null }), ["2026-10-01"])
})
