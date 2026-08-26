import assert from "node:assert/strict"
import test from "node:test"

import { clampProfilePage, parseProfileDateRange } from "../lib/student-profile-query"

test("parses valid calendar dates with local date semantics", () => {
  const result = parseProfileDateRange("2026-08-26", "2026-08-31")
  assert.equal(result.from?.getFullYear(), 2026)
  assert.equal(result.from?.getMonth(), 7)
  assert.equal(result.from?.getDate(), 26)
  assert.equal(result.from?.getHours(), 0)
  assert.equal(result.to?.getDate(), 31)
  assert.equal(result.to?.getHours(), 23)
})

test("rejects impossible and reversed calendar ranges", () => {
  assert.deepEqual(parseProfileDateRange("2026-02-31", undefined), { from: undefined, to: undefined })
  assert.deepEqual(parseProfileDateRange("2026-08-31", "2026-08-01"), { from: undefined, to: undefined })
})

test("clamps requested pages to the available safe range", () => {
  assert.equal(clampProfilePage("999", 1), 1)
  assert.equal(clampProfilePage("2", 4), 2)
  assert.equal(clampProfilePage("999999999999999999999", 4), 1)
  assert.equal(clampProfilePage("invalid", 4), 1)
})
