/**
 * Menghapus data uji (synthetic) E-UKS — KHUSUS DEVELOPMENT/LOCAL.
 *
 * `npm run dev:euks-clear`
 *
 * Hanya baris bertanda synthetic yang dihapus. Siswa, kelas, absensi, akun,
 * pengaturan, dan seluruh data E-UKS asli tidak pernah disentuh. Guard yang
 * sama dengan generator berlaku di sini: kalau script tidak yakin database ini
 * development, tidak ada satu pun operasi yang dijalankan.
 */
import "dotenv/config"
import { REFUSAL_PREFIX, planEuksTestData } from "../lib/euks-test-data"
import {
  assertConnectedDatabase,
  clearSyntheticEuksData,
  createDevPrismaClient,
} from "./euks-test-data-store"

const LOG = "[dev:euks-clear]"

const decision = planEuksTestData(process.env)
if (!decision.ok) {
  console.error(`${LOG} ${REFUSAL_PREFIX}`)
  console.error(`${LOG} Alasan: ${decision.reason}`)
  console.error(`${LOG} Tidak ada penghapusan yang dilakukan.`)
  process.exit(1)
}

const plan = decision.plan
const prisma = createDevPrismaClient(process.env.DATABASE_URL!.trim())

async function main() {
  const actualDatabase = await assertConnectedDatabase(prisma, plan)
  console.log(`${LOG} Target development terverifikasi: host=${plan.databaseHost} db=${actualDatabase}`)

  const removed = await clearSyntheticEuksData(prisma)

  console.log("")
  console.log("Synthetic E-UKS data cleared")
  console.log("")
  console.log(`UKS visits removed:            ${removed.visits}`)
  console.log(`Health measurements removed:   ${removed.measurements}`)
  console.log(`Student demographics reset:    ${removed.demographics}`)
  console.log("")
  console.log(`Database: ${actualDatabase}`)
  console.log(`Environment: ${process.env.NODE_ENV ?? "development"}`)
}

main()
  .catch((error) => {
    console.error(`${LOG} Gagal:`, error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
