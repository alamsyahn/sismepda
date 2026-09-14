/**
 * Wrapper: refresh database prodclone lalu sinkronkan medianya.
 *
 *   npm run prodclone:refresh
 *   npm run prodclone:refresh -- --skip-media
 *   npm run prodclone:refresh -- --dry-run     (dry-run pada tahap media)
 *
 * Fail-fast: bila refresh database gagal, sinkronisasi media TIDAK dijalankan.
 * Bila database berhasil tetapi media gagal, database TIDAK di-rollback dan
 * laporan menyebut kegagalan itu secara eksplisit.
 */

import { spawnSync } from "node:child_process"

import { evaluateProdcloneRefresh, type StepOutcome } from "@/lib/prodclone-refresh"

function runStep(label: string, args: string[]): boolean {
  console.log("")
  console.log(`── ${label} ─────────────────────────────────────────`)
  console.log("")
  const result = spawnSync("npm", ["run", ...args], { stdio: "inherit", shell: true })
  return result.status === 0
}

function main() {
  const skipMedia = process.argv.includes("--skip-media")
  const dryRun = process.argv.includes("--dry-run")

  console.log("SISMEPDA Prodclone Refresh")
  console.log("")
  console.log("  1. db:prodclone:refresh    — snapshot database produksi")
  console.log(
    `  2. media:prodclone:sync    — ${skipMedia ? "DILEWATI (--skip-media)" : "sinkronisasi media incremental"}`,
  )

  const databaseOk = runStep("Database", ["db:prodclone:refresh"])

  let media: StepOutcome = "skipped"
  if (databaseOk && !skipMedia) {
    const mediaArgs = dryRun
      ? ["media:prodclone:sync", "--", "--dry-run"]
      : ["media:prodclone:sync"]
    media = runStep("Media", mediaArgs) ? "success" : "failed"
  }

  const outcome = evaluateProdcloneRefresh({
    database: databaseOk ? "success" : "failed",
    media,
  })

  console.log("")
  console.log("── Hasil ─────────────────────────────────────────────")
  console.log("")
  console.log(outcome.summary)
  process.exit(outcome.exitCode)
}

main()
