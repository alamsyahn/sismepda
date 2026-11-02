import test from "node:test"
import assert from "node:assert/strict"
import { isStudentQr, scanInput, scanVisitInput, scanWindowAllowed } from "../lib/scan"
import { hasPermission, resolveClassScope } from "../lib/rbac"

test("scan accepts versioned opaque QR only and never treats a national ID as a credential", () => {
  assert.equal(isStudentQr("SP1:" + "a".repeat(32)), true)
  for (const invalid of [
    "260014",
    "0012345678",
    "https://school.example/?nis=123",
    "SP1:<script>",
    "SP1:" + "a".repeat(31),
  ])
    assert.equal(isStudentQr(invalid), false)
  const base = { requestId: "168a7ba1-cc2d-43c8-b8ca-fc9091853d37", mode: "attendance", source: "USB", code: "sample" }
  assert.equal(scanInput.safeParse(base).success, true)
  assert.equal(scanInput.safeParse({ ...base, studentId: "another" }).success, false)
  assert.equal(scanInput.safeParse({ ...base, source: "MANUAL" }).success, false)
  assert.equal(scanInput.safeParse({ ...base, code: "a".repeat(181) }).success, false)
})
test("scan window uses configured local minutes, inclusive boundaries and overnight windows", () => {
  for (const [time, expected] of [
    [389, false],
    [390, true],
    [480, true],
    [481, false],
  ] as const)
    assert.equal(scanWindowAllowed(time, "06:30", "08:00", true), expected)
  assert.equal(scanWindowAllowed(600, "06:30", "08:00", false), true)
  assert.equal(scanWindowAllowed(20, "23:00", "01:00", true), true)
  assert.equal(scanWindowAllowed(700, "23:00", "01:00", true), false)
})
test("UKS requires actual content and an explicit follow-up", () => {
  const base = {
    eventId: "event",
    complaint: "Pusing",
    treatment: "Istirahat",
    followUp: "Kembali ke kelas",
    notify: true,
  }
  assert.equal(scanVisitInput.safeParse(base).success, true)
  assert.equal(scanVisitInput.safeParse({ ...base, complaint: "   " }).success, false)
  assert.equal(scanVisitInput.safeParse({ ...base, followUp: "Lainnya" }).success, false)
  assert.equal(scanVisitInput.safeParse({ ...base, followUp: "Lainnya", detail: "Pemantauan" }).success, true)
})
test("scan access never widens a domain write scope or implies notification", () => {
  const subject = {
    userId: "operator",
    isTeacher: true,
    roles: [
      {
        id: "r",
        key: "operator",
        name: "Admin Sistem",
        permissionKeys: [
          "scan.attendance.use",
          "attendance.write.assigned_classes",
          "attendance.read.all",
          "scan.uks.use",
          "euks.visits.create",
        ],
      },
    ],
  }
  assert.equal(hasPermission(subject, "scan.attendance.use"), true)
  assert.equal(hasPermission(subject, "scan.cards.manage"), false)
  assert.equal(hasPermission(subject, "euks.visits.notify"), false)
  assert.deepEqual(
    resolveClassScope({ subject, resource: "attendance", action: "write", allowTeachersAccessAllClasses: false }),
    { allowed: true, scope: "assigned_classes" },
  )
  assert.equal(hasPermission({ ...subject, roles: [] }, "scan.attendance.use"), false)
})
