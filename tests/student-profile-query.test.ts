import assert from "node:assert/strict"
import test from "node:test"

import { clampProfilePage, parseProfileDateRange } from "../lib/student-profile-query"

test("parses valid calendar dates as canonical Prisma DATE values", () => {
  const result = parseProfileDateRange("2026-08-26", "2026-08-31")
  assert.equal(result.from?.toISOString(), "2026-08-26T00:00:00.000Z")
  assert.equal(result.to?.toISOString(), "2026-08-31T00:00:00.000Z")
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
