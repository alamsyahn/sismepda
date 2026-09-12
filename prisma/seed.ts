import "dotenv/config"
import { hash } from "bcryptjs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, LegacyRole } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { workbookMasterData } from "../lib/workbook-master"
import { SYSTEM_ADMIN_ROLE_KEY } from "../lib/rbac-permissions"
import { seedRbac } from "./seed-rbac"

function requiredEnv(name: "DATABASE_URL" | "SEED_ADMIN_EMAIL" | "SEED_ADMIN_PASSWORD") {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} wajib dikonfigurasi`)
  return value
}

const databaseUrl = requiredEnv("DATABASE_URL").trim()
const adminEmail = requiredEnv("SEED_ADMIN_EMAIL").trim()
const adminPassword = requiredEnv("SEED_ADMIN_PASSWORD")
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: databaseSchema(databaseUrl) }),
})
const classNames = ["VII", "VIII", "IX"].flatMap((grade) =>
  ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((section) => `${grade} ${section}`),
)

async function main() {
  // Katalog + role dulu, supaya admin awal pada database segar langsung bisa
  // menjadi anggota system_admin.
  await seedRbac(prisma)
  await bootstrapInitialAdmin()
  for (const name of classNames) {
    await prisma.schoolClass.upsert({ where: { name }, update: {}, create: { name, grade: name.split(" ")[0] } })
  }
  await prisma.schoolSetting.upsert({ where: { id: "default" }, update: {}, create: {} })
  await seedWorkbooks()
}

/**
 * Admin awal hanya dibuat pada database yang BELUM punya akun sama sekali.
 *
 * Pada database yang sudah berisi akun, seed tidak menyentuh user mana pun:
 * tidak mereset password, tidak mengaktifkan akun nonaktif, dan tidak
 * mempromosikan akun yang kebetulan beremail SEED_ADMIN_EMAIL. Bila email
 * itu sudah dipakai akun lain di database berisi, seed gagal dengan pesan
 * jelas — bukan diam-diam melewati atau menimpa.
 *
 * Pada database segar, admin awal langsung menjadi anggota `system_admin`
 * (RBAC) sekaligus `role=ADMIN` (legacy) supaya kedua model konsisten sampai
 * kolom legacy dihapus.
 */
async function bootstrapInitialAdmin() {
  const userCount = await prisma.user.count()
  // Database berisi: tidak ada akun yang disentuh — bukan promosi, bukan
  // reset password, bukan pengaktifan. Pembuatan akun baru dilakukan lewat
  // pengelolaan akun, bukan seed deploy.
  if (userCount > 0) return

  const collision = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } })
  if (collision) {
    throw new Error(`SEED_ADMIN_EMAIL sudah dipakai akun ${collision.id}; bootstrap admin awal dibatalkan`)
  }

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      name: "Admin Sekolah",
      role: LegacyRole.ADMIN,
      isTeacher: true,
      passwordHash: await hash(adminPassword, 12),
    },
    select: { id: true },
  })
  const systemAdmin = await prisma.role.findUnique({ where: { key: SYSTEM_ADMIN_ROLE_KEY }, select: { id: true } })
  if (systemAdmin) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: systemAdmin.id } },
      update: {},
      create: { userId: admin.id, roleId: systemAdmin.id },
    })
  }
}

/** Idempotent: re-running keeps a single row per workbook and per item. */
async function seedWorkbooks() {
  for (const [index, entry] of workbookMasterData.entries()) {
    const workbook = await prisma.workbook.upsert({
      where: { number: entry.number },
      update: { name: entry.name, weight: entry.weight, sortOrder: index + 1 },
      create: { number: entry.number, name: entry.name, weight: entry.weight, sortOrder: index + 1 },
      select: { id: true },
    })

    for (const [itemIndex, name] of entry.items.entries()) {
      await prisma.workbookItem.upsert({
        where: { workbookId_sortOrder: { workbookId: workbook.id, sortOrder: itemIndex + 1 } },
        update: { name },
        create: { workbookId: workbook.id, name, sortOrder: itemIndex + 1 },
      })
    }

    // Jangan hapus item yang sudah tidak ada di master: item dapat memiliki
    // status supervisi buatan pengguna yang terhapus secara cascade.
  }

  // Workbook di luar master juga dipertahankan karena dapat memiliki tautan
  // dan status supervisi buatan pengguna. Seed hanya menginisialisasi/upsert.
}

main().finally(() => prisma.$disconnect())
