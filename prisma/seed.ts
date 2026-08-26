import "dotenv/config"
import { hash } from "bcryptjs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, Role } from "../app/generated/prisma/client"

function requiredEnv(name: "DATABASE_URL" | "SEED_ADMIN_EMAIL" | "SEED_ADMIN_PASSWORD") {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} wajib dikonfigurasi`)
  return value
}

const databaseUrl = requiredEnv("DATABASE_URL").trim()
const adminEmail = requiredEnv("SEED_ADMIN_EMAIL").trim()
const adminPassword = requiredEnv("SEED_ADMIN_PASSWORD")
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
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
}

main().finally(() => prisma.$disconnect())
