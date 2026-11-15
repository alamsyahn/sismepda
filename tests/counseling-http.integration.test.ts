import "dotenv/config"
import { strict as assert } from "node:assert"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import { test } from "node:test"
import { PrismaPg } from "@prisma/adapter-pg"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

test("Curhat is account-private and replies require current counselor membership", {
  skip: process.env.SISMEPDA_DB_ROLE !== "local", timeout: 120000,
}, async () => {
  const url = process.env.DATABASE_URL!
  const target = new URL(url)
  assert.equal(target.pathname, "/sismepda_dev")
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
  assert.ok(process.env.AUTH_SECRET)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }) })
  assert.equal((await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name, "sismepda_dev")
  const base = "http://localhost:3019"
  const portal = "https://uks.smpn2blitar.sch.id"
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3019"], {
    stdio: "ignore", env: { ...process.env, AUTH_URL: base, NEXTAUTH_URL: base, AUTH_TRUST_HOST: "true" },
  })
  const users: string[] = []
  try {
    let ready = false
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      ready = await fetch(base + "/login", { signal: AbortSignal.timeout(1500) }).then(res => res.ok, () => false)
      if (!ready) await setTimeout(500)
    }
    assert.ok(ready)
    const role = await db.role.findUniqueOrThrow({ where: { key: "tim_konseling" } })
    const account = async (label: string, roleId?: string) => {
      const { id } = await db.user.create({
        data: {
          name: label, email: `curhat-${randomUUID()}@example.invalid`, passwordHash: "no-real-password",
          isTeacher: label === "Guru Uji",
          ...(roleId ? { rbacRoles: { create: { roleId } } } : {}),
        },
        select: { id: true },
      })
      users.push(id)
      const cookie = "authjs.session-token=" + await encode({
        secret: process.env.AUTH_SECRET!, salt: "authjs.session-token", token: { id, sub: id }, maxAge: 600,
      })
      return { id, cookie }
    }
    const teacher = await account("Guru Uji")
    const reader = await account("Staf Uji")
    const counselor = await account("Konselor Uji", role.id)
    const adminRole = await db.role.findUniqueOrThrow({ where: { key: "system_admin" } })
    const admin = await account("Admin Uji", adminRole.id)
    const call = async (cookie: string, status: number, query = "", body?: object, origin = portal) => {
      const response = await fetch(base + "/api/e-uks/portal/counseling" + query, {
        method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(12000),
        headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      assert.equal(response.status, status, query || "Curhat")
      return response.json()
    }

    await call("", 401)
    assert.deepEqual(await call(teacher.cookie, 200, "?mode=access"), { canReply: false })
    assert.deepEqual(await call(counselor.cookie, 200, "?mode=access"), { canReply: true })
    assert.deepEqual(await call(admin.cookie, 200, "?mode=access"), { canReply: false })
    const personal = { requestId: randomUUID(), body: "Pesan guru uji" }
    await call(teacher.cookie, 403, "", personal, base)
    await call(teacher.cookie, 200, "", personal)
    await call(teacher.cookie, 200, "", personal)
    await call(teacher.cookie, 409, "", { ...personal, body: "Isi berbeda" })
    const own = await call(teacher.cookie, 200)
    assert.equal(own.messages.length, 1)
    assert.deepEqual((await call(reader.cookie, 200)).messages, [])
    await call(reader.cookie, 404, "?before=" + own.messages[0].id)
    const thread = "?mode=reply&threadId=" + teacher.id
    await call(reader.cookie, 403, "?mode=reply")
    await call(reader.cookie, 403, thread)
    await call(reader.cookie, 403, "", { ...personal, threadId: teacher.id })
    await call(admin.cookie, 403, thread)
    const inbox = await call(counselor.cookie, 200, "?mode=reply")
    assert.ok(inbox.threads.some((row: { id: string }) => row.id === teacher.id))
    assert.deepEqual((await call(counselor.cookie, 200)).messages, [])
    await call(counselor.cookie, 200, "", { requestId: randomUUID(), body: "Curhat konselor uji" })
    assert.equal((await call(counselor.cookie, 200)).messages[0].fromSender, true)
    assert.deepEqual((await call(counselor.cookie, 200, thread)).messages, own.messages)
    const reply = { requestId: randomUUID(), body: "Balasan uji", threadId: teacher.id }
    await call(counselor.cookie, 200, "", reply)
    assert.deepEqual((await call(teacher.cookie, 200)).messages.map((row: { fromSender: boolean }) => row.fromSender), [true, false])
    await db.userRole.delete({ where: { userId_roleId: { userId: counselor.id, roleId: role.id } } })
    await call(counselor.cookie, 403, thread)
    await call(counselor.cookie, 403, "", { ...reply, requestId: randomUUID() })
    await call(counselor.cookie, 200)
  } finally {
    if (server.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" })
      else server.kill("SIGTERM")
    }
    await db.counselingMessage.deleteMany({ where: { authorId: { in: users } } })
    await db.user.deleteMany({ where: { id: { in: users } } })
    await db.$disconnect()
  }
})
