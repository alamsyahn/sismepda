/**
 * Verifikasi end-to-end endpoint profil sendiri terhadap server dev yang hidup.
 *
 * Membuktikan tiga hal yang tidak dapat dibuktikan unit test skema:
 *   1. Mutasi lintas origin ditolak 403 SEBELUM menyentuh database.
 *   2. Field otorisasi yang disuntikkan menghasilkan 400 (ditolak), bukan 200
 *      dengan field dibuang diam-diam.
 *   3. Payload sah tetap berhasil, dan hak akun TIDAK berubah karenanya.
 *
 * Kredensial dibaca dari .env dan tidak pernah dicetak.
 * Jalankan: npx tsx scripts/verify-profile-hardening.ts
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000"
const ORIGIN = BASE

const email = process.env.DEV_TEST_USER_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const password = process.env.DEV_TEST_USER_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

if (!email || !password) {
  console.error("Lewati: kredensial akun uji tidak tersedia di .env")
  process.exit(2)
}

/** Menyimpan cookie antar permintaan, meniru browser. */
const jar = new Map<string, string>()

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
}

function absorb(response: Response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";")
    const index = pair.indexOf("=")
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
  })
  absorb(response)
  return response
}

async function login() {
  const csrfResponse = await request("/api/auth/csrf")
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const body = new URLSearchParams({
    csrfToken,
    // Provider kredensial proyek memakai `identifier` (email ATAU NIP),
    // bukan `email`.
    identifier: email!,
    password: password!,
    callbackUrl: BASE,
  })

  const response = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
    body,
  })

  const session = await (await request("/api/auth/session")).json()
  if (!session?.user?.id) {
    throw new Error(`login gagal (HTTP ${response.status}); periksa kredensial di .env`)
  }
  return session.user.id as string
}

const results: { label: string; pass: boolean; detail: string }[] = []
function check(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail })
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`)
}

async function main() {
  const userId = await login()
  console.log("Sesi terautentikasi diperoleh.\n")

  const adapter = new PrismaPg(
    { connectionString: process.env.DATABASE_URL },
    { schema: databaseSchema(process.env.DATABASE_URL!) },
  )
  const prisma = new PrismaClient({ adapter })

  const snapshot = async () =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        active: true,
        isTeacher: true,
        name: true,
        rbacRoles: { select: { roleId: true } },
      },
    })

  const before = await snapshot()

  // 1. Lintas origin harus ditolak.
  const crossOrigin = await request("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://evil.example.com" },
    body: JSON.stringify({ name: "Penyerang", nip: "", email: "", phone: "" }),
  })
  check("mutasi lintas origin ditolak", crossOrigin.status === 403, `HTTP ${crossOrigin.status}`)

  // 2. Tanpa header Origin sama sekali.
  const noOrigin = await request("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Penyerang", nip: "", email: "", phone: "" }),
  })
  check("mutasi tanpa header Origin ditolak", noOrigin.status === 403, `HTTP ${noOrigin.status}`)

  // 3. Setiap field otorisasi yang disuntikkan harus DITOLAK.
  //
  // PENTING: payload dasar harus SAH SEPENUHNYA, termasuk mengisi NIP/email.
  // Bila keduanya dikosongkan, handler menolak lebih dulu dengan
  // IDENTIFIER_REQUIRED (400) dan pengujian menjadi vacuous — ia akan "lulus"
  // bahkan ketika proteksi mass-assignment dicabut.
  const identity = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, nip: true, email: true, phone: true },
  })

  const baseline = {
    name: identity.name,
    nip: identity.nip ?? "",
    email: identity.email ?? "",
    phone: identity.phone ?? "",
  }

  // Kontrol: payload dasar tanpa suntikan HARUS berhasil. Bila ini gagal,
  // seluruh pengujian suntikan di bawahnya tidak bermakna.
  const control = await request("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(baseline),
  })
  check(
    "KONTROL: payload sah diterima (menjamin uji suntikan tidak vacuous)",
    control.status === 200,
    `HTTP ${control.status}`,
  )

  const injections: Record<string, unknown>[] = [
    { active: false },
    { isTeacher: true },
    { role: "ADMIN" },
    { roles: ["system_admin"] },
    { roleIds: ["whatever"] },
    { permissions: ["rbac.roles.manage"] },
    { canManageTeacherProfiles: true },
    { passwordHash: "x" },
  ]

  for (const injection of injections) {
    const field = Object.keys(injection)[0]
    const response = await request("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ ...baseline, ...injection }),
    })
    check(`suntikan "${field}" ditolak`, response.status === 400, `HTTP ${response.status}`)
  }

  // 4. Hak akun tidak berubah sedikit pun.
  const after = await snapshot()
  check(
    "status aktif tidak berubah",
    after.active === before.active,
    `${before.active} -> ${after.active}`,
  )
  check(
    "penanda guru tidak berubah",
    after.isTeacher === before.isTeacher,
    `${before.isTeacher} -> ${after.isTeacher}`,
  )
  check(
    "keanggotaan role tidak berubah",
    after.rbacRoles.length === before.rbacRoles.length,
    `${before.rbacRoles.length} -> ${after.rbacRoles.length} role`,
  )

  await prisma.$disconnect()

  const failed = results.filter((entry) => !entry.pass)
  console.log(`\n${results.length - failed.length}/${results.length} lolos`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("Verifikasi gagal dijalankan:", error.message)
  process.exit(2)
})
