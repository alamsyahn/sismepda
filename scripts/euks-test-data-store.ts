/**
 * Bagian bersama script data uji E-UKS: pembuatan client dan penghapusan
 * selektif. Khusus development — tidak pernah diimpor oleh kode aplikasi.
 *
 * Penghapusan dipusatkan di sini agar `euks:seed:*` (yang membersihkan data
 * lamanya sendiri sebelum menulis ulang) dan `euks:clear:*` tidak mungkin
 * memakai filter yang berbeda.
 */
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { REFUSAL_PREFIX, verifyConnectedDatabase, type EuksTestDataPlan } from "../lib/euks-test-data"

export function createDevPrismaClient(databaseUrl: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: databaseSchema(databaseUrl) }),
  })
}

/**
 * Memastikan database yang benar-benar dilayani server sama dengan yang sudah
 * diizinkan guard. Lapis terakhir untuk alias/tunnel/pooler yang membuat URL
 * tidak mencerminkan database sesungguhnya.
 */
export async function assertConnectedDatabase(
  prisma: PrismaClient,
  plan: EuksTestDataPlan,
): Promise<string> {
  const rows = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`
  const actual = rows[0]?.current_database
  if (!actual) throw new Error(`${REFUSAL_PREFIX} Nama database aktif tidak dapat dibaca.`)
  verifyConnectedDatabase(actual, plan)
  return actual
}

export type ClearResult = {
  visits: number
  measurements: number
  demographics: number
}

/**
 * Menghapus HANYA baris bertanda synthetic.
 *
 * Tidak ada siswa yang dihapus, tidak ada absensi yang disentuh, tidak ada
 * kunjungan/pengukuran asli yang ikut terhapus: setiap operasi disaring oleh
 * kolom penanda yang hanya pernah di-set true oleh generator ini.
 */
export async function clearSyntheticEuksData(prisma: PrismaClient): Promise<ClearResult> {
  const [visits, measurements, demographics] = await prisma.$transaction([
    prisma.euksVisit.deleteMany({ where: { isSynthetic: true } }),
    prisma.studentHealthMeasurement.deleteMany({ where: { isSynthetic: true } }),
    // Demografi dikembalikan ke NULL seperti sebelum generator berjalan; baris
    // siswanya sendiri tidak pernah dihapus.
    prisma.student.updateMany({
      where: { syntheticDemographics: true },
      data: { gender: null, birthDate: null, syntheticDemographics: false },
    }),
  ])
  return {
    visits: visits.count,
    measurements: measurements.count,
    demographics: demographics.count,
  }
}
