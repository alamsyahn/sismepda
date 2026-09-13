/**
 * Integrasi invariant Admin Sistem terhadap database nyata.
 *
 * Membuktikan hal yang tidak bisa dibuktikan fungsi murni: dua permintaan
 * BERSAMAAN yang masing-masing mencoba menghabisi Admin Sistem terakhir tidak
 * bisa keduanya berhasil. Pemeriksaan murni saja akan lolos dua-duanya karena
 * keduanya membaca kondisi lama.
 *
 * Dilewati otomatis bila DATABASE_URL tidak tersedia.
 * Semua data uji berawalan `inv-it-` dan dibersihkan kembali.
 */
import "dotenv/config"
import { strict as assert } from "node:assert"
import { after, before, describe, test } from "node:test"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import {
  InvariantViolationError,
  assertSystemAdminPopulationIntact,
  lockSystemAdminPopulation,
} from "../lib/rbac-invariants-db"

const databaseUrl = process.env.DATABASE_URL
const enabled = Boolean(databaseUrl)

describe("invariant Admin Sistem (database nyata)", { skip: enabled ? false : "DATABASE_URL tidak tersedia" }, () => {
  let prisma: PrismaClient
  const tag = `inv-it-${Date.now()}`
  const ids = { adminRole: "", userA: "", userB: "" }

  function newClient(): PrismaClient {
    const adapter = new PrismaPg(
      { connectionString: databaseUrl },
      { schema: databaseSchema(databaseUrl!) },
    )
    return new PrismaClient({ adapter })
  }

  /**
   * Menyiapkan populasi admin yang terkendali: A dan B aktif sebagai anggota
   * `system_admin`, seluruh admin ASLI dinonaktifkan sementara.
   *
   * Mengembalikan id admin asli supaya `restoreRealAdmins` bisa memulihkannya.
   */
  async function isolateTestAdmins(): Promise<string[]> {
    const realAdmins = await prisma.userRole.findMany({
      where: { roleId: ids.adminRole, user: { active: true } },
      select: { userId: true },
    })
    const realIds = realAdmins
      .map((row) => row.userId)
      .filter((id) => id !== ids.userA && id !== ids.userB)

    await prisma.userRole.createMany({
      data: [
        { userId: ids.userA, roleId: ids.adminRole },
        { userId: ids.userB, roleId: ids.adminRole },
      ],
      skipDuplicates: true,
    })
    await prisma.user.updateMany({
      where: { id: { in: [ids.userA, ids.userB] } },
      data: { active: true },
    })
    await prisma.user.updateMany({ where: { id: { in: realIds } }, data: { active: false } })

    return realIds
  }

  async function restoreRealAdmins(realIds: readonly string[]): Promise<void> {
    await prisma.user.updateMany({ where: { id: { in: [...realIds] } }, data: { active: true } })
  }

  before(async () => {
    const adapter = new PrismaPg(
      { connectionString: databaseUrl },
      { schema: databaseSchema(databaseUrl!) },
    )
    prisma = new PrismaClient({ adapter })

    // Role uji memakai key `system_admin` palsu tidak mungkin — key itu unik
    // dan sudah dipakai role asli. Karena `findRemainingActiveSystemAdmins`
    // mencari berdasarkan key `system_admin`, uji ini memakai role ASLI dan
    // menambahkan dua akun uji sebagai anggotanya, lalu membersihkannya.
    const role = await prisma.role.findUnique({
      where: { key: "system_admin" },
      select: { id: true },
    })
    assert.ok(role, "role system_admin harus ada; jalankan seed RBAC lebih dulu")
    ids.adminRole = role.id

    const userA = await prisma.user.create({
      data: { name: `${tag}-a`, nip: `${tag}-a`, passwordHash: "x", active: true },
      select: { id: true },
    })
    const userB = await prisma.user.create({
      data: { name: `${tag}-b`, nip: `${tag}-b`, passwordHash: "x", active: true },
      select: { id: true },
    })
    ids.userA = userA.id
    ids.userB = userB.id
  })

  after(async () => {
    if (!prisma) return
    await prisma.userRole.deleteMany({ where: { userId: { in: [ids.userA, ids.userB] } } })
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } })
    await prisma.$disconnect()
  })

  /**
   * Menonaktifkan satu akun admin dengan pola transaksi yang sama seperti
   * route handler: kunci → tulis → verifikasi.
   *
   * `rendezvous` (opsional) dipanggil setelah penulisan dan sebelum verifikasi.
   * Ia dipakai uji balapan untuk MEMAKSA kedua transaksi sama-sama sudah
   * menulis sebelum salah satunya memeriksa — tanpa itu, penjadwalan kebetulan
   * membuat uji lolos bahkan bila kunci dihapus (uji yang vacuous).
   */
  async function deactivate(
    client: PrismaClient,
    userId: string,
    rendezvous?: () => Promise<void>,
  ): Promise<"ok" | "blocked"> {
    try {
      await client.$transaction(async (tx) => {
        await lockSystemAdminPopulation(tx)
        await tx.user.update({ where: { id: userId }, data: { active: false } })
        if (rendezvous) await rendezvous()
        await assertSystemAdminPopulationIntact(tx, { actorId: "tester", targetId: userId })
      })
      return "ok"
    } catch (error) {
      if (error instanceof InvariantViolationError) return "blocked"
      throw error
    }
  }

  /**
   * Barrier dengan batas waktu: menunggu sampai `n` peserta tiba, ATAU sampai
   * tenggat lewat.
   *
   * Batas waktu itu wajib. Ketika advisory lock bekerja, transaksi kedua masih
   * tertahan menunggu kunci dan tidak akan pernah tiba di barrier — barrier
   * tanpa tenggat akan saling menunggu selamanya.
   */
  function rendezvousGate(participants: number, timeoutMs = 750) {
    let arrived = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const timer = setTimeout(() => release(), timeoutMs)
    timer.unref?.()

    return async () => {
      arrived += 1
      if (arrived >= participants) {
        clearTimeout(timer)
        release()
      }
      await gate
    }
  }

  test("menonaktifkan admin non-terakhir diizinkan, admin terakhir ditolak", async () => {
    const realIds = await isolateTestAdmins()

    try {
      assert.equal(await deactivate(prisma, ids.userA), "ok")
      // Kini hanya B yang tersisa: menonaktifkan B harus ditolak.
      assert.equal(await deactivate(prisma, ids.userB), "blocked")
      const b = await prisma.user.findUniqueOrThrow({
        where: { id: ids.userB },
        select: { active: true },
      })
      assert.equal(b.active, true, "rollback harus mengembalikan status aktif")
    } finally {
      await restoreRealAdmins(realIds)
    }
  })

  test("dua penonaktifan bersamaan menyisakan minimal satu admin aktif", async () => {
    const realIds = await isolateTestAdmins()

    // Dua koneksi terpisah: satu PrismaClient menjalankan transaksi secara
    // berurutan pada koneksi yang sama, sehingga tidak pernah benar-benar
    // tumpang tindih dan ujinya kehilangan daya diskriminasi.
    const clientA = newClient()
    const clientB = newClient()
    const gate = rendezvousGate(2)

    try {
      const results = await Promise.all([
        deactivate(clientA, ids.userA, gate),
        deactivate(clientB, ids.userB, gate),
      ])

      const blocked = results.filter((result) => result === "blocked").length
      assert.ok(blocked >= 1, `minimal satu harus gagal, hasil: ${results.join(",")}`)

      const active = await prisma.user.count({
        where: { id: { in: [ids.userA, ids.userB] }, active: true },
      })
      assert.ok(active >= 1, "harus tersisa minimal satu Admin Sistem aktif")
    } finally {
      await clientA.$disconnect()
      await clientB.$disconnect()
      await restoreRealAdmins(realIds)
    }
  })
})
