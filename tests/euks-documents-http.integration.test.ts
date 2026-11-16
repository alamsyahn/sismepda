import "dotenv/config"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { PrismaPg } from "@prisma/adapter-pg"
import ExcelJS from "exceljs"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

test("local HTTP: UKS document lifecycle and access", {
  skip: process.env.SISMEPDA_DB_ROLE !== "local",
  timeout: 120000,
}, async () => {
  const url = process.env.DATABASE_URL!
  const database = new URL(url)
  assert.equal(database.pathname, "/sismepda_dev")
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname))
  const secret = process.env.AUTH_SECRET
  assert.ok(secret)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }) })
  const origin = "http://localhost:3019"
  const users: string[] = []
  const idMarker = randomUUID()
  const title = "Uji arsip " + idMarker
  const renamed = title + " baru"
  const apiPath = "/api/e-uks/documents"
  const cookieName = "authjs.session-token"

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3019"], {
    stdio: "ignore",
    env: { ...process.env, APP_ORIGIN: origin, AUTH_URL: origin, NEXTAUTH_URL: origin, AUTH_TRUST_HOST: "true" },
  })

  async function session(roleKey: string) {
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } })
    const { id } = await db.user.create({
      data: {
        name: "Uji Dokumen UKS", email: `docs-${roleKey}-${idMarker}@example.invalid`, passwordHash: "disabled",
        rbacRoles: { create: { roleId: role.id } },
      },
      select: { id: true },
    })
    users.push(id)
    return cookieName + "=" + await encode({ secret: secret!, salt: cookieName, token: { sub: id, id } })
  }

  function request(path: string, cookie = "", method = "GET", body?: FormData, requestOrigin = origin) {
    return fetch(origin + path, {
      method, body, headers: { Cookie: cookie, Origin: requestOrigin }, redirect: "manual",
      signal: AbortSignal.timeout(15000),
    })
  }

  function form(documentTitle: string, visibility: "internal" | "shared", version?: number, file?: File) {
    const data = new FormData()
    data.set("title", documentTitle)
    data.set("category", "SK")
    data.set("schoolYear", "2026/2027")
    data.set("visibility", visibility)
    if (version) data.set("version", String(version))
    if (file) data.set("file", file)
    return data
  }

  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) break
      try {
        ready = (await request("/login")).ok
        if (ready) break
      } catch {
        // Wait for Next to start.
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.ok(ready && server.exitCode === null, "Local Next server must start")

    const [manager, teacher, student] = await Promise.all([session("pengurus_uks"), session("guru"), session("siswa")])
    const original = new File(["%PDF-1.7\n% original\n%%EOF\n"], "SK Uji.pdf")
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("Uji").addRow(["Dokumen uji"])
    const replacement = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], "SK Baru.xlsx")
    assert.equal((await request(apiPath, teacher, "POST", form(title, "shared", undefined, original))).status, 403)
    assert.equal((await request(apiPath, manager, "POST", form(title, "shared", undefined, original), "https://example.invalid")).status, 403)
    assert.equal((await request(apiPath, manager, "POST", form(title, "internal", undefined, new File(["html"], "uji.pdf")))).status, 415)
    assert.equal((await request(apiPath, manager, "POST", form(title, "internal", undefined,
      new File([new Uint8Array(6 * 1024 * 1024)], "besar.pdf")))).status, 413)
    const create = await request(apiPath, manager, "POST", form(title, "internal", undefined, original))
    assert.equal(create.status, 201, await create.text())
    const doc = await db.euksDocument.findFirstOrThrow({ where: { title }, select: { id: true, version: true } })
    const path = apiPath + "/" + doc.id
    const listing = "/e-uks/dokumen?q=" + encodeURIComponent(title)
    const anonymous = await request(path)
    assert.equal(anonymous.status, 307)
    assert.equal(new URL(anonymous.headers.get("location")!, origin).pathname, "/login")
    assert.equal((await request(path, student)).status, 403)
    assert.equal((await request(path, teacher)).status, 404)
    assert.match(await (await request(listing, manager)).text(), new RegExp(title))
    assert.doesNotMatch(await (await request("/e-uks/dokumen", teacher)).text(), new RegExp(title))
    assert.equal(await (await request(path, manager)).text(), await original.text())

    assert.equal((await request(path, manager, "PATCH", form(renamed, "shared", doc.version))).status, 200)
    assert.equal(await (await request(path, teacher)).text(), await original.text())
    assert.match(await (await request(listing, teacher)).text(), new RegExp(renamed))
    assert.equal((await request(path, manager, "PATCH", form(renamed, "shared", doc.version))).status, 409)
    assert.equal((await request(path, manager, "PATCH", form(renamed, "shared", doc.version + 1, replacement))).status, 200)
    const download = await request(path, teacher)
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/)
    assert.equal(download.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), new Uint8Array(await replacement.arrayBuffer()))
    assert.equal((await request(path + "?version=3", teacher, "DELETE")).status, 403)
    assert.equal((await request(path + "?version=3", manager, "DELETE")).status, 200)
    assert.equal((await request(path, manager)).status, 404)
    assert.equal(await db.auditLog.count({ where: { entity: "EuksDocument", entityId: doc.id } }), 4)
  } finally {
    if (server.pid) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" })
      } else {
        server.kill("SIGTERM")
      }
    }
    try {
      await db.euksDocument.deleteMany({ where: { title: { in: [title, renamed] } } })
      await db.auditLog.deleteMany({ where: { actorId: { in: users }, entity: "EuksDocument" } })
      await db.user.deleteMany({ where: { id: { in: users } } })
    } finally {
      await db.$disconnect()
    }
  }
})
