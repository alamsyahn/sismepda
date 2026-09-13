/**
 * Verifikasi end-to-end route handler RBAC terhadap server dev yang hidup.
 *
 * Membuktikan lewat HTTP nyata — bukan lewat unit test service — bahwa:
 *   1. otorisasi per-permission benar-benar menjaga tiap endpoint;
 *   2. optimistic concurrency menolak penulisan basi dengan 409;
 *   3. penghapusan role bermember butuh niat eksplisit;
 *   4. permission di luar kewenangan ditolak seluruhnya, tidak di-drop diam-diam;
 *   5. dua permintaan bersamaan yang mencabut Admin Sistem terakhir tidak dapat
 *      sama-sama berhasil.
 *
 * Data uji berawalan `rt-verify-` dan dibersihkan kembali.
 * Kredensial dibaca dari .env dan tidak pernah dicetak.
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { computeAssignmentRevision } from "../lib/rbac-assignment-service"
import { SYSTEM_ADMIN_ROLE_KEY } from "../lib/rbac-permissions"

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000"
const email = process.env.SEED_ADMIN_EMAIL ?? process.env.DEV_TEST_USER_EMAIL
const password = process.env.SEED_ADMIN_PASSWORD ?? process.env.DEV_TEST_USER_PASSWORD

if (!email || !password) {
  console.error("Lewati: kredensial admin tidak tersedia di .env")
  process.exit(2)
}

const jar = new Map<string, string>()
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")

function absorb(response: Response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";")
    const index = pair.indexOf("=")
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(init.headers ?? {}),
      cookie: cookieHeader(),
    },
  })
  absorb(response)
  return response
}

async function login() {
  const { csrfToken } = (await (await api("/api/auth/csrf")).json()) as { csrfToken: string }
  await api("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, identifier: email!, password: password!, callbackUrl: BASE }),
  })
  const session = await (await api("/api/auth/session")).json()
  if (!session?.user?.id) throw new Error("login gagal; periksa kredensial admin di .env")
  return session.user.id as string
}

const results: { label: string; pass: boolean; detail: string }[] = []
function check(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail })
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`)
}

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL },
  { schema: databaseSchema(process.env.DATABASE_URL!) },
)
const prisma = new PrismaClient({ adapter })

const TAG = "rt_verify"
const created: string[] = []

async function cleanup() {
  await prisma.rolePermission.deleteMany({ where: { role: { key: { startsWith: TAG } } } })
  await prisma.userRole.deleteMany({ where: { role: { key: { startsWith: TAG } } } })
  await prisma.role.deleteMany({ where: { key: { startsWith: TAG } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } })
  await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } })
}

async function main() {
  const actorId = await login()
  console.log("Sesi admin diperoleh.\n")
  await cleanup()

  // --- 1. Membuat role ---
  const createResponse = await api("/api/rbac/roles", {
    method: "POST",
    body: JSON.stringify({
      key: `${TAG}_dasar`,
      name: "Peran Verifikasi",
      description: "dibuat oleh skrip verifikasi",
      permissionKeys: ["attendance.dashboard.read.all"],
    }),
  })
  const createdRole = createResponse.status === 201 ? await createResponse.json() : null
  check("POST /api/rbac/roles membuat role", createResponse.status === 201, `HTTP ${createResponse.status}`)
  if (!createdRole) {
    console.error("Tidak dapat melanjutkan tanpa role.")
    await cleanup()
    process.exit(1)
  }
  created.push(createdRole.id)

  // --- 2. Kontrol: pembaruan dengan versi benar HARUS berhasil ---
  const okUpdate = await api(`/api/rbac/roles/${createdRole.id}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: createdRole.version, name: "Peran Verifikasi B" }),
  })
  const updated = okUpdate.status === 200 ? await okUpdate.json() : null
  check(
    "KONTROL: PATCH dengan versi benar diterima",
    okUpdate.status === 200,
    `HTTP ${okUpdate.status}`,
  )

  // --- 3. Versi basi ditolak 409 ---
  const staleUpdate = await api(`/api/rbac/roles/${createdRole.id}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: createdRole.version, name: "Tertimpa" }),
  })
  check("PATCH dengan versi basi ditolak 409", staleUpdate.status === 409, `HTTP ${staleUpdate.status}`)

  // --- 4. Permission tak dikenal ditolak seluruhnya ---
  const unknownPermission = await api(`/api/rbac/roles/${createdRole.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: updated?.version ?? createdRole.version,
      permissionKeys: ["attendance.dashboard.read.all", "tidak.ada.permission.ini"],
    }),
  })
  check(
    "permission tak dikenal menolak seluruh mutasi",
    unknownPermission.status === 400,
    `HTTP ${unknownPermission.status}`,
  )

  const afterReject = await prisma.role.findUnique({
    where: { id: createdRole.id },
    select: { permissions: { select: { permission: { select: { key: true } } } } },
  })
  check(
    "mutasi yang ditolak tidak menyimpan sebagian",
    afterReject?.permissions.length === 1,
    `${afterReject?.permissions.length} permission tersimpan`,
  )

  // --- 5. Field asing ditolak ---
  const foreignField = await api(`/api/rbac/roles/${createdRole.id}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: updated?.version ?? 1, isProtected: true, name: "X" }),
  })
  check("field asing (isProtected) ditolak", foreignField.status === 400, `HTTP ${foreignField.status}`)

  // --- 6. Role terproteksi tidak dapat dihapus ---
  const systemRole = await prisma.role.findUnique({
    where: { key: SYSTEM_ADMIN_ROLE_KEY },
    select: { id: true, version: true },
  })
  if (systemRole) {
    const deleteProtected = await api(`/api/rbac/roles/${systemRole.id}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedVersion: systemRole.version }),
    })
    check(
      "role system_admin tidak dapat dihapus",
      deleteProtected.status === 403,
      `HTTP ${deleteProtected.status}`,
    )
    const stillThere = await prisma.role.findUnique({ where: { key: SYSTEM_ADMIN_ROLE_KEY }, select: { id: true } })
    check("role system_admin masih ada setelah percobaan", Boolean(stillThere), stillThere ? "ada" : "HILANG")
  }

  // --- 7. Hapus role bermember butuh niat eksplisit ---
  await prisma.user.create({
    data: {
      name: "Akun Verifikasi",
      email: `${TAG}-member@contoh.test`,
      passwordHash: "x".repeat(60),
      active: true,
      rbacRoles: { create: { roleId: createdRole.id } },
    },
    select: { id: true },
  })

  const fresh = await prisma.role.findUniqueOrThrow({
    where: { id: createdRole.id },
    select: { version: true },
  })
  const deleteBusy = await api(`/api/rbac/roles/${createdRole.id}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion: fresh.version }),
  })
  check("hapus role bermember ditolak 409", deleteBusy.status === 409, `HTTP ${deleteBusy.status}`)

  const deleteExplicit = await api(`/api/rbac/roles/${createdRole.id}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion: fresh.version, revokeFromAllMembers: true }),
  })
  check(
    "hapus role dengan niat eksplisit berhasil",
    deleteExplicit.status === 200,
    `HTTP ${deleteExplicit.status}`,
  )
  const orphan = await prisma.userRole.count({ where: { roleId: createdRole.id } })
  check("tidak ada keanggotaan yatim setelah penghapusan", orphan === 0, `${orphan} baris tersisa`)

  // --- 8. Audit tercatat ---
  const auditResponse = await api("/api/rbac/audit?pageSize=20")
  const audit = auditResponse.status === 200 ? await auditResponse.json() : { entries: [] }
  const actions = new Set<string>(audit.entries.map((entry: { action: string }) => entry.action))
  check("GET /api/rbac/audit dapat dibaca", auditResponse.status === 200, `HTTP ${auditResponse.status}`)
  check(
    "audit mencatat pembuatan dan penghapusan role",
    actions.has("RBAC_ROLE_CREATED") && actions.has("RBAC_ROLE_DELETED"),
    [...actions].filter((a) => a.startsWith("RBAC_")).join(", ") || "tidak ada aksi RBAC",
  )

  // --- 9. Race: dua pencabutan Admin Sistem terakhir secara bersamaan ---
  const adminRole = await prisma.role.findUnique({
    where: { key: SYSTEM_ADMIN_ROLE_KEY },
    select: { id: true },
  })

  if (adminRole) {
    // Populasi harus terkendali DAN aktor tetap dapat melakukan autentikasi.
    //
    // Percobaan pertama skrip ini menonaktifkan seluruh admin nyata termasuk
    // akun sesi, sehingga kedua permintaan mati dengan 401 dan pengujian
    // "lulus" tanpa pernah menyentuh invariant. Aktor karena itu DIKECUALIKAN
    // dari penonaktifan.
    //
    // Populasi akhir dibuat tepat dua: aktor dan satu admin uji. Balapannya
    // adalah dua permintaan bersamaan yang masing-masing mencabut salah satu
    // dari dua admin terakhir — persis kondisi yang harus ditahan kunci.
    const otherRealAdmins = await prisma.user.findMany({
      where: {
        active: true,
        id: { not: actorId },
        rbacRoles: { some: { roleId: adminRole.id } },
      },
      select: { id: true },
    })

    const peer = await prisma.user.create({
      data: {
        name: "Admin Uji A",
        email: `${TAG}-a@contoh.test`,
        passwordHash: "x".repeat(60),
        active: true,
        rbacRoles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    })

    await prisma.user.updateMany({
      where: { id: { in: otherRealAdmins.map((admin) => admin.id) } },
      data: { active: false },
    })

    try {
      const live = await prisma.user.count({
        where: { active: true, rbacRoles: { some: { roleId: adminRole.id } } },
      })
      check(
        "KONTROL: populasi uji tepat dua Admin Sistem aktif",
        live === 2,
        `${live} admin aktif`,
      )

      const revision = computeAssignmentRevision([adminRole.id])

      // Bersamaan: cabut admin rekan, dan cabut admin milik aktor sendiri.
      // Keduanya sah bila dijalankan sendirian; bersama-sama keduanya akan
      // menyisakan nol, jadi minimal satu harus gagal.
      const [first, second] = await Promise.all([
        api(`/api/rbac/users/${peer.id}/roles`, {
          method: "PUT",
          body: JSON.stringify({ roleIds: [], expectedRevision: revision }),
        }),
        api(`/api/rbac/users/${actorId}/roles`, {
          method: "PUT",
          body: JSON.stringify({ roleIds: [], expectedRevision: revision, confirmSelfRevoke: true }),
        }),
      ])

      const statuses = [first.status, second.status]
      const unauthorized = statuses.filter((status) => status === 401).length
      check(
        "KONTROL: tidak ada permintaan yang mati di autentikasi",
        unauthorized === 0,
        `status ${statuses.join(" , ")}`,
      )

      // CATATAN KEJUJURAN PENGUJIAN:
      // Asersi ini menegaskan invariant last-admin ditegakkan end-to-end lewat
      // HTTP. Ia BUKAN bukti bahwa advisory lock bekerja: ketika lock sengaja
      // dilumpuhkan, hasilnya tetap 200/409, karena dua permintaan fetch ke
      // server dev tidak menghasilkan transaksi yang benar-benar tumpang
      // tindih. Bukti lock yang diskriminatif ada di
      // tests/rbac-invariants.integration.test.ts, yang memakai dua koneksi
      // PostgreSQL terpisah plus barrier bertenggat, dan GAGAL (`ok,ok`,
      // nol admin tersisa) saat lock dicabut.
      const succeeded = statuses.filter((status) => status === 200).length
      check(
        "invariant last-admin ditegakkan lewat HTTP (bukan bukti lock)",
        succeeded <= 1,
        `status ${statuses.join(" , ")}`,
      )

      const remaining = await prisma.user.count({
        where: { active: true, rbacRoles: { some: { roleId: adminRole.id } } },
      })
      check("selalu tersisa Admin Sistem aktif", remaining >= 1, `${remaining} admin aktif tersisa`)
    } finally {
      // Pulihkan admin nyata, dan kembalikan role aktor bila sempat tercabut.
      await prisma.user.updateMany({
        where: { id: { in: otherRealAdmins.map((admin) => admin.id) } },
        data: { active: true },
      })
      const actorStillAdmin = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: actorId, roleId: adminRole.id } },
        select: { userId: true },
      })
      if (!actorStillAdmin) {
        await prisma.userRole.create({ data: { userId: actorId, roleId: adminRole.id } })
      }
    }
  }

  await cleanup()
  await prisma.$disconnect()

  const failed = results.filter((entry) => !entry.pass)
  console.log(`\n${results.length - failed.length}/${results.length} lolos`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error("Verifikasi gagal dijalankan:", error.message)
  await cleanup().catch(() => {})
  await prisma.$disconnect().catch(() => {})
  process.exit(2)
})
