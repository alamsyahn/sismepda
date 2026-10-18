import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  attendanceMetrics,
  attendanceProblem,
  periodInput,
  achievementInput,
  completedReview,
  memberInMonth,
  memberAt,
} from "../lib/kesiswaan"

test("attendance excludes cancelled and draft rows from rate, keeps blank slots distinct from absence", () => {
  const result = attendanceMetrics([
    { status: "FINAL", attendance: [{ status: "H" }, { status: "I" }] },
    { status: "DRAFT", attendance: [{ status: null }, { status: "H" }] },
    { status: "CANCELLED", attendance: [{ status: "A" }] },
  ])
  assert.equal(result.slots, 4)
  assert.equal(result.filled, 3)
  assert.equal(result.rate, 50)
  assert.equal(attendanceMetrics([]).rate, null)
})
test("finalization rejects empty, duplicate and foreign roster slots", () => {
  assert.ok(attendanceProblem([], [], true))
  assert.ok(
    attendanceProblem(
      ["a", "b"],
      [
        { id: "a", status: "H" },
        { id: "a", status: "H" },
      ],
      true,
    ),
  )
  assert.ok(attendanceProblem(["a"], [{ id: "x", status: "H" }], false))
  assert.ok(attendanceProblem(["a"], [{ id: "a", status: null }], true))
  assert.equal(attendanceProblem(["a"], [{ id: "a", status: null }], false), null)
})
test("period dates validate actual calendar dates and ordering", () => {
  assert.equal(
    periodInput.safeParse({
      year: "2026/2027",
      semester: "Ganjil",
      start: "2026-02-30",
      end: "2026-06-01",
    }).success,
    false,
  )
  assert.equal(
    periodInput.safeParse({
      year: "2026/2027",
      semester: "Ganjil",
      start: "2026-07-01",
      end: "2026-06-01",
    }).success,
    false,
  )
})
test("achievement evidence rejects executable URLs", () => {
  const result = achievementInput.safeParse({
    periodId: "p",
    activityId: null,
    title: "Lomba",
    organizer: "Sekolah",
    date: "2026-08-01",
    level: "Lokal",
    result: "Juara I",
    participantIds: ["s"],
    evidence: "javascript:alert(1)",
    status: "DRAFT",
  })
  assert.equal(result.success, false)
})

test("evaluation completion requires all dimensions and respects membership intervals", () => {
  assert.equal(
    completedReview({ skill: "Mandiri", teamwork: "Belum dinilai", independence: "Mandiri" }),
    false,
  )
  assert.equal(
    completedReview({ skill: "Mandiri", teamwork: "Berkembang", independence: "Mandiri" }),
    true,
  )
  const membership = { joined: "2026-08-15", left: "2026-10-10" }
  assert.equal(memberInMonth(membership, "2026-07"), false)
  assert.equal(memberInMonth(membership, "2026-08"), true)
  assert.equal(memberAt(membership, "2026-10-09"), true)
  assert.equal(memberAt(membership, "2026-10-11"), false)
})
