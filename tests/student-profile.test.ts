import assert from "node:assert/strict"
import test from "node:test"

import { summarizeStudentAttendance } from "../lib/student-profile"

const records = [
  { date: new Date("2026-07-01T00:00:00.000Z"), status: "HADIR" as const },
  { date: new Date("2026-07-02T00:00:00.000Z"), status: "ALFA" as const },
  { date: new Date("2026-08-24T00:00:00.000Z"), status: "SAKIT" as const },
  { date: new Date("2026-08-25T00:00:00.000Z"), status: "HADIR" as const },
  { date: new Date("2026-08-26T00:00:00.000Z"), status: "HADIR" as const },
]

test("summarizes attendance counts, rate, and monthly trend", () => {
  const result = summarizeStudentAttendance(records, new Date("2026-08-26T12:00:00.000Z"))
  assert.deepEqual(result.counts, { hadir: 3, sakit: 1, izin: 0, dispensasi: 0, alfa: 1 })
  assert.equal(result.total, 5)
  assert.equal(result.attendanceRate, 60)
  assert.deepEqual(result.monthlyTrend, [
    { key: "2026-07", label: "Jul", hadir: 1, tidakHadir: 1 },
    { key: "2026-08", label: "Agu", hadir: 2, tidakHadir: 1 },
  ])
})

test("calculates current present streak and latest alfa", () => {
  const result = summarizeStudentAttendance(records, new Date("2026-08-26T12:00:00.000Z"))
  assert.equal(result.currentPresentStreak, 2)
  assert.equal(result.lastAlfaDate?.toISOString(), "2026-07-02T00:00:00.000Z")
  assert.equal(result.currentMonthAbsences, 1)
})

test("groups canonical Prisma DATE attendance in the correct school month", () => {
  const localRecord = [{ date: new Date("2026-08-01T00:00:00.000Z"), status: "SAKIT" as const }]
  const result = summarizeStudentAttendance(localRecord, new Date("2026-08-26T12:00:00.000Z"))
  assert.deepEqual(result.monthlyTrend, [
    { key: "2026-08", label: "Agu", hadir: 0, tidakHadir: 1 },
  ])
  assert.equal(result.currentMonthAbsences, 1)
})

test("returns stable zero values for an empty history", () => {
  const result = summarizeStudentAttendance([], new Date("2026-08-26T12:00:00.000Z"))
  assert.equal(result.total, 0)
  assert.equal(result.attendanceRate, 0)
  assert.equal(result.currentPresentStreak, 0)
  assert.equal(result.lastAlfaDate, null)
  assert.deepEqual(result.monthlyTrend, [])
})
