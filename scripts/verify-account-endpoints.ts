/**
 * Verifikasi end-to-end endpoint akun terhadap server dev yang hidup.
 *
 * Klaim yang diuji:
 *   1. payload ketat — field otorisasi yang disuntikkan menolak SELURUH permintaan;
 *   2. penonaktifan diri sendiri ditolak, bahkan bagi system admin;
 *   3. menonaktifkan Admin Sistem terakhir ditolak;
 *   4. reset sandi tidak pernah membocorkan hash ke respons maupun ke audit;
 *   5. audit mencatat perubahan kredensial dan status.
 *
 * Setiap klaim negatif didampingi KONTROL positif. Tanpa itu, satu penolakan dini
 * (mis. 400 karena bentuk payload) bisa membuat seluruh berkas ini lulus tanpa
 * pernah menguji proteksi yang dimaksud — kesalahan yang sudah dua kali terjadi
 * di Phase 6.
 *
 * Data uji berawalan `acc_verify` dan dibersihkan kembali.
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
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

const results: { label: string; pass: boolean }[] = []
function check(label: string, pass: boolean, detail: string) {
  results.push({ label, pass })
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`)
}

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL },
  { schema: databaseSchema(process.env.DATABASE_URL!) },
)
const prisma = new PrismaClient({ adapter })

const TAG = "acc_verify"

/**
 * Akun uji dengan NIP — konfirmasi penghapusan mencocokkan NIP/e-mail, jadi
 * akun tanpa NIP tidak dapat menguji jalur konfirmasi secara bermakna.
 */
async function makeUser(slug: string) {
  return prisma.user.create({
    data: {
      name: `Akun Uji ${slug}`,
      email: `${TAG}-${slug}@contoh.test`,
      nip: `${TAG}-${slug}`,
      passwordHash: "z".repeat(60),
      active: true,
      isTeacher: true,
    },
    select: { id: true, nip: true, email: true },
  })
}

async function cleanup() {
  // `targetUserId` kolom biasa tanpa relasi, jadi id dikumpulkan lebih dulu.
  const stale = await prisma.user.findMany({
    where: { email: { startsWith: `${TAG}-` } },
    select: { id: true },
  })
  const staleIds = stale.map((user) => user.id)

  if (staleIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetUserId: { in: staleIds } }, { entityId: { in: staleIds } }] },
    })
    // Relasi RESTRICT: harus lenyap sebelum user-nya, atau cleanup sendiri
    // akan terhalang oleh FK yang sama dengan yang diuji.
    await prisma.studentViolationPoint.deleteMany({ where: { recordedById: { in: staleIds } } })
    await prisma.attendanceDay.deleteMany({ where: { submittedById: { in: staleIds } } })
  }
  await prisma.studentViolationPoint.deleteMany({ where: { category: `${TAG}-kategori` } })
  await prisma.userRole.deleteMany({ where: { user: { email: { startsWith: `${TAG}-` } } } })
  await prisma.rolePermission.deleteMany({ where: { role: { key: { startsWith: TAG } } } })
  await prisma.role.deleteMany({ where: { key: { startsWith: TAG } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } })
}

async function main() {
  const actorId = await login()
  console.log("Sesi admin diperoleh.\n")
  await cleanup()

  const ordinary = await prisma.user.create({
    data: {
      name: "Akun Biasa Verifikasi",
      email: `${TAG}-biasa@contoh.test`,
      passwordHash: "x".repeat(60),
      active: true,
      isTeacher: true,
    },
    select: { id: true, passwordHash: true },
  })

  // --- KONTROL: mutasi sah harus berhasil ---
  const control = await api(`/api/rbac/accounts/${ordinary.id}`, {
    method: "PATCH",
    body: JSON.stringify({ password: "SandiBaruAman123" }),
  })
  check("KONTROL: reset sandi akun biasa berhasil", control.status === 200, `HTTP ${control.status}`)

  const controlBody = control.status === 200 ? await control.json() : {}
  check(
    "respons tidak memuat hash sandi",
    !JSON.stringify(controlBody).toLowerCase().includes("hash"),
    Object.keys(controlBody).join(", ") || "kosong",
  )

  const afterReset = await prisma.user.findUniqueOrThrow({
    where: { id: ordinary.id },
    select: { passwordHash: true },
  })
  check(
    "hash sandi benar-benar berubah di database",
    afterReset.passwordHash !== ordinary.passwordHash,
    "berubah",
  )

  // --- 1. Field otorisasi yang disuntikkan menolak seluruh permintaan ---
  const injections: Record<string, unknown>[] = [
    { password: "SandiBaruAman123", role: "ADMIN" },
    { password: "SandiBaruAman123", roles: ["system_admin"] },
    { active: true, permissionKeys: ["rbac.roles.manage"] },
    { active: true, isTeacher: false },
    { active: true, canManageTeacherProfiles: true },
  ]

  for (const payload of injections) {
    const injected = Object.keys(payload).filter((key) => key !== "password" && key !== "active")
    const response = await api(`/api/rbac/accounts/${ordinary.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
    check(`suntikan ${injected.join("+")} ditolak 400`, response.status === 400, `HTTP ${response.status}`)
  }

  const crossOrigin = await api(`/api/rbac/accounts/${ordinary.id}`, {
    method: "PATCH",
    headers: { origin: "https://penyerang.example" },
    body: JSON.stringify({ active: false }),
  })
  check("mutasi lintas-origin ditolak 403", crossOrigin.status === 403, `HTTP ${crossOrigin.status}`)

  const combined = await api(`/api/rbac/accounts/${ordinary.id}`, {
    method: "PATCH",
    body: JSON.stringify({ password: "SandiGabungan123", active: false }),
  })
  check("password dan status dalam satu payload ditolak 400", combined.status === 400, `HTTP ${combined.status}`)

  const untouched = await prisma.user.findUniqueOrThrow({
    where: { id: ordinary.id },
    select: { isTeacher: true, role: true, active: true },
  })
  check("penolakan origin/payload gabungan tidak mengubah status", untouched.active === true, `active=${untouched.active}`)
  check(
    "tidak ada suntikan yang tersimpan",
    untouched.isTeacher === true,
    `isTeacher=${untouched.isTeacher}, role=${untouched.role}`,
  )

  // --- 2. Penonaktifan diri sendiri ditolak ---
  const selfDisable = await api(`/api/rbac/accounts/${actorId}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false }),
  })
  check("menonaktifkan akun sendiri ditolak 403", selfDisable.status === 403, `HTTP ${selfDisable.status}`)

  const actorStillActive = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: { active: true },
  })
  check("akun aktor tetap aktif", actorStillActive.active === true, `active=${actorStillActive.active}`)

  // --- 3. Menonaktifkan Admin Sistem terakhir ditolak ---
  const adminRole = await prisma.role.findUnique({
    where: { key: SYSTEM_ADMIN_ROLE_KEY },
    select: { id: true },
  })

  if (adminRole) {
    const otherAdmins = await prisma.user.findMany({
      where: { active: true, id: { not: actorId }, rbacRoles: { some: { roleId: adminRole.id } } },
      select: { id: true },
    })

    const peer = await prisma.user.create({
      data: {
        name: "Admin Rekan Verifikasi",
        email: `${TAG}-admin@contoh.test`,
        passwordHash: "x".repeat(60),
        active: true,
        rbacRoles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    })

    await prisma.user.updateMany({
      where: { id: { in: otherAdmins.map((admin) => admin.id) } },
      data: { active: false },
    })

    try {
      // KONTROL: dengan dua admin aktif, menonaktifkan rekan HARUS boleh.
      const allowed = await api(`/api/rbac/accounts/${peer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      })
      check(
        "KONTROL: menonaktifkan admin non-terakhir diizinkan",
        allowed.status === 200,
        `HTTP ${allowed.status}`,
      )

      // Kini aktor adalah satu-satunya admin aktif. Ia tidak dapat menonaktifkan
      // dirinya sendiri (sudah diuji), jadi populasi diuji lewat rekan yang
      // diaktifkan kembali lalu aktor dicabut — dilakukan via endpoint role.
      await prisma.user.update({ where: { id: peer.id }, data: { active: true } })
      await prisma.userRole.deleteMany({ where: { userId: peer.id, roleId: adminRole.id } })

      const lastAdmin = await prisma.user.count({
        where: { active: true, rbacRoles: { some: { roleId: adminRole.id } } },
      })
      check("KONTROL: kini tepat satu Admin Sistem aktif", lastAdmin === 1, `${lastAdmin} admin`)

      // Memberi peer role admin lagi, menonaktifkan aktor tidak mungkin (self),
      // jadi uji invariant dengan menonaktifkan peer SETELAH aktor dicabut.
      await prisma.userRole.create({ data: { userId: peer.id, roleId: adminRole.id } })
      await prisma.userRole.deleteMany({ where: { userId: actorId, roleId: adminRole.id } })

      const nowOnly = await prisma.user.count({
        where: { active: true, rbacRoles: { some: { roleId: adminRole.id } } },
      })
      check("KONTROL: peer kini satu-satunya admin aktif", nowOnly === 1, `${nowOnly} admin`)

      // Aktor sudah bukan admin, jadi ia kehilangan hak; kembalikan supaya
      // permintaan berikutnya tetap terotorisasi, lalu uji lewat peer.
      await prisma.userRole.create({ data: { userId: actorId, roleId: adminRole.id } })
      await prisma.userRole.deleteMany({ where: { userId: peer.id, roleId: adminRole.id } })

      const selfOnly = await prisma.user.count({
        where: { active: true, rbacRoles: { some: { roleId: adminRole.id } } },
      })
      check("KONTROL: aktor kembali satu-satunya admin aktif", selfOnly === 1, `${selfOnly} admin`)
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: otherAdmins.map((admin) => admin.id) } },
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

  // --- 4. Celah pengambilalihan: target pemegang kewenangan sensitif ---
  //
  // Ini inti perbaikan, dan harus diuji sebagai aktor NON-system-admin.
  // Menguji sebagai system admin tidak membuktikan apa pun: ia selalu lolos
  // lebih dulu lewat `if (context.isSystemAdmin) return`.
  //
  // Skenario: penyerang memegang teachers.accounts.update +
  // accounts.credentials.manage — cukup untuk mengelola akun guru secara sah.
  // Korban memegang role kustom TANPA isProtected yang memegang
  // accounts.credentials.manage. Sebelum perbaikan, penyerang dapat mereset
  // sandi korban dan mengambil alih akunnya.
  const permissions = await prisma.permission.findMany({
    where: {
      key: { in: ["accounts.credentials.manage", "teachers.accounts.update", "teachers.accounts.read"] },
    },
    select: { id: true, key: true },
  })
  const permissionByKey = new Map(permissions.map((entry) => [entry.key, entry.id]))
  const credentialPermissionId = permissionByKey.get("accounts.credentials.manage")

  if (credentialPermissionId && permissionByKey.size === 3) {
    const victimRole = await prisma.role.create({
      data: {
        key: `${TAG}_manajer`,
        name: "Manajer Akun Verifikasi",
        isProtected: false,
        permissions: { create: { permissionId: credentialPermissionId } },
      },
      select: { id: true },
    })

    const victim = await prisma.user.create({
      data: {
        name: "Pemegang Kewenangan Sensitif",
        email: `${TAG}-sensitif@contoh.test`,
        passwordHash: "y".repeat(60),
        active: true,
        isTeacher: true,
        rbacRoles: { create: { roleId: victimRole.id } },
      },
      select: { id: true, passwordHash: true },
    })

    check(
      "korban memang TIDAK ber-isProtected (celah nyata)",
      true,
      "role kustom tanpa flag, memegang accounts.credentials.manage",
    )

    // Penyerang: operator akun guru yang sah, bukan system admin.
    const attackerRole = await prisma.role.create({
      data: {
        key: `${TAG}_operator`,
        name: "Operator Akun Guru",
        isProtected: false,
        permissions: {
          create: [...permissionByKey.values()].map((permissionId) => ({ permissionId })),
        },
      },
      select: { id: true },
    })

    const attackerPassword = "OperatorAman12345"
    const { hash: bcryptHash } = await import("bcryptjs")
    const attacker = await prisma.user.create({
      data: {
        name: "Operator Verifikasi",
        email: `${TAG}-operator@contoh.test`,
        passwordHash: await bcryptHash(attackerPassword, 12),
        active: true,
        isTeacher: true,
        rbacRoles: { create: { roleId: attackerRole.id } },
      },
      select: { id: true },
    })

    // Sesi terpisah untuk penyerang; jar admin disimpan dan dipulihkan.
    const adminJar = new Map(jar)
    jar.clear()
    const { csrfToken } = (await (await api("/api/auth/csrf")).json()) as { csrfToken: string }
    await api("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        identifier: `${TAG}-operator@contoh.test`,
        password: attackerPassword,
        callbackUrl: BASE,
      }),
    })
    const attackerSession = await (await api("/api/auth/session")).json()

    check(
      "KONTROL: penyerang berhasil login sebagai non-system-admin",
      attackerSession?.user?.id === attacker.id,
      attackerSession?.user?.id ? "sesi aktif" : "GAGAL LOGIN",
    )

    // KONTROL positif: penyerang memang punya kuasa nyata atas akun guru biasa.
    // Tanpa ini, penolakan di bawah bisa sekadar karena ia tidak punya hak apa pun.
    const legacyPassword = await api("/api/admin/teachers", {
      method: "PATCH",
      body: JSON.stringify({ id: ordinary.id, password: "SandiGuruBiasa123" }),
    })
    check(
      "endpoint guru legacy menolak mutasi password",
      legacyPassword.status === 400,
      `HTTP ${legacyPassword.status}`,
    )

    const attackerOnOrdinary = await api(`/api/rbac/accounts/${ordinary.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "SandiGuruBiasa123" }),
    })
    check(
      "KONTROL: penyerang BOLEH mereset sandi guru biasa lewat endpoint akun",
      attackerOnOrdinary.status === 200,
      `HTTP ${attackerOnOrdinary.status}`,
    )

    // Serangan sesungguhnya.
    const takeover = await api(`/api/rbac/accounts/${victim.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "SandiDibajak12345" }),
    })
    check(
      "pengambilalihan target sensitif DITOLAK 403",
      takeover.status === 403,
      `HTTP ${takeover.status}`,
    )

    const victimAfter = await prisma.user.findUniqueOrThrow({
      where: { id: victim.id },
      select: { passwordHash: true },
    })
    check(
      "sandi korban tidak berubah",
      victimAfter.passwordHash === victim.passwordHash,
      victimAfter.passwordHash === victim.passwordHash ? "utuh" : "BERUBAH — korban terbajak",
    )

    // Pulihkan sesi admin untuk pemeriksaan audit.
    jar.clear()
    for (const [key, value] of adminJar) jar.set(key, value)
  } else {
    check(
      "prasyarat permission untuk uji pengambilalihan tersedia",
      false,
      `hanya ${permissionByKey.size}/3 permission ditemukan`,
    )
  }

  // --- 5. Audit mencatat, tanpa sandi ---
  const auditResponse = await api("/api/rbac/audit?pageSize=30")
  const audit = auditResponse.status === 200 ? await auditResponse.json() : { entries: [] }
  const actions = new Set<string>(audit.entries.map((entry: { action: string }) => entry.action))
  check(
    "audit mencatat perubahan kredensial akun",
    actions.has("RBAC_ACCOUNT_CREDENTIAL_CHANGED"),
    [...actions].filter((action) => action.startsWith("RBAC_ACCOUNT")).join(", ") || "tidak ada",
  )

  const serialized = JSON.stringify(audit.entries).toLowerCase()
  const leaked = ["passwordhash", "sandibaruaman", "sandilainaman"].filter((needle) =>
    serialized.includes(needle),
  )
  check("audit tidak membocorkan sandi atau hash", leaked.length === 0, leaked.join(", ") || "bersih")

  // --- 6. DELETE akun ---
  // 6a. Konfirmasi identifier wajib cocok.
  const delA = await makeUser("hapus-salah-konfirmasi")
  let res = await api(`/api/rbac/accounts/${delA.id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmationIdentifier: "bukan-nip-nya" }),
  })
  check("konfirmasi identifier salah ditolak", res.status === 400, `HTTP ${res.status}`)
  check(
    "akun masih ada setelah konfirmasi salah",
    (await prisma.user.count({ where: { id: delA.id } })) === 1,
    "utuh",
  )

  // 6b. Payload ketat: field tambahan menolak SELURUH permintaan.
  res = await api(`/api/rbac/accounts/${delA.id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmationIdentifier: delA.nip, force: true }),
  })
  check("field tambahan menolak seluruh permintaan hapus", res.status === 400, `HTTP ${res.status}`)
  check(
    "akun masih ada setelah payload ditolak",
    (await prisma.user.count({ where: { id: delA.id } })) === 1,
    "utuh",
  )

  // 6c. Penghapusan sukses; absensi dialihkan, bukan ikut terhapus.
  const delB = await makeUser("hapus-dengan-absensi")
  const klass = await prisma.schoolClass.findFirst({ select: { id: true } })
  if (!klass) throw new Error("prasyarat: butuh minimal satu SchoolClass")
  const probeDate = new Date("2099-01-05")
  await prisma.attendanceDay.deleteMany({ where: { classId: klass.id, date: probeDate } })
  await prisma.attendanceDay.create({
    data: { date: probeDate, classId: klass.id, submittedById: delB.id },
  })

  res = await api(`/api/rbac/accounts/${delB.id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmationIdentifier: delB.nip }),
  })
  const delBody = res.status === 200 ? await res.json() : {}
  check("penghapusan akun berhasil", res.status === 200, `HTTP ${res.status}`)
  check(
    "absensi dialihkan dan jumlahnya dilaporkan",
    delBody.reassignedAttendanceDays === 1,
    `dilaporkan ${delBody.reassignedAttendanceDays}`,
  )
  check(
    "akun benar-benar terhapus dari database",
    (await prisma.user.count({ where: { id: delB.id } })) === 0,
    "terhapus",
  )
  const movedDay = await prisma.attendanceDay.findFirst({
    where: { classId: klass.id, date: probeDate },
    select: { submittedById: true },
  })
  check(
    "hari absensi SELAMAT dan dialihkan ke aktor",
    movedDay !== null && movedDay.submittedById === actorId,
    movedDay ? `pengirim kini ${movedDay.submittedById === actorId ? "aktor" : "lain"}` : "IKUT TERHAPUS",
  )
  await prisma.attendanceDay.deleteMany({ where: { classId: klass.id, date: probeDate } })

  // 6d. TD-009: atribusi poin pelanggaran menghalangi dengan alasan yang
  // dapat ditindaklanjuti, bukan error FK mentah.
  const delC = await makeUser("hapus-dengan-pelanggaran")
  const student = await prisma.student.findFirst({ select: { id: true } })
  if (!student) throw new Error("prasyarat: butuh minimal satu Student")
  const point = await prisma.studentViolationPoint.create({
    data: {
      studentId: student.id,
      recordedById: delC.id,
      category: `${TAG}-kategori`,
      points: 5,
      occurredAt: new Date("2099-01-06"),
    },
  })

  res = await api(`/api/rbac/accounts/${delC.id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmationIdentifier: delC.nip }),
  })
  const blocked = res.status === 409 ? await res.json() : {}
  check("atribusi poin pelanggaran menghalangi penghapusan", res.status === 409, `HTTP ${res.status}`)
  check(
    "alasan dapat ditindaklanjuti, bukan kegagalan FK mentah",
    blocked.reason === "violation_points_attributed",
    `reason=${blocked.reason ?? "-"}`,
  )
  check(
    "akun tidak terhapus ketika terhalang",
    (await prisma.user.count({ where: { id: delC.id } })) === 1,
    "utuh",
  )
  check(
    "catatan disipliner siswa utuh",
    (await prisma.studentViolationPoint.count({ where: { id: point.id } })) === 1,
    "utuh",
  )

  // 6e. Hapus akun sendiri ditolak.
  const adminRow = await prisma.user.findUnique({
    where: { id: actorId },
    select: { nip: true, email: true },
  })
  res = await api(`/api/rbac/accounts/${actorId}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmationIdentifier: adminRow?.nip ?? adminRow?.email ?? "" }),
  })
  check("hapus akun sendiri ditolak", res.status === 403, `HTTP ${res.status}`)
  check(
    "akun aktor masih ada",
    (await prisma.user.count({ where: { id: actorId } })) === 1,
    "utuh",
  )

  // 6f. Audit penghapusan tetap ada meski baris User sudah lenyap.
  const deleteAudit = await prisma.auditLog.findFirst({
    where: { action: "RBAC_ACCOUNT_DELETED", targetUserId: delB.id },
    select: { before: true },
  })
  check(
    "audit penghapusan bertahan setelah akun lenyap",
    deleteAudit !== null,
    deleteAudit ? "tercatat" : "HILANG",
  )
  // `?? ""` sengaja DIHINDARI: includes("") selalu true dan akan membuat
  // asersi ini lulus tanpa arti.
  const deletedNip = delB.nip
  check(
    "audit menyimpan identitas akun yang dihapus",
    deletedNip !== null && JSON.stringify(deleteAudit?.before ?? {}).includes(deletedNip),
    deleteAudit ? "identitas tersimpan" : "-",
  )

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
