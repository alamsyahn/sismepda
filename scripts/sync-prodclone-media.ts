/**
 * Sinkronisasi media produksi → prodclone lokal.
 *
 *   npm run media:prodclone:sync -- --dry-run
 *   npm run media:prodclone:sync
 *
 * Seluruh keputusan (sumber, tujuan, argumen rsync) dibuat di `lib/media-sync.ts`
 * dan diuji tanpa jaringan. Script ini hanya mengeksekusi rencana tersebut.
 *
 * Semantik produksi: READ-ONLY. Tidak ada penulisan, penghapusan, mkdir, chmod,
 * chown, maupun sudo di sisi remote.
 */

import { spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import {
  describeMediaSync,
  MediaSyncError,
  planMediaSync,
  rsyncArgsFor,
} from "@/lib/media-sync"

function fail(message: string): never {
  console.error(`ABORT: ${message}`)
  process.exit(1)
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  let plan
  try {
    plan = planMediaSync({
      // Peran dipatok, tidak dibaca dari argumen: media produksi tidak pernah
      // boleh mendarat di atas media pengembangan lokal.
      role: "prodclone",
      dryRun,
      cwd: process.cwd(),
      resolve: (relative) => path.resolve(process.cwd(), relative),
    })
  } catch (error) {
    if (error instanceof MediaSyncError) fail(error.message)
    throw error
  }

  console.log(describeMediaSync(plan))

  const probe = spawnSync("rsync", ["--version"], { encoding: "utf8" })
  if (probe.status !== 0) {
    fail(
      "rsync tidak tersedia di mesin ini.\n" +
        "Sinkronisasi media memerlukan rsync agar transfer bersifat incremental.\n" +
        "Pasang rsync, atau salin media secara manual dari server.",
    )
  }

  // Direktori tujuan dibuat HANYA di sisi lokal. Tidak ada mkdir remote.
  if (!dryRun) await mkdir(plan.localPath, { recursive: true })

  const args = rsyncArgsFor(plan)
  console.log(`  rsync ${args.join(" ")}`)
  console.log("")

  const result = spawnSync("rsync", args, { stdio: "inherit" })
  if (result.error) fail(`rsync gagal dijalankan: ${result.error.message}`)
  if (result.status !== 0) fail(`rsync keluar dengan kode ${result.status}`)

  console.log("")
  if (dryRun) {
    console.log("Dry-run selesai. Tidak ada berkas yang diunduh atau diubah.")
  } else {
    console.log(`Sinkronisasi selesai → ${plan.localPath}`)
    console.log("Media lokal yang tidak ada di produksi dibiarkan (delete disabled).")
  }
}

main()
