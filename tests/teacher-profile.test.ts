import assert from "node:assert/strict"
import test from "node:test"

import {
  canManageTeacherProfile,
  dayLabel,
  formatPeriodRange,
  groupScheduleByDay,
  summarizeTeachingLoad,
} from "../lib/teacher-profile"

const assignments = [
  { id: "a", day: 1, periodStart: 1, periodEnd: 2, schoolClass: { name: "VII A" }, subject: { name: "Matematika" } },
  { id: "b", day: 1, periodStart: 3, periodEnd: 4, schoolClass: { name: "VII B" }, subject: { name: "Matematika" } },
  { id: "c", day: 3, periodStart: 5, periodEnd: 5, schoolClass: { name: "VIII A" }, subject: { name: "Informatika" } },
]

test("summarizes weekly teaching load", () => {
  const load = summarizeTeachingLoad(assignments)
  assert.equal(load.totalPeriods, 5)
  assert.equal(load.classCount, 3)
  assert.equal(load.subjectCount, 2)
  assert.equal(load.dayCount, 2)
})

test("returns zeroed load for an empty schedule", () => {
  const load = summarizeTeachingLoad([])
  assert.deepEqual(load, { totalPeriods: 0, classCount: 0, subjectCount: 0, dayCount: 0 })
})

test("groups the schedule by weekday in order", () => {
  const grouped = groupScheduleByDay(assignments)
  assert.deepEqual(grouped.map((item) => item.day), [1, 3])
  assert.equal(grouped[0].items.length, 2)
  assert.equal(grouped[0].label, "Senin")
})

test("formats single and multi period ranges", () => {
  assert.equal(formatPeriodRange(1, 2), "Jam ke-1–2")
  assert.equal(formatPeriodRange(5, 5), "Jam ke-5")
})

test("labels weekdays in Indonesian", () => {
  assert.equal(dayLabel(1), "Senin")
  assert.equal(dayLabel(6), "Sabtu")
})

test("only admins or delegated users may manage teacher profiles", () => {
  assert.equal(canManageTeacherProfile({ role: "ADMIN", canManageTeacherProfiles: false }), true)
  assert.equal(canManageTeacherProfile({ role: "GURU", canManageTeacherProfiles: true }), true)
  assert.equal(canManageTeacherProfile({ role: "GURU", canManageTeacherProfiles: false }), false)
})
