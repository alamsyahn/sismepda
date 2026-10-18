import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import test from "node:test"
import ts from "typescript"
import { planAccountDeletion } from "../lib/account-deletion"

const require = createRequire(import.meta.url)
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message) } }
function loadRoute(path: string, tx: Record<string, unknown>, events: string[]) {
  const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {}
  const dependencies: Record<string, unknown> = {
    "@/lib/prisma": { prisma: { student: tx.student, $transaction: async (fn: (tx: unknown) => unknown) => { events.push("transaction"); return fn(tx) } } },
    "@/lib/rbac-access": { requirePermission: async () => ({}), getAuthorizationContext: async () => ({ user: { id: "admin" }, isSystemAdmin: true }) },
    "@/lib/rbac-invariants-db": { lockSystemAdminPopulation: async () => { events.push("population-lock") }, assertSystemAdminPopulationIntact: async () => {}, InvariantViolationError: class extends Error {} },
    "@/lib/api-errors": { ApiError, authFailureResponse: (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "error" }, { status: e instanceof ApiError ? e.status : 500 }) },
    "@/lib/account-deletion": { planAccountDeletion },
    "@/lib/account-privilege": { resolveAccountTargetPrivilege: () => ({ isSystemAdmin: false, isPrivileged: false }) },
    "@/lib/rbac-invariants": { assertAccountMutationAllowed: () => null },
    "@/lib/same-origin": { verifySameOrigin: () => ({ ok: true }) },
    "@/lib/audit-log": { recordAuditLog: async () => { events.push("audit") } },
  }
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports, Response, require: (name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === "next/server") return { NextResponse: Response }
    if (name.startsWith("@/")) return {}
    return require(name)
  } })
  return exports.DELETE
}
const countModel = (events: string[], name: string, count: number, where?: Record<string, string>) => ({ count: async (query: { where: Record<string, string> }) => {
  if (where) assert.equal(JSON.stringify(query.where), JSON.stringify(where))
  events.push(name)
  return count
} })

for (const blocker of ["account", "menstruationRecord", "menstruationHistory", "menstruationConflict", "ksMember", "ksParticipant", "none"]) {
  test(`student deletion checks ${blocker} before attendance and retains private history`, async () => {
    const events: string[] = []
    const tx = {
      $executeRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => { events.push(`student-lock:${values.join(":")}`); assert.match(parts.join(""), /pg_advisory_xact_lock.*hashtextextended/) },
      user: countModel(events, "account", blocker === "account" ? 1 : 0, { studentId: "s1" }),
      menstruationRecord: countModel(events, "menstruationRecord", blocker === "menstruationRecord" ? 2 : 0),
      menstruationHistory: countModel(events, "menstruationHistory", blocker === "menstruationHistory" ? 3 : 0),
      menstruationConflict: countModel(events, "menstruationConflict", blocker === "menstruationConflict" ? 4 : 0),
      ksMember: countModel(events, "ksMember", blocker === "ksMember" ? 1 : 0),
      ksParticipant: countModel(events, "ksParticipant", blocker === "ksParticipant" ? 1 : 0),
      student: { findUnique: async () => { events.push("student-read"); return { nis: "123", nisn: null } }, delete: async () => { events.push("student-delete") } },
      attendance: { deleteMany: async () => { events.push("attendance-delete"); return { count: 7 } } },
    }
    const del = loadRoute("app/api/admin/students/route.ts", tx, events)
    const response = await del(new Request("http://localhost", { method: "DELETE", body: JSON.stringify({ id: "s1", confirmationIdentifier: "123" }) }))
    assert.equal(response.status, blocker === "none" ? 200 : 409)
    assert.deepEqual(events.slice(0, 4), ["transaction", "population-lock", "student-lock:menstruation:student:s1", "student-read"])
    const body = await response.json()
    if (blocker !== "none") {
      assert.match(body.error, /nonaktifkan/i)
      assert.ok(body.counts)
      assert.ok(!events.includes("attendance-delete"))
      assert.ok(!events.includes("student-delete"))
    } else {
      assert.equal(body.deletedAttendances, 7)
      assert.ok(events.indexOf("attendance-delete") > events.indexOf("menstruationConflict"))
    }
    assert.doesNotMatch(JSON.stringify(body), /complaint|proposed|startDate|endDate/)
  })
}

for (const blocker of ["menstruationRecord", "menstruationHistory", "menstruationConflict", "menstruationRequest", "ksCoach", "none"]) {
  test(`account deletion blocks ${blocker} before reassigning attendance`, async () => {
    const events: string[] = []
    const tx = {
      $executeRaw: async (parts: TemplateStringsArray) => { events.push("user-lock"); assert.match(parts.join(""), /FOR UPDATE/) },
      user: { findUnique: async () => ({ id: "u1", name: "Target", email: "target@example.test", nip: null, active: true, rbacRoles: [] }), delete: async () => { events.push("user-delete") } },
      ksCoach: countModel(events, "ksCoach", blocker === "ksCoach" ? 1 : 0),
      attendanceDay: { ...countModel(events, "attendance-count", 6), updateMany: async () => { events.push("attendance-update"); return { count: 6 } } },
      studentViolationPoint: countModel(events, "violation-count", 0),
      schoolClass: { updateMany: async () => { events.push("class-update") } },
      ...Object.fromEntries(["menstruationRecord", "menstruationHistory", "menstruationConflict", "menstruationRequest"].map(name => [name, countModel(events, name, blocker === name ? 2 : 0, name === "menstruationRequest" ? { actorId: "u1" } : { recordedById: "u1" })])),
    }
    const del = loadRoute("app/api/rbac/accounts/[userId]/route.ts", tx, events)
    const response = await del(new Request("http://localhost", { method: "DELETE", body: JSON.stringify({ confirmationIdentifier: "target@example.test" }) }), { params: Promise.resolve({ userId: "u1" }) })
    assert.equal(response.status, blocker === "none" ? 200 : 409)
    assert.deepEqual(events.slice(0, 3), ["transaction", "population-lock", "user-lock"])
    const body = await response.json()
    if (blocker !== "none") {
      assert.equal(body.reason, blocker === "ksCoach" ? "kesiswaan_coach" : "menstruation_attributed")
      assert.ok(body.counts)
      assert.match(body.error, /nonaktifkan/i)
      for (const write of ["attendance-update", "class-update", "audit", "user-delete"]) assert.ok(!events.includes(write))
    } else assert.equal(body.reassignedAttendanceDays, 6)
  })
}
