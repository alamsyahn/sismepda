/**
 * Audit satu kali: apakah direktori/profil guru yang masih memakai
 * `role IN (ADMIN, GURU)` berbeda dari `isTeacher = true` pada data nyata?
 */
import { prisma } from "@/lib/prisma"

async function main() {
  const legacy = await prisma.user.count({ where: { role: { in: ["ADMIN", "GURU"] } } })
  const baru = await prisma.user.count({ where: { isTeacher: true } })
  const hilang = await prisma.user.count({
    where: { role: { in: ["ADMIN", "GURU"] }, isTeacher: false },
  })
  const tambah = await prisma.user.count({
    where: { NOT: { role: { in: ["ADMIN", "GURU"] } }, isTeacher: true },
  })
  console.log(`directory legacy=${legacy} baru=${baru} hilang=${hilang} tambah=${tambah}`)
  await prisma.$disconnect()
}

void main()
