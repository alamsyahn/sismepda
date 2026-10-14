import assert from "node:assert/strict"
import test from "node:test"
import { provisionStudentAccount, type StudentAccountStore } from "../lib/student-account-service"

function fixture() {
  const events: string[] = []
  const created: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  const store: StudentAccountStore = {
    async findStudent() { events.push("student"); return { id: "s1", name: "Siswi", active: true, gender: "PEREMPUAN", account: null } },
    async findEmail() { events.push("email"); return null },
    async findStudentRole() { events.push("role"); return { id: "r1", key: "siswa", isProtected: false, permissionKeys: ["euks.menstruation.read.own", "euks.menstruation.create.own", "euks.menstruation.update.own"] } },
    async createAccount(input) { events.push("create"); created.push(input); return { id: "u1", name: input.name, email: input.email, active: true, studentId: input.studentId } },
    async audit(input) { events.push("audit"); audits.push(input) },
  }
  return { store, events, created, audits }
}

test("creates only a new linked non-teacher account with canonical siswa role and safe audit", async () => {
  const f = fixture()
  const result = await provisionStudentAccount({ studentId: "s1", email: "siswi@example.org", password: "chosen-passphrase" }, "actor", f.store, async (password) => { assert.equal(password, "chosen-passphrase"); return "bcrypt-hash" })
  assert.deepEqual(result, { id: "u1", name: "Siswi", email: "siswi@example.org", active: true, studentId: "s1" })
  assert.deepEqual(f.created, [{ name: "Siswi", email: "siswi@example.org", passwordHash: "bcrypt-hash", studentId: "s1", roleId: "r1", active: true, isTeacher: false, workbookSupervised: false, nip: null }])
  assert.deepEqual(f.events, ["student", "email", "role", "create", "audit"])
  assert.equal(JSON.stringify(f.audits).includes("bcrypt-hash"), false)
  assert.equal(JSON.stringify(f.audits).includes("chosen-passphrase"), false)
  assert.equal(JSON.stringify(result).includes("password"), false)
})

for (const permissionKeys of [[], ["students.read.all"], ["euks.menstruation.read.own", "accounts.credentials.manage"], ["euks.menstruation.read.own", "euks.menstruation.create.own", "euks.menstruation.update.own", "euks.visits.read"]]) {
  test(`rejects contaminated or incomplete siswa role: ${permissionKeys.join(",")}`, async () => {
    const f = fixture()
    f.store.findStudentRole = async () => ({ id: "r1", key: "siswa", isProtected: false, permissionKeys })
    await assert.rejects(provisionStudentAccount({ studentId: "s1", email: "a@example.org", password: "chosen-passphrase" }, "actor", f.store, async () => { assert.fail("must not hash"); }), { status: 503 })
    assert.equal(f.created.length, 0)
  })
}

for (const kind of ["missing", "inactive", "male", "linked", "email"] as const) {
  test(`rejects ${kind} target without a write or password hash`, async () => {
    const f = fixture()
    f.store.findStudent = async () => kind === "missing" ? null : ({ id: "s1", name: "Siswi", active: kind !== "inactive", gender: kind === "male" ? "LAKI_LAKI" : "PEREMPUAN", account: kind === "linked" ? { id: "existing" } : null })
    if (kind === "email") f.store.findEmail = async () => ({ id: "teacher-existing" })
    await assert.rejects(provisionStudentAccount({ studentId: "s1", email: "a@example.org", password: "chosen-passphrase" }, "actor", f.store, async () => { assert.fail("must not hash"); }), { status: kind === "linked" || kind === "email" ? 409 : 404 })
    assert.equal(f.created.length, 0)
    assert.equal(f.audits.length, 0)
  })
}
