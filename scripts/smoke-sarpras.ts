/**
 * HTTP smoke test for the Sarpras module against the running dev server.
 *
 * Verifies the thing that actually matters: permissions are enforced on the
 * SERVER, not merely hidden in the UI. Grants a real GURU account view-only
 * rights, logs in as that user, and asserts every mutation is refused — then
 * confirms an editor can perform the same writes.
 */
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

const BASE = "http://localhost:3000"
const cs = process.env.DATABASE_URL ?? ""
const schema = databaseSchema(cs)
if (schema !== "sismepda_local") {
  console.error(`Refusing to run: expected schema "sismepda_local", got "${schema}".`)
  process.exit(1)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cs }, { schema }) })

const PASSWORD = "guru12345"
let failures = 0

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

/** Cookie jar shared across one logged-in session. */
class Session {
  private cookies = new Map<string, string>()

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  absorb(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";")
      const index = pair.indexOf("=")
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), cookie: this.header() },
    })
    this.absorb(response)
    return response
  }

  async login(identifier: string, password: string): Promise<boolean> {
    const csrfResponse = await this.fetch("/api/auth/csrf")
    const { csrfToken } = await csrfResponse.json()
    const body = new URLSearchParams({ identifier, password, csrfToken, callbackUrl: BASE })
    const response = await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    // NextAuth redirects on both success and failure; the session cookie decides.
    void response
    const session = await (await this.fetch("/api/auth/session")).json()
    return Boolean(session?.user?.id)
  }

  async json(path: string, method: string, payload: unknown) {
    const response = await this.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    let data: Record<string, unknown> = {}
    try {
      data = await response.json()
    } catch {
      /* non-JSON body */
    }
    return { status: response.status, data }
  }
}

async function main() {
  const { hash } = await import("bcryptjs")
  const passwordHash = await hash(PASSWORD, 10)

  const viewerUser = await prisma.user.findFirst({
    where: { role: "GURU", active: true, email: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, email: true },
  })
  const editorUser = await prisma.user.findFirst({
    where: { role: "GURU", active: true, email: { not: null }, id: { not: viewerUser?.id } },
    orderBy: { name: "asc" },
    select: { id: true, email: true },
  })
  if (!viewerUser?.email || !editorUser?.email) throw new Error("Butuh dua akun GURU aktif")

  // Deterministic starting rights, plus a known password for both.
  await prisma.user.update({
    where: { id: viewerUser.id },
    data: { passwordHash, canViewSarpras: true, canEditSarpras: false },
  })
  await prisma.user.update({
    where: { id: editorUser.id },
    data: { passwordHash, canViewSarpras: true, canEditSarpras: true },
  })

  const location = await prisma.sarprasLocation.findFirst({ select: { id: true } })
  const itemType = await prisma.sarprasItemType.findFirst({ select: { id: true } })
  const item = await prisma.sarprasItem.findFirst({ select: { id: true } })
  if (!location || !itemType || !item) throw new Error("Jalankan seed-sarpras-fixture dulu")

  /* ---------------------------------------------------------------------- */
  console.log("\n== VIEWER (sarpras.view saja) ==")
  const viewer = new Session()
  check("login viewer", await viewer.login(viewerUser.email, PASSWORD))

  const viewPage = await viewer.fetch("/sarpras")
  check("viewer dapat membuka /sarpras", viewPage.status === 200, `status ${viewPage.status}`)

  const viewHistory = await viewer.fetch(`/api/sarpras/history?itemId=${item.id}`)
  check("viewer dapat membaca riwayat", viewHistory.status === 200, `status ${viewHistory.status}`)

  // The core assertion: every mutation endpoint must refuse a viewer.
  const mutations: Array<[string, string, string, unknown]> = [
    ["tambah barang", "/api/sarpras/items", "POST", {
      locationId: location.id, itemTypeId: itemType.id,
      targetQuantity: 1, availableQuantity: 1, goodQuantity: 1, moderateQuantity: 0, repairQuantity: 0,
    }],
    ["ubah barang", "/api/sarpras/items", "PATCH", { id: item.id, targetQuantity: 99 }],
    ["hapus barang", "/api/sarpras/items", "DELETE", { id: item.id }],
    ["tambah lokasi", "/api/sarpras/locations", "POST", { name: "Lokasi Ilegal Viewer" }],
    ["ubah lokasi", "/api/sarpras/locations", "PATCH", { id: location.id, name: "Diretas" }],
    ["hapus lokasi", "/api/sarpras/locations", "DELETE", { id: location.id }],
    ["tambah jenis barang", "/api/sarpras/item-types", "POST", { name: "Jenis Ilegal" }],
    ["ubah akses", "/api/sarpras/access", "PATCH", { userId: viewerUser.id, canEditSarpras: true }],
  ]
  for (const [label, path, method, payload] of mutations) {
    const { status } = await viewer.json(path, method, payload)
    check(`viewer DITOLAK: ${label}`, status === 403, `status ${status}`)
  }

  const stillViewer = await prisma.user.findUnique({
    where: { id: viewerUser.id },
    select: { canEditSarpras: true },
  })
  check("viewer tidak berhasil menaikkan haknya sendiri", stillViewer?.canEditSarpras === false)

  /* ---------------------------------------------------------------------- */
  console.log("\n== EDITOR (sarpras.edit) ==")
  const editor = new Session()
  check("login editor", await editor.login(editorUser.email, PASSWORD))

  const created = await editor.json("/api/sarpras/locations", "POST", {
    name: `Ruang Uji ${Date.now()}`,
  })
  check("editor dapat menambah lokasi", created.status === 201, `status ${created.status}`)
  const newLocationId = created.data.id as string | undefined

  let newItemId: string | undefined
  if (newLocationId) {
    const madeItem = await editor.json("/api/sarpras/items", "POST", {
      locationId: newLocationId,
      itemTypeId: itemType.id,
      targetQuantity: 4,
      availableQuantity: 2,
      goodQuantity: 2,
      moderateQuantity: 0,
      repairQuantity: 0,
    })
    check("editor dapat menambah barang", madeItem.status === 201, `status ${madeItem.status}`)
    newItemId = madeItem.data.id as string | undefined

    // Server-side validation of the accounting identity.
    const bad = await editor.json("/api/sarpras/items", "POST", {
      locationId: newLocationId,
      itemTypeId: itemType.id,
      targetQuantity: 5,
      availableQuantity: 5,
      goodQuantity: 1,
      moderateQuantity: 1,
      repairQuantity: 1,
    })
    check("jumlah kondisi tidak konsisten ditolak", bad.status === 400, `status ${bad.status}`)

    // Deleting a non-empty location must be refused, not silently cascade.
    const blocked = await editor.json("/api/sarpras/locations", "DELETE", { id: newLocationId })
    check("hapus lokasi berisi barang ditolak", blocked.status === 409, `status ${blocked.status}`)

    if (newItemId) {
      const readBack = await prisma.sarprasItem.findUnique({
        where: { id: newItemId },
        select: { targetQuantity: true, availableQuantity: true, goodQuantity: true },
      })
      check(
        "barang tersimpan benar di database",
        readBack?.targetQuantity === 4 && readBack.availableQuantity === 2 && readBack.goodQuantity === 2,
        JSON.stringify(readBack),
      )

      const history = await prisma.sarprasHistory.count({ where: { itemId: newItemId } })
      check("riwayat tercatat saat barang dibuat", history >= 1, `${history} entri`)

      const updated = await editor.json("/api/sarpras/items", "PATCH", {
        id: newItemId,
        availableQuantity: 3,
        goodQuantity: 2,
        moderateQuantity: 1,
        repairQuantity: 0,
      })
      check("editor dapat mengubah barang", updated.status === 200, `status ${updated.status}`)
      const historyAfter = await prisma.sarprasHistory.count({ where: { itemId: newItemId } })
      check("riwayat bertambah saat kondisi berubah", historyAfter > history, `${historyAfter} entri`)

      // Cleanup: item first, then the now-empty location.
      await editor.json("/api/sarpras/items", "DELETE", { id: newItemId })
    }
    const cleaned = await editor.json("/api/sarpras/locations", "DELETE", { id: newLocationId })
    check("hapus lokasi kosong berhasil", cleaned.status === 200, `status ${cleaned.status}`)
  }

  // A location may never be moved inside its own subtree.
  const root = await prisma.sarprasLocation.findFirst({
    where: { parentId: null, children: { some: {} } },
    select: { id: true, children: { select: { id: true }, take: 1 } },
  })
  if (root?.children[0]) {
    const cycle = await editor.json("/api/sarpras/locations", "PATCH", {
      id: root.id,
      parentId: root.children[0].id,
    })
    check("pindah lokasi ke keturunannya ditolak", cycle.status === 400, `status ${cycle.status}`)
  }

  console.log(`\n${failures === 0 ? "SEMUA PEMERIKSAAN LULUS" : `${failures} PEMERIKSAAN GAGAL`}`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
