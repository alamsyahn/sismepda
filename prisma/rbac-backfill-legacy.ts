/**
 * CLI backfill akses legacy → RBAC. One-time, terpisah dari `prisma db seed`.
 *
 *   npx tsx prisma/rbac-backfill-legacy.ts                       # dry-run
 *   npx tsx prisma/rbac-backfill-legacy.ts --apply --database=<nama_db>
 *
 * Verifikasi target: `--apply` wajib menyebut nama database yang HARUS sama
 * dengan `current_database()` koneksi aktif. Nama diketik operator, bukan
 * dibaca dari env, sehingga salah `.env` tidak bisa diam-diam menulis ke
 * database yang salah. Tidak ada kredensial yang dicetak.
 *
 * Tidak pernah dipanggil oleh seed, migrasi, build, atau startup aplikasi.
 */
import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"
import { databaseSchema } from "../lib/database-config"
import { runLegacyBackfill, type BackfillResult } from "../lib/rbac-backfill"
import { LEGACY_BACKFILL_KEY } from "../lib/rbac-legacy"

function parseArgs(argv: readonly string[]) {
  const apply = argv.includes("--apply")
  const database = argv.find((arg) => arg.startsWith("--database="))?.slice("--database=".length) ?? null
  return { apply, database }
}

function printReport(result: BackfillResult) {
  console.log(`[rbac-backfill] ${LEGACY_BACKFILL_KEY} mode=${result.mode} status=${result.status} mapping=v${result.mappingVersion}`)
  console.log(`  akun total=${result.usersTotal} sudah selesai=${result.usersAlreadyDone} direncanakan=${result.usersPlanned} ditulis=${result.usersWritten} keanggotaan=${result.membershipsWritten}`)
  console.log(`  paritas: dibandingkan=${result.parity.usersCompared} LOST=${result.parity.lost.length} GAINED=${result.parity.gained.length}`)
  for (const delta of result.parity.lost.slice(0, 50)) console.log(`    LOST   ${delta.userId} ${delta.decision}`)
  for (const delta of result.parity.gained.slice(0, 50)) console.log(`    GAINED ${delta.userId} ${delta.decision}`)
  console.log("  delta keamanan yang disengaja (bukan LOST/GAINED):")
  for (const note of result.parity.intentionalDeltas) console.log(`    - ${note}`)
}

async function main() {
  const { apply, database } = parseArgs(process.argv.slice(2))
  const url = process.env.DATABASE_URL
  if (!url?.trim()) throw new Error("DATABASE_URL wajib dikonfigurasi")
  if (apply && !database) throw new Error("--apply membutuhkan --database=<nama database target>")

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }, { schema: databaseSchema(url) }),
  })

  try {
    const rows = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`
    const actual = rows[0]?.current_database
    if (!actual) throw new Error("Nama database aktif tidak dapat dibaca")
    if (apply && actual !== database) {
      throw new Error(`REFUSED: koneksi aktif menuju "${actual}", bukan "${database}". Tidak ada yang ditulis.`)
    }
    console.log(`[rbac-backfill] database aktif: ${actual}${apply ? " (APPLY)" : " (dry-run)"}`)

    const result = await runLegacyBackfill(prisma, { mode: apply ? "apply" : "dry-run" })
    printReport(result)
    if (!apply) console.log("  dry-run: tidak ada baris yang ditulis. Tambahkan --apply --database=<nama> untuk menerapkan.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(`[rbac-backfill] GAGAL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
