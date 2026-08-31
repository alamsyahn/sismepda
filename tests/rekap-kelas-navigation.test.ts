import assert from "node:assert/strict"
import test from "node:test"

import {
  isSameRecapView,
  parseRecapMode,
  readRecapView,
  recapTabSlug,
  recapViewSearch,
  selectCumulativeClass,
  selectMatrixClass,
  shouldPushRecapHistory,
} from "../lib/rekap-kelas-navigation"

test("opens the cumulative recap for a class selected from the daily summary", () => {
  assert.deepEqual(selectCumulativeClass("kelas-7a"), {
    mode: "cumulative",
    classId: "kelas-7a",
  })
})

test("ignores an empty class selection", () => {
  assert.deepEqual(selectCumulativeClass(""), { mode: "daily", classId: null })
})

test("opens the attendance calendar for a class selected from the daily summary", () => {
  assert.deepEqual(selectMatrixClass("kelas-8b"), {
    mode: "matrix",
    classId: "kelas-8b",
  })
})

test("maps every mode to a readable slug and back", () => {
  for (const mode of ["daily", "cumulative", "matrix"] as const) {
    assert.equal(parseRecapMode(recapTabSlug(mode)), mode)
  }
})

test("falls back to the daily tab for missing or unknown slugs", () => {
  assert.equal(parseRecapMode(null), "daily")
  assert.equal(parseRecapMode(""), "daily")
  assert.equal(parseRecapMode("tab-yang-tidak-ada"), "daily")
  assert.equal(parseRecapMode(" KUMULATIF "), "cumulative")
})

test("reads the active tab and class from the query string", () => {
  assert.deepEqual(readRecapView(new URLSearchParams("tab=kalender&kelas=kelas-9c")), {
    mode: "matrix",
    classId: "kelas-9c",
  })
  assert.deepEqual(readRecapView(new URLSearchParams("tab=kumulatif")), {
    mode: "cumulative",
    classId: null,
  })
  assert.deepEqual(readRecapView(new URLSearchParams("")), { mode: "daily", classId: null })
})

test("the daily tab never carries a class id", () => {
  assert.deepEqual(readRecapView(new URLSearchParams("tab=harian&kelas=kelas-7a")), {
    mode: "daily",
    classId: null,
  })
})

test("builds a query string without dropping unrelated params", () => {
  assert.equal(
    recapViewSearch("date=2026-08-28", { mode: "matrix", classId: "kelas-7a" }),
    "?date=2026-08-28&tab=kalender&kelas=kelas-7a",
  )
})

test("returning to the daily tab clears both tab params", () => {
  assert.equal(recapViewSearch("tab=kalender&kelas=kelas-7a", { mode: "daily", classId: null }), "")
  assert.equal(
    recapViewSearch("tab=kalender&kelas=kelas-7a&date=2026-08-28", { mode: "daily", classId: null }),
    "?date=2026-08-28",
  )
})

test("a tab switch pushes history so back returns to the previous tab", () => {
  assert.equal(
    shouldPushRecapHistory({ mode: "daily", classId: null }, { mode: "matrix", classId: "kelas-7a" }),
    true,
  )
})

test("changing class inside a tab replaces the entry instead of stacking undo steps", () => {
  assert.equal(
    shouldPushRecapHistory({ mode: "matrix", classId: "kelas-7a" }, { mode: "matrix", classId: "kelas-8b" }),
    false,
  )
})

test("identical views are recognised so no history entry is written", () => {
  assert.equal(isSameRecapView({ mode: "matrix", classId: "kelas-7a" }, { mode: "matrix", classId: "kelas-7a" }), true)
  assert.equal(isSameRecapView({ mode: "matrix", classId: "kelas-7a" }, { mode: "cumulative", classId: "kelas-7a" }), false)
})
