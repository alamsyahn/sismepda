import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { existsSync } from "node:fs"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { addSchoolDays, requireSchoolDate, startOfSchoolWeek } from "../lib/school-date"

// Explicit opt-in; npm test must never create fixtures or start a server.
const local = process.env.SISMEPDA_DB_ROLE === "local"
const origin = "http://localhost:3016"
const endpoint = "/api/e-uks/menstruation"

test("authenticated local HTTP: own isolation, live RBAC, weekly episode reuse, validation and cleanup", { skip: !local, timeout: 240_000 }, async () => {
  const url = process.env.DATABASE_URL!
  const target = new URL(url)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
  assert.equal(target.pathname, "/sismepda_dev")
  assert.ok(process.env.AUTH_SECRET, "AUTH_SECRET is required (never logged)")
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }) })
  let server: ChildProcess | undefined
  const actors: string[] = [], roles: string[] = []
  let classId = ""
  const statuses: Record<string, number> = {}
  const counts = async () => ({ students: await db.student.count(), users: await db.user.count(), classes: await db.schoolClass.count(), attendance: await db.attendance.count(), roles: await db.role.count(), permissions: await db.permission.count(), rolePermissions: await db.rolePermission.count(), userRoles: await db.userRole.count(), records: await db.menstruationRecord.count(), history: await db.menstruationHistory.count(), conflicts: await db.menstruationConflict.count(), requests: await db.menstruationRequest.count(), audit: await db.auditLog.count() })
  assert.equal((await db.$queryRaw<{ name: string }[]>`SELECT current_database() as name`)[0].name, "sismepda_dev")
  const before = await counts()
  const suffix = randomUUID()
  const stop = () => {
    if (!server?.pid) return
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" })
    else { try { process.kill(-server.pid, "SIGTERM") } catch { /* exited */ } }
    server = undefined
  }
  const freePort = async () => new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(3016, () => probe.close(() => resolve()))
  })
  const launch = async (production: boolean) => {
    const command = production ? ["node", "node_modules/next/dist/bin/next", "start", "--port", "3016"] : ["npm", "run", "dev:local", "--", "--port", "3016"]
    server = spawn(process.platform === "win32" ? "cmd.exe" : command[0], process.platform === "win32" ? ["/c", ...command] : command.slice(1), {
      cwd: process.cwd(), detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, APP_ORIGIN: origin, AUTH_URL: origin, NEXTAUTH_URL: origin, AUTH_TRUST_HOST: "true" },
    })
    // Do not echo application logs: exceptions may contain fixture/credential data.
    let exited = false
    server.on("exit", () => { exited = true })
    server.stdout?.resume(); server.stderr?.resume()
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(origin + "/api/auth/session", { signal: AbortSignal.timeout(1500) })
        if (response.status === 200) return
      } catch { /* readiness probe, not a blind sleep */ }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error(production ? "Isolated production server did not become ready" : "Isolated dev server did not become ready (possibly shared .next dev lock)")
  }
  const cookie = async (id: string) => "authjs.session-token=" + await encode({ secret: process.env.AUTH_SECRET!, salt: "authjs.session-token", maxAge: 600, token: { id, sub: id, name: "Temporary local HTTP fixture" } })
  const request = async (label: string, authCookie: string, expected: number, path = endpoint, body?: unknown, requestOrigin = origin) => {
    const response = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", redirect: "manual", signal: AbortSignal.timeout(60_000), headers: { Cookie: authCookie, Origin: requestOrigin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    statuses[label] = response.status
    assert.equal(response.status, expected, label)
    if (path === endpoint || path.startsWith(endpoint + "?")) assert.match(response.headers.get("cache-control") ?? "", /no-store/)
    return response.json()
  }
  try {
    await freePort()
    try { await launch(false) } catch (error) {
      stop(); await freePort()
      assert.ok(existsSync(".next/BUILD_ID"), "Dev unavailable and no production build exists")
      console.log(JSON.stringify({ serverFallback: "existing production build", reason: (error as Error).message }))
      await launch(true)
    }
    classId = (await db.schoolClass.create({ data: { name: `TEMP HTTP ${suffix}`, grade: "TEST" } })).id
    const female = await db.student.create({ data: { name: "TEMP HTTP owner", nis: `HTTP-F-${suffix}`, gender: "PEREMPUAN", classId } })
    const other = await db.student.create({ data: { name: "TEMP HTTP other", nis: `HTTP-O-${suffix}`, gender: "PEREMPUAN", classId } })
    const ownKeys = ["euks.menstruation.read.own", "euks.menstruation.create.own", "euks.menstruation.update.own"]
    const staffKeys = ["euks.menstruation.read", "euks.menstruation.create", "euks.menstruation.update", "euks.menstruation.review", "students.accounts.manage"]
    const makeActor = async (kind: string, keys: string[], studentId?: string) => {
      const permissions = await db.permission.findMany({ where: { key: { in: keys } }, select: { id: true } })
      assert.equal(permissions.length, keys.length, "Use only existing catalog permissions")
      const role = await db.role.create({ data: { key: `temp_http_${kind}_${suffix}`, name: `TEMP HTTP ${kind}`, isProtected: false, permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } })
      roles.push(role.id)
      const user = await db.user.create({ data: { name: `TEMP HTTP ${kind}`, email: `http-${kind}-${suffix}@example.invalid`, passwordHash: "not-a-valid-login-hash", studentId, active: true, isTeacher: false, rbacRoles: { create: { roleId: role.id } } } })
      actors.push(user.id)
      return { id: user.id, roleId: role.id, cookie: await cookie(user.id) }
    }
    const owner = await makeActor("owner", ownKeys, female.id)
    const staff = await makeActor("staff", staffKeys)
    const denied = await makeActor("denied", [])
    // Never repair or mutate the existing siswa role. Its empty configuration
    // must fail closed over actual HTTP before any password hashing/account write.
    const siswa = await db.role.findUnique({ where: { key: "siswa" }, include: { permissions: true } })
    if (!siswa || siswa.permissions.length === 0) {
      await request("empty siswa provisioning", staff.cookie, 503, "/api/admin/student-accounts", {
        studentId: other.id, email: `provision-${suffix}@example.invalid`, password: randomUUID(),
      })
      assert.equal(await db.user.count({ where: { studentId: other.id } }), 0)
    } else console.log(JSON.stringify({ provisioningHTTP: "existing siswa configuration preserved; positive provisioning covered by DB-injected temporary template test" }))
    const initial = await request("own GET", owner.cookie, 200)
    assert.equal(initial.student.id, female.id); assert.equal(initial.profile.neverMenstruated, null); assert.deepEqual(initial.episodes, [])
    const week2 = startOfSchoolWeek(requireSchoolDate(initial.today))
    const week1 = addSchoolDays(week2, -7)
    const episode = { action: "episode", requestId: randomUUID(), startDate: addSchoolDays(week1, 5), endDate: week2, complaint: "TEMP private HTTP complaint" }
    const created = await request("own POST", owner.cookie, 200, endpoint, episode)
    assert.equal(created.changed, 1)
    const readback = await request("own readback", owner.cookie, 200)
    assert.equal(readback.episodes[0].id, created.recordId); assert.equal(readback.episodes[0].source, "STUDENT"); assert.equal(readback.episodes[0].complaint, episode.complaint)
    assert.deepEqual(await request("replay", owner.cookie, 200, endpoint, episode), created)
    assert.equal(await db.menstruationRecord.count({ where: { studentId: female.id, kind: "EPISODE" } }), 1)
    await request("cross-student GET", owner.cookie, 403, `${endpoint}?studentId=${other.id}`)
    await request("cross-student POST", owner.cookie, 403, endpoint, { ...episode, requestId: randomUUID(), studentId: other.id })
    await request("no-permission GET", denied.cookie, 403, `${endpoint}?studentId=${female.id}`)
    await request("no-permission POST", denied.cookie, 403, endpoint, { ...episode, requestId: randomUUID(), studentId: female.id })
    await request("wrong Origin", owner.cookie, 403, endpoint, { ...episode, requestId: randomUUID() }, "https://example.invalid")
    for (const [label, startDate, endDate] of [["future", addSchoolDays(requireSchoolDate(initial.today), 1), null], ["invalid date", "2026-02-30", null], ["reverse dates", week2, week1]] as const) {
      await request(label, owner.cookie, 400, endpoint, { ...episode, requestId: randomUUID(), startDate, endDate })
    }
    const unread = await request("weekly missing", staff.cookie, 200, `${endpoint}?classId=${classId}&weekStart=${week1}`)
    assert.ok(unread.students.every((s: { confirmation: unknown }) => s.confirmation === null), "Missing is unknown, never NONE")
    for (const weekStart of [week1, week2]) {
      const batch = { action: "weekly", requestId: randomUUID(), classId, weekStart, rows: [{ studentId: female.id, status: "HAD", episodeId: created.recordId }, { studentId: other.id, status: "UNKNOWN" }] }
      const saved = await request(`weekly POST ${weekStart}`, staff.cookie, 200, endpoint, batch)
      assert.equal(saved.changed, 2)
      assert.deepEqual(await request(`weekly replay ${weekStart}`, staff.cookie, 200, endpoint, batch), saved)
      const week = await request(`weekly GET ${weekStart}`, staff.cookie, 200, `${endpoint}?classId=${classId}&weekStart=${weekStart}`)
      assert.equal(week.students.find((s: { id: string }) => s.id === female.id).confirmation.episodeId, created.recordId)
      assert.equal(week.students.find((s: { id: string }) => s.id === other.id).confirmation.status, "UNKNOWN")
    }
    assert.equal(await db.menstruationRecord.count({ where: { studentId: female.id, kind: "EPISODE" } }), 1)
    // A stale multi-pupil batch is private to staff. The owner's conflict and
    // history DTOs must never contain another pupil's identifier or complaint.
    const privateOtherComplaint = `TEMP OTHER PRIVATE ${suffix}`
    await request("multi-pupil stale batch", staff.cookie, 409, endpoint, {
      action: "weekly", requestId: randomUUID(), classId, weekStart: week2,
      rows: [{ studentId: female.id, status: "HAD", version: 0, complaint: "changed own note" }, { studentId: other.id, status: "UNKNOWN", version: 1, complaint: privateOtherComplaint }],
    })
    const ownAfterConflict = await request("own conflict privacy", owner.cookie, 200)
    const ownPrivateDto = JSON.stringify({ conflicts: ownAfterConflict.conflicts, history: ownAfterConflict.history })
    assert.ok(!ownPrivateDto.includes(other.id), "Own conflicts/history leak another student's identifier")
    assert.ok(!ownPrivateDto.includes(privateOtherComplaint), "Own conflicts/history leak another student's complaint")
    await request("contradictory NONE", staff.cookie, 409, endpoint, {
      action: "weekly", requestId: randomUUID(), classId, weekStart: week2,
      rows: [{ studentId: female.id, status: "NONE", version: 1 }],
    })
    // The same signed JWT must lose access immediately after its fixture grant is revoked.
    await db.userRole.delete({ where: { userId_roleId: { userId: owner.id, roleId: owner.roleId } } })
    await request("revoked same-cookie GET", owner.cookie, 403)
    await request("revoked same-cookie replay", owner.cookie, 403, endpoint, episode)
    console.log(JSON.stringify({ target: { host: target.hostname, database: "sismepda_dev", schema: databaseSchema(url) }, statuses, before }))
  } finally {
    stop()
    if (actors.length) { await db.auditLog.deleteMany({ where: { actorId: { in: actors } } }); await db.menstruationRequest.deleteMany({ where: { actorId: { in: actors } } }) }
    if (classId) {
      const ids = (await db.student.findMany({ where: { classId }, select: { id: true } })).map(s => s.id)
      await db.menstruationConflict.deleteMany({ where: { studentId: { in: ids } } })
      await db.menstruationHistory.deleteMany({ where: { studentId: { in: ids } } })
      await db.menstruationRecord.deleteMany({ where: { studentId: { in: ids } } })
    }
    await db.user.deleteMany({ where: { id: { in: actors } } })
    await db.role.deleteMany({ where: { id: { in: roles } } })
    if (classId) { await db.student.deleteMany({ where: { classId } }); await db.schoolClass.delete({ where: { id: classId } }) }
    try { const after = await counts(); console.log(JSON.stringify({ after, restored: JSON.stringify(before) === JSON.stringify(after) })); assert.deepEqual(after, before); await freePort() } finally { await db.$disconnect() }
  }
})
