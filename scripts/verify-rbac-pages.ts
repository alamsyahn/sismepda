/**
 * Verifikasi gerbang halaman administrasi RBAC terhadap server dev yang hidup.
 *
 * Klaim yang diuji:
 *   1. /pengaturan/pengguna dan /pengaturan/akses terbuka bagi pemegang kewenangan RBAC;
 *   2. keduanya TERTUTUP bagi akun tanpa kewenangan itu;
 *   3. /pengaturan (pengaturan sekolah) tetap TERTUTUP bagi manajer RBAC murni —
 *      layout sengaja dilebarkan agar sub-rute dapat diakses, dan halaman
 *      pengaturan sekolah harus tetap dijaga guard-nya sendiri;
 *   4. nav hanya menampilkan tautan yang boleh diakses pemiliknya.
 *
 * Klaim 3 adalah alasan utama berkas ini ada: melebarkan guard layout tanpa
 * memasang guard pada halaman akan membocorkan pengaturan sekolah, dan tidak
 * ada test lain yang akan menangkapnya.
 *
 * Setiap klaim negatif didampingi KONTROL positif — tanpa itu, satu pengalihan
 * dini (mis. sesi gagal) membuat seluruh berkas lulus tanpa menguji apa pun.
 *
 * Data uji berawalan `page_verify` dan dibersihkan kembali.
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000"
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? process.env.DEV_TEST_USER_EMAIL
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? process.env.DEV_TEST_USER_PASSWORD

if (!adminEmail || !adminPassword) {
  console.error("Lewati: kredensial admin tidak tersedia di .env")
  process.exit(2)
}

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL },
  { schema: databaseSchema(process.env.DATABASE_URL!) },
)
const prisma = new PrismaClient({ adapter })

const TAG = "page_verify"
const results: { label: string; pass: boolean }[] = []

function check(label: string, pass: boolean, detail: string) {
  results.push({ label, pass })
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`)
}

/** Sesi terisolasi: tiap aktor punya toples cookie sendiri. */
function makeSession() {
  const jar = new Map<string, string>()
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")

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
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";")
      const index = pair.indexOf("=")
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
    return response
  }

  async function login(identifier: string, password: string) {
    const { csrfToken } = (await (await api("/api/auth/csrf")).json()) as { csrfToken: string }
    await api("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, identifier, password, callbackUrl: BASE }),
    })
    const session = await (await api("/api/auth/session")).json()
    if (!session?.user?.id) throw new Error(`login gagal untuk ${identifier}`)
    return session.user.id as string
  }

  return { api, login }
}

/**
 * Halaman dianggap dapat diakses bila server mengembalikan 200.
 * Guard menolak lewat pengalihan (3xx), jadi keduanya terbedakan jelas.
 */
async function visit(api: ReturnType<typeof makeSession>["api"], path: string) {
  const response = await api(path, { headers: { accept: "text/html" } })
  return { status: response.status, body: response.status === 200 ? await response.text() : "" }
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { nip: { startsWith: TAG } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetUserId: { in: ids } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.role.deleteMany({ where: { key: { startsWith: TAG } } })
}

async function main() {
  await cleanup()

  const password = "KataSandiUji#2026"
  const { hash } = await import("bcryptjs")
  const passwordHash = await hash(password, 10)

  // `permissions` adalah relasi ke baris `Permission`, bukan array string.
  const grantedKeys = [
    "rbac.roles.read",
    "rbac.roles.manage",
    "rbac.assignments.manage",
    "rbac.audit.read",
    "accounts.credentials.manage",
  ]
  const permissionRows = await prisma.permission.findMany({
    where: { key: { in: grantedKeys } },
    select: { id: true, key: true },
  })
  if (permissionRows.length !== grantedKeys.length) {
    throw new Error(
      `permission belum di-seed: ${grantedKeys
        .filter((key) => !permissionRows.some((row) => row.key === key))
        .join(", ")} — jalankan \`npx tsx --env-file=.env prisma/seed.ts\``,
    )
  }

  // Role yang HANYA memberi kewenangan RBAC — sengaja tanpa school.settings.read.
  const permissionId = (key: string) => permissionRows.find((row) => row.key === key)!.id
  const createTestRole = (suffix: string, name: string, keys: string[]) =>
    prisma.role.create({
      data: {
        key: `${TAG}_${suffix}`,
        name,
        description: "Role khusus verifikasi halaman",
        permissions: { create: keys.map((key) => ({ permissionId: permissionId(key) })) },
      },
      select: { id: true },
    })

  const rbacRole = await createTestRole("rbac", "Manajer Akses Uji", [
    "rbac.roles.read",
    "rbac.roles.manage",
    "rbac.assignments.manage",
  ])
  const accountRole = await createTestRole("account", "Pengelola Kredensial Uji", [
    "accounts.credentials.manage",
  ])
  const auditRole = await createTestRole("audit", "Pembaca Audit Uji", ["rbac.audit.read"])

  await prisma.user.create({
    data: {
      name: "Manajer Akses Uji",
      email: `${TAG}-manager@contoh.test`,
      nip: `${TAG}-manager`,
      passwordHash,
      active: true,
      isTeacher: true,
      rbacRoles: { create: { roleId: rbacRole.id } },
    },
    select: { id: true },
  })

  await prisma.user.createMany({
    data: [
      {
        name: "Guru Biasa Uji",
        email: `${TAG}-plain@contoh.test`,
        nip: `${TAG}-plain`,
        passwordHash,
        active: true,
        isTeacher: true,
      },
      {
        name: "Pengelola Kredensial Uji",
        email: `${TAG}-account@contoh.test`,
        nip: `${TAG}-account`,
        passwordHash,
        active: true,
        isTeacher: true,
      },
      {
        name: "Pembaca Audit Uji",
        email: `${TAG}-audit@contoh.test`,
        nip: `${TAG}-audit`,
        passwordHash,
        active: true,
        isTeacher: true,
      },
    ],
  })
  const scopedUsers = await prisma.user.findMany({
    where: { nip: { in: [`${TAG}-account`, `${TAG}-audit`] } },
    select: { id: true, nip: true },
  })
  await prisma.userRole.createMany({
    data: [
      { userId: scopedUsers.find((user) => user.nip === `${TAG}-account`)!.id, roleId: accountRole.id },
      { userId: scopedUsers.find((user) => user.nip === `${TAG}-audit`)!.id, roleId: auditRole.id },
    ],
  })

  // ---- Aktor 1: manajer RBAC murni ----
  const managerSession = makeSession()
  await managerSession.login(`${TAG}-manager`, password)

  const mgrAkses = await visit(managerSession.api, "/pengaturan/akses")
  check(
    "manajer RBAC dapat membuka /pengaturan/akses",
    mgrAkses.status === 200,
    `HTTP ${mgrAkses.status}`,
  )

  const mgrPengguna = await visit(managerSession.api, "/pengaturan/pengguna")
  check(
    "manajer RBAC dapat membuka /pengaturan/pengguna",
    mgrPengguna.status === 200,
    `HTTP ${mgrPengguna.status}`,
  )

  // Klaim inti: layout dilebarkan, tetapi halaman pengaturan sekolah tetap dijaga.
  const mgrPengaturan = await visit(managerSession.api, "/pengaturan")
  check(
    "manajer RBAC DITOLAK di /pengaturan (pengaturan sekolah)",
    mgrPengaturan.status !== 200,
    `HTTP ${mgrPengaturan.status} (200 berarti pelebaran layout membocorkan pengaturan sekolah)`,
  )

  // ---- Aktor 2: hanya accounts.credentials.manage ----
  const accountSession = makeSession()
  await accountSession.login(`${TAG}-account`, password)
  const accountPengguna = await visit(accountSession.api, "/pengaturan/pengguna")
  check(
    "pengelola kredensial lolos union layout ke /pengaturan/pengguna",
    accountPengguna.status === 200,
    `HTTP ${accountPengguna.status}`,
  )
  const accountAkses = await visit(accountSession.api, "/pengaturan/akses")
  check(
    "pengelola kredensial tetap ditolak di /pengaturan/akses",
    accountAkses.status !== 200,
    `HTTP ${accountAkses.status}`,
  )

  // ---- Aktor 3: hanya rbac.audit.read ----
  const auditSession = makeSession()
  await auditSession.login(`${TAG}-audit`, password)
  const auditPage = await visit(auditSession.api, "/pengaturan/audit")
  check("pembaca audit dapat membuka viewer audit", auditPage.status === 200, `HTTP ${auditPage.status}`)
  check(
    "nav pembaca audit memuat tautan viewer audit",
    auditPage.body.includes("/pengaturan/audit"),
    "href /pengaturan/audit hadir",
  )
  const auditAkses = await visit(auditSession.api, "/pengaturan/akses")
  check("pembaca audit ditolak di halaman role", auditAkses.status !== 200, `HTTP ${auditAkses.status}`)

  // ---- Aktor 4: guru tanpa kewenangan ----
  const plainSession = makeSession()
  await plainSession.login(`${TAG}-plain`, password)

  const plainAkses = await visit(plainSession.api, "/pengaturan/akses")
  check(
    "guru biasa DITOLAK di /pengaturan/akses",
    plainAkses.status !== 200,
    `HTTP ${plainAkses.status}`,
  )

  const plainPengguna = await visit(plainSession.api, "/pengaturan/pengguna")
  check(
    "guru biasa DITOLAK di /pengaturan/pengguna",
    plainPengguna.status !== 200,
    `HTTP ${plainPengguna.status}`,
  )

  // ---- Aktor 5: system admin (kontrol positif untuk /pengaturan) ----
  const adminSession = makeSession()
  await adminSession.login(adminEmail!, adminPassword!)

  const adminPengaturan = await visit(adminSession.api, "/pengaturan")
  check(
    "kontrol positif: admin tetap dapat membuka /pengaturan",
    adminPengaturan.status === 200,
    `HTTP ${adminPengaturan.status} (bila gagal, penolakan di atas tidak membuktikan apa pun)`,
  )

  const adminPengguna = await visit(adminSession.api, "/pengaturan/pengguna")
  check(
    "kontrol positif: admin dapat membuka /pengaturan/pengguna",
    adminPengguna.status === 200,
    `HTTP ${adminPengguna.status}`,
  )

  // ---- Nav hanya menampilkan tautan yang boleh diakses ----
  // Dicocokkan pada href, bukan judul: "Akses"/"Pengguna" terlalu umum dan
  // bisa muncul sebagai kata biasa di tempat lain pada markup.
  check(
    "nav guru biasa tidak memuat tautan administrasi RBAC",
    !plainAkses.body.includes("/pengaturan/akses"),
    "href /pengaturan/akses absen dari halaman guru biasa",
  )
  check(
    "kontrol positif: nav manajer memuat tautan /pengaturan/akses",
    mgrAkses.body.includes("/pengaturan/akses"),
    "href hadir bagi pemegang kewenangan",
  )
  check(
    "nav manajer RBAC tidak memuat tautan pengaturan sekolah",
    !/href="\/pengaturan"/.test(mgrAkses.body),
    "href /pengaturan persis absen bagi manajer RBAC murni",
  )

  await cleanup()

  const failed = results.filter((result) => !result.pass)
  console.log(`\n${results.length - failed.length}/${results.length} lolos`)
  if (failed.length > 0) process.exitCode = 1
}

main()
  .catch(async (error) => {
    console.error(error)
    await cleanup().catch(() => {})
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
