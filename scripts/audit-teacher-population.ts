/**
 * Audit sumber-ganda populasi guru terhadap database nyata.
 *
 * `teacherPopulationWhere()` menerima `isTeacher = true` ATAU `role = "GURU"`.
 * Cabang kedua hanya berguna bila masih ada baris yang belum di-backfill.
 * Skrip ini menghitungnya — keputusan menghapus cabang itu adalah pertanyaan
 * data, bukan selera.
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL },
  { schema: databaseSchema(process.env.DATABASE_URL!) },
)
const prisma = new PrismaClient({ adapter })

async function main() {
  const [total, isTeacher, legacyGuru, onlyLegacy, adminNotTeacher, backfill] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isTeacher: true } }),
    prisma.user.count({ where: { role: "GURU" } }),
    // Baris yang HANYA terjangkau lewat cabang legacy.
    prisma.user.count({ where: { isTeacher: false, role: "GURU" } }),
    prisma.user.count({ where: { role: "ADMIN", isTeacher: false } }),
    prisma.rbacMigration.findMany({ select: { key: true, status: true, completedAt: true } }),
  ])

  console.log(`total user            : ${total}`)
  console.log(`isTeacher = true      : ${isTeacher}`)
  console.log(`role = GURU           : ${legacyGuru}`)
  console.log(`HANYA lewat legacy    : ${onlyLegacy}  <-- cabang role="GURU" dibutuhkan bila > 0`)
  console.log(`role = ADMIN, !teacher: ${adminNotTeacher}`)
  console.log(`migrasi RBAC          : ${JSON.stringify(backfill)}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
