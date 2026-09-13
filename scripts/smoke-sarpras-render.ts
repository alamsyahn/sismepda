/**
 * Renders /sarpras as a real viewer and asserts the dashboard numbers, tabs,
 * and tree actually reach the HTML — not just that the route returns 200.
 * Also confirms a user with NO sarpras rights is redirected away.
 */
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { summarizeSarpras, sarprasStatusLabels } from "../lib/sarpras"

const BASE = "http://localhost:3000"
const cs = process.env.DATABASE_URL ?? ""
const schema = databaseSchema(cs)
if (schema !== "sismepda_local") process.exit(1)
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cs }, { schema }) })

const PASSWORD = "guru12345"
let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

class Session {
  private cookies = new Map<string, string>()
  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
  private absorb(r: Response) {
    for (const raw of r.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";")
      const i = pair.indexOf("=")
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
  }
  async fetch(path: string, init: RequestInit = {}) {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), cookie: this.header() },
    })
    this.absorb(r)
    return r
  }
  async login(identifier: string) {
    const { csrfToken } = await (await this.fetch("/api/auth/csrf")).json()
    await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ identifier, password: PASSWORD, csrfToken, callbackUrl: BASE }).toString(),
    })
    return Boolean((await (await this.fetch("/api/auth/session")).json())?.user?.id)
  }
}

async function main() {
  const viewerUser = await prisma.user.findFirst({
    where: { role: "GURU", active: true, canViewSarpras: true, canEditSarpras: false },
    select: { id: true, email: true },
  })
  const noRights = await prisma.user.findFirst({
    where: { role: "GURU", active: true, canViewSarpras: false, canEditSarpras: false, email: { not: null } },
    select: { id: true, email: true },
  })
  if (!viewerUser?.email || !noRights?.email) throw new Error("Butuh akun uji")

  const { hash } = await import("bcryptjs")
  await prisma.user.update({
    where: { id: noRights.id },
    data: { passwordHash: await hash(PASSWORD, 10) },
  })

  const stored = await prisma.sarprasItem.findMany({
    select: {
      targetQuantity: true,
      availableQuantity: true,
      goodQuantity: true,
      moderateQuantity: true,
      repairQuantity: true,
    },
  })
  const stats = summarizeSarpras(stored)

  const viewer = new Session()
  check("login viewer", await viewer.login(viewerUser.email))
  const page = await viewer.fetch("/sarpras")
  const html = await page.text()
  check("halaman /sarpras 200", page.status === 200, `status ${page.status}`)

  // Dashboard numbers must be present in the server-rendered HTML.
  check("judul ringkasan tampil", html.includes("Ringkasan Kondisi Sarpras"))
  check("total unit tampil di tengah donut", html.includes(stats.total.toLocaleString("id-ID")), `total ${stats.total}`)
  for (const status of ["MISSING", "REPAIR", "MODERATE", "GOOD"] as const) {
    check(`label "${sarprasStatusLabels[status]}" tampil`, html.includes(sarprasStatusLabels[status]))
  }
  check("section Prioritas Sarpras tampil", html.includes("Prioritas Sarpras"))
  check("section Data Sarana &amp; Prasarana tampil", /Data Sarana\s*&(amp;|#x26;)?\s*Prasarana/.test(html))
  check("pencarian global tampil", html.includes("Cari barang atau lokasi..."))
  check("lokasi tree tampil (Kelas)", html.includes("Kelas"))

  // Viewer must NOT see editing affordances.
  check("viewer tidak melihat tombol Tambah Lokasi", !html.includes("Tambah Lokasi"))
  check("viewer tidak melihat tombol Kelola Akses", !html.includes("Kelola Akses"))

  // Access page is admin-only.
  const aksesAsViewer = await viewer.fetch("/sarpras/akses")
  check("viewer dialihkan dari /sarpras/akses", aksesAsViewer.status === 307 || aksesAsViewer.status === 302, `status ${aksesAsViewer.status}`)

  // A user with no rights at all must be redirected off the module.
  const outsider = new Session()
  check("login tanpa hak", await outsider.login(noRights.email))
  const blocked = await outsider.fetch("/sarpras")
  check("tanpa hak dialihkan dari /sarpras", blocked.status === 307 || blocked.status === 302, `status ${blocked.status}`)

  console.log(`\n${failures === 0 ? "SEMUA PEMERIKSAAN LULUS" : `${failures} PEMERIKSAAN GAGAL`}`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
