import assert from "node:assert/strict"
import test from "node:test"

import {
  aggregateWorkbookPercent,
  canSuperviseWorkbooks,
  canViewWorkbookSupervision,
  completionState,
  formatPercent,
  nextItemStatus,
  normalizeWorkbookUrl,
  progressColor,
  roundPercent,
  summarizeWorkbookProgress,
  weightedOverallPercent,
  type WorkbookItemStatus,
} from "../lib/workbook"
import { totalWorkbookItemCount, workbookMasterData } from "../lib/workbook-master"

function statuses(present: number, missing: number, unreviewed: number): WorkbookItemStatus[] {
  return [
    ...Array<WorkbookItemStatus>(present).fill("PRESENT"),
    ...Array<WorkbookItemStatus>(missing).fill("MISSING"),
    ...Array<WorkbookItemStatus>(unreviewed).fill("UNREVIEWED"),
  ]
}

test("master data holds four workbooks and nineteen items", () => {
  assert.equal(workbookMasterData.length, 4)
  assert.deepEqual(workbookMasterData.map((entry) => entry.items.length), [6, 5, 4, 4])
  assert.equal(totalWorkbookItemCount, 19)
  assert.equal(workbookMasterData.reduce((sum, entry) => sum + entry.weight, 0), 100)
})

test("counts only PRESENT toward workbook progress", () => {
  const progress = summarizeWorkbookProgress(statuses(4, 1, 1))
  assert.equal(progress.presentCount, 4)
  assert.equal(progress.missingCount, 1)
  assert.equal(progress.unreviewedCount, 1)
  assert.equal(progress.totalCount, 6)
  assert.equal(progress.percent, 66.67)
})

test("distinguishes MISSING from UNREVIEWED at the same progress", () => {
  const allMissing = summarizeWorkbookProgress(statuses(0, 6, 0))
  const allUnreviewed = summarizeWorkbookProgress(statuses(0, 0, 6))
  assert.equal(allMissing.percent, 0)
  assert.equal(allUnreviewed.percent, 0)
  assert.equal(allMissing.state, "IN_PROGRESS")
  assert.equal(allUnreviewed.state, "UNREVIEWED")
})

test("classifies workbook completion states", () => {
  assert.equal(summarizeWorkbookProgress(statuses(6, 0, 0)).state, "COMPLETE")
  assert.equal(summarizeWorkbookProgress(statuses(0, 0, 6)).state, "UNREVIEWED")
  assert.equal(summarizeWorkbookProgress(statuses(3, 2, 1)).state, "IN_PROGRESS")
  assert.equal(summarizeWorkbookProgress(statuses(5, 0, 1)).state, "IN_PROGRESS")
  assert.equal(summarizeWorkbookProgress([]).state, "UNREVIEWED")
})

test("weights each workbook at 25 percent, not by raw item count", () => {
  const teacherA = [
    { percent: summarizeWorkbookProgress(statuses(6, 0, 0)).percent, weight: 25 },
    { percent: summarizeWorkbookProgress(statuses(4, 1, 0)).percent, weight: 25 },
    { percent: summarizeWorkbookProgress(statuses(2, 2, 0)).percent, weight: 25 },
    { percent: summarizeWorkbookProgress(statuses(0, 0, 4)).percent, weight: 25 },
  ]
  assert.deepEqual(teacherA.map((item) => item.percent), [100, 80, 50, 0])

  const overall = weightedOverallPercent(teacherA)
  assert.equal(overall, 57.5)

  // Guard against the flat 12/19 interpretation.
  assert.notEqual(overall, roundPercent((12 / 19) * 100))
})

test("matches the documented dashboard example", () => {
  assert.equal(weightedOverallPercent([
    { percent: 100, weight: 25 },
    { percent: 80, weight: 25 },
    { percent: 50, weight: 25 },
    { percent: 0, weight: 25 },
  ]), 57.5)
})

test("returns zero overall when there are no workbooks", () => {
  assert.equal(weightedOverallPercent([]), 0)
})

test("aggregates a workbook across all teachers", () => {
  assert.equal(aggregateWorkbookPercent({ presentCount: 240, teacherCount: 50, itemCount: 6 }), 80)
  assert.equal(aggregateWorkbookPercent({ presentCount: 0, teacherCount: 50, itemCount: 6 }), 0)
  assert.equal(aggregateWorkbookPercent({ presentCount: 0, teacherCount: 0, itemCount: 6 }), 0)
})

test("overall school aggregate keeps each workbook at 25 percent", () => {
  // 50 teachers: BK1 300/300=100%, BK2 200/250=80%, BK3 100/200=50%, BK4 0/200=0%.
  const overall = weightedOverallPercent([
    { percent: aggregateWorkbookPercent({ presentCount: 300, teacherCount: 50, itemCount: 6 }), weight: 25 },
    { percent: aggregateWorkbookPercent({ presentCount: 200, teacherCount: 50, itemCount: 5 }), weight: 25 },
    { percent: aggregateWorkbookPercent({ presentCount: 100, teacherCount: 50, itemCount: 4 }), weight: 25 },
    { percent: aggregateWorkbookPercent({ presentCount: 0, teacherCount: 50, itemCount: 4 }), weight: 25 },
  ])
  assert.equal(overall, 57.5)
})

test("derives completion state from counts", () => {
  assert.equal(completionState({ presentCount: 4, unreviewedCount: 0, totalCount: 4 }), "COMPLETE")
  assert.equal(completionState({ presentCount: 0, unreviewedCount: 4, totalCount: 4 }), "UNREVIEWED")
  assert.equal(completionState({ presentCount: 0, unreviewedCount: 0, totalCount: 4 }), "IN_PROGRESS")
})

test("cycles the three-state control", () => {
  assert.equal(nextItemStatus("UNREVIEWED"), "PRESENT")
  assert.equal(nextItemStatus("PRESENT"), "MISSING")
  assert.equal(nextItemStatus("MISSING"), "UNREVIEWED")
})

test("accepts any http or https workbook link", () => {
  assert.equal(normalizeWorkbookUrl("https://drive.google.com/abc"), "https://drive.google.com/abc")
  assert.equal(normalizeWorkbookUrl("http://onedrive.live.com/x"), "http://onedrive.live.com/x")
  assert.equal(normalizeWorkbookUrl("  https://example.com/a  "), "https://example.com/a")
})

test("clears the link on empty input and rejects invalid protocols", () => {
  assert.equal(normalizeWorkbookUrl(""), null)
  assert.equal(normalizeWorkbookUrl("   "), null)
  assert.equal(normalizeWorkbookUrl("javascript:alert(1)"), undefined)
  assert.equal(normalizeWorkbookUrl("ftp://example.com/a"), undefined)
  assert.equal(normalizeWorkbookUrl("drive.google.com/abc"), undefined)
})

test("formats percentages for display", () => {
  assert.equal(formatPercent(100), "100%")
  assert.equal(formatPercent(0), "0%")
  assert.equal(formatPercent(66.666), "66.7%")
  assert.equal(formatPercent(57.5), "57.5%")
})

test("interpolates workbook progress smoothly from red through orange and yellow to green", () => {
  assert.equal(progressColor(0), "hsl(0 78% 45%)")
  assert.equal(progressColor(25), "hsl(30 78% 45%)")
  assert.equal(progressColor(50), "hsl(60 78% 45%)")
  assert.equal(progressColor(75), "hsl(90 78% 45%)")
  assert.equal(progressColor(100), "hsl(120 78% 45%)")
  assert.equal(progressColor(-10), progressColor(0))
  assert.equal(progressColor(120), progressColor(100))
})

test("only supervisors or admins may change checklist status", () => {
  assert.equal(canSuperviseWorkbooks({ role: "ADMIN", canSuperviseWorkbooks: false }), true)
  assert.equal(canSuperviseWorkbooks({ role: "GURU", canSuperviseWorkbooks: true }), true)
  assert.equal(canSuperviseWorkbooks({ role: "GURU", canSuperviseWorkbooks: false }), false)
})

test("read-only viewers may open the page but not supervise", () => {
  const viewer = { role: "GURU" as const, canSuperviseWorkbooks: false, canViewWorkbookSupervision: true }
  assert.equal(canViewWorkbookSupervision(viewer), true)
  assert.equal(canSuperviseWorkbooks(viewer), false)

  const plainTeacher = { role: "GURU" as const, canSuperviseWorkbooks: false, canViewWorkbookSupervision: false }
  assert.equal(canViewWorkbookSupervision(plainTeacher), false)

  assert.equal(canViewWorkbookSupervision({ role: "ADMIN" }), true)
})
