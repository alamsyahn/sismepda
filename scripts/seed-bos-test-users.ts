import "dotenv/config"
import { hash } from "bcryptjs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

const url = process.env.DATABASE_URL!
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }),
})

async function main() {
  const passwordHash = await hash("UjiBos#2026", 12)
  const plain = await prisma.user.upsert({
    where: { email: "uji.tanpabos@example.test" },
    update: { passwordHash, active: true, canViewBos: false, canCreateBos: false, canEditBos: false, canManageBosCategories: false, canManageBosAccess: false },
    create: { email: "uji.tanpabos@example.test", name: "Guru Tanpa BOS", role: "GURU", passwordHash },
    select: { id: true, email: true },
  })
  const viewer = await prisma.user.upsert({
    where: { email: "uji.viewbos@example.test" },
    update: { passwordHash, active: true, canViewBos: true, canCreateBos: false, canEditBos: false },
    create: { email: "uji.viewbos@example.test", name: "Guru View BOS", role: "GURU", passwordHash, canViewBos: true },
    select: { id: true, email: true },
  })
  console.log(JSON.stringify({ plain, viewer }))
}

main().finally(() => prisma.$disconnect())
