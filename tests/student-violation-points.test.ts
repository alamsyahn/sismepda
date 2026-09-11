import assert from "node:assert/strict"
import test from "node:test"

import { pointLevel, summarizeViolationPoints } from "../lib/student-violation-points"
import { requireSchoolDate, toPrismaDate } from "../lib/school-date"

const prismaDate = (value: string) => toPrismaDate(requireSchoolDate(value))

test("assigns progressively stronger levels based on total points", () => {
  assert.equal(pointLevel(0).key, "safe")
  assert.equal(pointLevel(15).key, "watch")
  assert.equal(pointLevel(35).key, "warning")
  assert.equal(pointLevel(60).key, "danger")
  assert.equal(pointLevel(100).key, "critical")
})

test("summarizes total points and current-month points", () => {
  const records = [
    { points: 10, occurredAt: prismaDate("2026-08-01") },
    { points: 15, occurredAt: prismaDate("2026-08-20") },
    { points: 5, occurredAt: prismaDate("2026-07-20") },
  ]
  const result = summarizeViolationPoints(records, new Date("2026-08-26T00:00:00.000Z"))
  assert.equal(result.totalPoints, 30)
  assert.equal(result.currentMonthPoints, 25)
  assert.equal(result.recordCount, 3)
  assert.equal(result.level.key, "warning")
})

test("caps the circle progress at one hundred percent", () => {
  assert.equal(summarizeViolationPoints([{ points: 130, occurredAt: prismaDate("2026-08-01") }]).progress, 100)
})

test("uses Prisma DATE month while current month follows Jakarta", () => {
  const records = [{ points: 10, occurredAt: prismaDate("2026-08-01") }]
  const result = summarizeViolationPoints(records, new Date("2026-07-31T17:00:00.000Z"))
  assert.equal(result.currentMonthPoints, 10)
})
