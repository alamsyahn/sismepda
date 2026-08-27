import assert from "node:assert/strict"
import test from "node:test"

import { selectCumulativeClass, selectMatrixClass } from "../lib/rekap-kelas-navigation"

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
