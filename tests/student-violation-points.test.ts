import assert from "node:assert/strict"
import test from "node:test"

import { pointLevel, summarizeViolationPoints } from "../lib/student-violation-points"

test("assigns progressively stronger levels based on total points", () => {
  assert.equal(pointLevel(0).key, "safe")
  assert.equal(pointLevel(15).key, "watch")
  assert.equal(pointLevel(35).key, "warning")
  assert.equal(pointLevel(60).key, "danger")
  assert.equal(pointLevel(100).key, "critical")
})

test("summarizes total points and current-month points", () => {
  const records = [
    { points: 10, occurredAt: new Date(2026, 7, 1) },
    { points: 15, occurredAt: new Date(2026, 7, 20) },
    { points: 5, occurredAt: new Date(2026, 6, 20) },
  ]
  const result = summarizeViolationPoints(records, new Date(2026, 7, 26))
  assert.equal(result.totalPoints, 30)
  assert.equal(result.currentMonthPoints, 25)
  assert.equal(result.recordCount, 3)
  assert.equal(result.level.key, "warning")
})

test("caps the circle progress at one hundred percent", () => {
  assert.equal(summarizeViolationPoints([{ points: 130, occurredAt: new Date() }]).progress, 100)
})
