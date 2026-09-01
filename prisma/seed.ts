import "dotenv/config"
import { hash } from "bcryptjs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, Role } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { workbookMasterData } from "../lib/workbook-master"

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
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Admin Sekolah",
      role: Role.ADMIN,
      passwordHash: await hash(adminPassword, 12),
    },
  })
  for (const name of classNames) {
    await prisma.schoolClass.upsert({ where: { name }, update: {}, create: { name, grade: name.split(" ")[0] } })
  }
  await prisma.schoolSetting.upsert({ where: { id: "default" }, update: {}, create: {} })
  await seedWorkbooks()
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
