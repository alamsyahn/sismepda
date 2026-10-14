import assert from "node:assert/strict"
import test from "node:test"
import { studentAccountCreateSchema } from "../lib/student-account-schemas"

const valid = { studentId: "student-1", email: " Student@example.org ", password: "Strong passphrase 42" }
test("provisioning normalizes the email and retains an explicitly chosen password", () => {
  assert.deepEqual(studentAccountCreateSchema.parse(valid), { ...valid, email: "student@example.org" })
})

for (const extra of ["userId", "nip", "nis", "nisn", "role", "roleIds", "permissions", "active", "isTeacher", "passwordHash", "linkedStudent"]) {
  test(`rejects mass assignment field ${extra}`, () => {
    assert.equal(studentAccountCreateSchema.safeParse({ ...valid, [extra]: "forged" }).success, false)
  })
}
for (const changes of [{ email: "" }, { email: "   " }, { email: "not-email" }, { password: "short" }, { password: "a".repeat(129) }, { studentId: "" }]) {
  test(`rejects invalid credential/link payload ${JSON.stringify(Object.keys(changes))}`, () => {
    assert.equal(studentAccountCreateSchema.safeParse({ ...valid, ...changes }).success, false)
  })
}
