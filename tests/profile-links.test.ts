import assert from "node:assert/strict"
import test from "node:test"

import { studentProfileHref, teacherProfileHref } from "../lib/profile-links"

test("builds the canonical student profile route", () => {
  assert.equal(studentProfileHref("student-123"), "/siswa/student-123")
})

test("builds the canonical teacher profile route", () => {
  assert.equal(teacherProfileHref("teacher-456"), "/guru/teacher-456")
})

test("encodes identifiers used in profile routes", () => {
  assert.equal(studentProfileHref("student/a b"), "/siswa/student%2Fa%20b")
  assert.equal(teacherProfileHref("teacher/a b"), "/guru/teacher%2Fa%20b")
})
