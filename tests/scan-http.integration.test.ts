import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { qrHash } from "../lib/server-scan"
import { todayInSchoolTimeZone, toPrismaDate } from "../lib/school-date"

test(
  "local HTTP scan: DB RBAC, class isolation, CSRF, replay, UKS notification permission, stale roster and live revocation",
  { skip: process.env.SISMEPDA_DB_ROLE !== "local", timeout: 240000 },
  async () => {
    const url = process.env.DATABASE_URL!,
      target = new URL(url),
      origin = "http://localhost:3018"
    assert.equal(target.pathname, "/sismepda_dev")
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
    assert.ok(process.env.AUTH_SECRET)
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }) })
    assert.equal((await db.$queryRaw<{ name: string }[]>`SELECT current_database() as name`)[0].name, "sismepda_dev")
    let server: ChildProcess | undefined
    const users: string[] = [],
      roles: string[] = [],
      classes: string[] = [],
      studentIds: string[] = []
    const suffix = randomUUID(),
      statuses: Record<string, number> = {}
    const counts = async () => ({
      users: await db.user.count(),
      students: await db.student.count(),
      events: await db.scanEvent.count(),
      credentials: await db.studentQrCredential.count(),
      attendance: await db.attendance.count(),
      visits: await db.euksVisit.count(),
      audit: await db.auditLog.count(),
      roles: await db.role.count(),
    })
    const before = await counts()
    const stop = () => {
      if (server?.pid) {
        if (process.platform === "win32")
          spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" })
        else server.kill("SIGTERM")
      }
      server = undefined
    }
    const cookie = async (id: string) =>
      "authjs.session-token=" +
      (await encode({
        secret: process.env.AUTH_SECRET!,
        salt: "authjs.session-token",
        maxAge: 600,
        token: { id, sub: id },
      }))
    const request = async (
      label: string,
      auth: string,
      expected: number,
      path: string,
      body?: unknown,
      method = "POST",
      requestOrigin = origin,
    ) => {
      const r = await fetch(origin + path, {
        method: body === undefined ? "GET" : method,
        redirect: "manual",
        signal: AbortSignal.timeout(45000),
        headers: { Cookie: auth, Origin: requestOrigin, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      statuses[label] = r.status
      const data = await r.json().catch(() => null)
      assert.equal(r.status, expected, label + (r.status !== expected ? `: ${data?.error ?? "unknown response"}` : ""))
      return data
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const port = createServer()
        port.once("error", reject)
        port.listen(3018, () => port.close(() => resolve()))
      })
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3018"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, APP_ORIGIN: origin, AUTH_URL: origin, NEXTAUTH_URL: origin, AUTH_TRUST_HOST: "true" },
      })
      server.stdout?.resume()
      server.stderr?.resume()
      let ready = false
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(origin + "/login", { signal: AbortSignal.timeout(1500) })).ok) {
            ready = true
            break
          }
        } catch {
          /* boot */
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      assert.ok(ready, "Local built server must start")
      const makeUser = async (name: string, keys: string[], system = false) => {
        const permissions = await db.permission.findMany({ where: { key: { in: keys } } })
        assert.equal(permissions.length, keys.length)
        const role = await db.role.create({
          data: {
            name: "TEMP scan " + name,
            key: "temp_scan_" + name + "_" + suffix,
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        })
        roles.push(role.id)
        const user = await db.user.create({
          data: {
            name: "TEMP Scan " + name,
            email: `scan-${name}-${suffix}@example.invalid`,
            passwordHash: "invalid-login",
            isTeacher: false,
            rbacRoles: { create: { roleId: role.id } },
          },
        })
        users.push(user.id)
        if (system) {
          const admin = await db.role.findUniqueOrThrow({ where: { key: "system_admin" } })
          await db.userRole.create({ data: { userId: user.id, roleId: admin.id } })
        }
        return { ...user, roleId: role.id, cookie: await cookie(user.id) }
      }
      const keys = [
        "scan.attendance.use",
        "attendance.write.assigned_classes",
        "attendance.read.assigned_classes",
        "scan.history.read",
        "scan.uks.use",
        "euks.visits.create",
      ]
      const operator = await makeUser("operator", keys),
        denied = await makeUser("denied", []),
        admin = await makeUser("admin", [], true)
      const ownClass = await db.schoolClass.create({
        data: { name: "TEMP Scan A " + suffix, grade: "TEST", homeroomUserId: operator.id },
      })
      classes.push(ownClass.id)
      const otherClass = await db.schoolClass.create({ data: { name: "TEMP Scan B " + suffix, grade: "TEST" } })
      classes.push(otherClass.id)
      const a = await db.student.create({
        data: { name: "TEMP Scan Nadya", nis: "SCAN-A-" + suffix, classId: ownClass.id },
      })
      studentIds.push(a.id)
      const b = await db.student.create({
        data: { name: "TEMP Scan Raka", nis: "SCAN-B-" + suffix, classId: otherClass.id },
      })
      studentIds.push(b.id)
      const capabilities = await request("capabilities", operator.cookie, 200, "/api/scan")
      assert.equal(capabilities.attendance, true)
      assert.equal(capabilities.notify, false)
      assert.equal(capabilities.cards, false)
      await request("empty grants", denied.cookie, 403, "/api/scan")
      await request("invalid session", await cookie("no-such-user"), 401, "/api/scan")
      await request("card grant required", operator.cookie, 403, "/api/scan/cards", {
        entries: [{ studentId: a.id, expectedCredentialId: null }],
        replace: false,
        includeExisting: true,
      })
      const issued = await request("admin issue cards", admin.cookie, 200, "/api/scan/cards", {
        entries: [{ studentId: a.id, expectedCredentialId: null }],
        replace: false,
      })
      assert.equal(issued.cards.length, 1)
      const printBody = { entries: [a, b].map((s) => ({ studentId: s.id, expectedCredentialId: null })), includeExisting: true }
      await request("print cross origin", admin.cookie, 403, "/api/scan/cards", printBody, "POST", "https://untrusted.example")
      const printed = await request("mixed card print", admin.cookie, 200, "/api/scan/cards", printBody)
      assert.equal(printed.cards.length, 2)
      const existingPrint = printed.cards.find((c: { student: { id: string } }) => c.student.id === a.id)
      assert.equal(existingPrint.credentialId, issued.cards[0].credentialId)
      assert.ok(existingPrint.code.startsWith("SP2:"))
      assert.equal(await db.studentQrCredential.count({ where: { studentId: a.id } }), 1)
      const codeA = issued.cards[0].code,
        codeB = printed.cards.find((c: { student: { id: string } }) => c.student.id === b.id).code
      assert.notEqual(
        (await db.studentQrCredential.findUniqueOrThrow({ where: { tokenHash: qrHash(codeA) } })).tokenHash,
        codeA,
      )
      const command = { requestId: randomUUID(), mode: "attendance", source: "USB", code: codeA }
      await request("cross origin", operator.cookie, 403, "/api/scan", command, "POST", "https://untrusted.example")
      await request("cross class", operator.cookie, 404, "/api/scan", {
        ...command,
        requestId: randomUUID(),
        code: codeB,
      })
      const first = await request("scan", operator.cookie, 200, "/api/scan", command)
      const replay = await request("scan replay", operator.cookie, 200, "/api/scan", command)
      assert.equal(first.id, replay.id)
      await request("mismatched replay", operator.cookie, 409, "/api/scan", { ...command, source: "CAMERA" })
      const search = await request(
        "scoped search",
        operator.cookie,
        200,
        "/api/scan/students?mode=attendance&q=TEMP%20Scan",
      )
      assert.ok(search.students.every((s: { classId: string }) => s.classId === ownClass.id))
      const visit = await request("UKS scan", operator.cookie, 200, "/api/scan", {
        ...command,
        requestId: randomUUID(),
        mode: "uks",
      })
      const visitBody = {
        eventId: visit.id,
        complaint: "Temporary test complaint",
        treatment: "Temporary test action",
        followUp: "Kembali ke kelas",
        detail: "",
        notify: true,
      }
      const visitCount = await db.euksVisit.count()
      await request("notify forbidden before commit", operator.cookie, 403, "/api/scan/visits", visitBody)
      assert.equal(await db.euksVisit.count(), visitCount)
      const saved = await request("save UKS", operator.cookie, 200, "/api/scan/visits", { ...visitBody, notify: false })
      const savedAgain = await request("save replay", operator.cookie, 200, "/api/scan/visits", {
        ...visitBody,
        notify: false,
      })
      assert.equal(saved.visitId, savedAgain.visitId)
      await request("UKS history requires read", operator.cookie, 403, "/api/scan/history?mode=uks")
      const schoolSetting = await db.schoolSetting.findUnique({ where: { id: "default" }, select: { timeZone: true } }),
        date = todayInSchoolTimeZone(undefined, schoolSetting?.timeZone)
      await db.attendanceDay.upsert({
        where: { classId_date: { classId: ownClass.id, date: toPrismaDate(date) } },
        update: { revision: { increment: 1 } },
        create: { classId: ownClass.id, date: toPrismaDate(date), submittedById: operator.id, revision: 1 },
      })
      await request("stale roster", operator.cookie, 409, "/api/attendance", {
        classId: ownClass.id,
        date,
        revision: 0,
        records: [{ studentId: a.id, status: "HADIR" }],
      })
      const history = await request(
        "history scope",
        operator.cookie,
        200,
        `/api/scan/history?mode=attendance&date=${date}`,
      )
      assert.ok(history.rows.every((r: { student: { name: string } | null }) => r.student?.name !== b.name))
      if (process.env.SCAN_BROWSER_SCRIPT) {
        const browser = spawnSync(process.execPath, [process.env.SCAN_BROWSER_SCRIPT], {
          encoding: "utf8",
          env: {
            ...process.env,
            SCAN_TEST_ORIGIN: origin,
            SCAN_TEST_COOKIE: operator.cookie,
            SCAN_TEST_ADMIN_COOKIE: admin.cookie,
            SCAN_TEST_STUDENT: a.id,
            SCAN_TEST_CLASS: ownClass.id,
          },
          timeout: 90000,
        })
        console.log(browser.stdout)
        assert.equal(browser.status, 0, "Browser acceptance: " + browser.stderr)
      }
      const permission = await db.permission.findUniqueOrThrow({ where: { key: "scan.attendance.use" } })
      await db.rolePermission.delete({
        where: { roleId_permissionId: { roleId: operator.roleId, permissionId: permission.id } },
      })
      await request("live grant revoked", operator.cookie, 403, "/api/scan", { ...command, requestId: randomUUID() })
      await db.user.update({ where: { id: operator.id }, data: { active: false } })
      await request("inactive session", operator.cookie, 401, "/api/scan")
      console.log(JSON.stringify({ scanHttp: statuses }))
    } finally {
      stop()
      await db.scanEvent.deleteMany({ where: { actorId: { in: users } } })
      await db.euksVisit.deleteMany({ where: { studentId: { in: studentIds } } })
      await db.attendance.deleteMany({ where: { studentId: { in: studentIds } } })
      await db.attendanceDay.deleteMany({ where: { classId: { in: classes } } })
      await db.student.deleteMany({ where: { id: { in: studentIds } } })
      await db.schoolClass.deleteMany({ where: { id: { in: classes } } })
      await db.auditLog.deleteMany({ where: { actorId: { in: users } } })
      await db.user.deleteMany({ where: { id: { in: users } } })
      await db.role.deleteMany({ where: { id: { in: roles } } })
      assert.deepEqual(await counts(), before)
      await db.$disconnect()
    }
  },
)
