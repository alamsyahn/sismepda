/**
 * Bukti perilaku: mempersempit `teacherPopulationWhere()` ke `isTeacher` saja
 * tidak mengubah SATU BARIS pun dari populasi guru nyata.
 *
 * Membandingkan filter baru dengan filter legacy (OR isTeacher/role=GURU)
 * langsung di database, bukan mengandalkan penalaran.
 */
import "dotenv/config"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { teacherPopulationWhere } from "../lib/teacher-population"

const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL },
  { schema: databaseSchema(process.env.DATABASE_URL!) },
)
const prisma = new PrismaClient({ adapter })

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort()

async function main() {
  const [baru, legacy] = await Promise.all([
    prisma.user.findMany({ where: teacherPopulationWhere(), select: { id: true } }),
    prisma.user.findMany({
      where: { OR: [{ isTeacher: true }, { role: "GURU" }] },
      select: { id: true },
    }),
  ])

  const a = ids(baru)
  const b = ids(legacy)
  const hanyaLegacy = b.filter((id) => !a.includes(id))
  const hanyaBaru = a.filter((id) => !b.includes(id))

  console.log(`filter baru (isTeacher)     : ${a.length} baris`)
  console.log(`filter legacy (OR role=GURU): ${b.length} baris`)
  console.log(`hilang akibat penyempitan   : ${hanyaLegacy.length}`)
  console.log(`bertambah akibat penyempitan: ${hanyaBaru.length}`)

  const identik = hanyaLegacy.length === 0 && hanyaBaru.length === 0
  console.log(identik ? "PASS populasi identik" : "FAIL populasi BERUBAH")

  // Kontrol positif: filter yang sengaja salah HARUS terdeteksi berbeda.
  const salah = ids(await prisma.user.findMany({ where: { isTeacher: false }, select: { id: true } }))
  const kontrolBerbeda = salah.length !== b.length || salah.some((id) => !b.includes(id))
  console.log(
    kontrolBerbeda
      ? "PASS kontrol positif — pembanding memang mendeteksi perbedaan"
      : "FAIL kontrol positif — pembanding buta, hasil di atas tak bermakna",
  )

  if (!identik || !kontrolBerbeda) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
