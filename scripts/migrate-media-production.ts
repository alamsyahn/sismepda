/**
 * Migrasi media legacy PRODUKSI — satu-satunya jalur eksekusi yang didukung.
 *
 *     npm run media:migrate:production -- --dry-run
 *     npm run media:migrate:production -- --verify
 *     npm run media:migrate:production -- --apply --backup-set <dir>
 *
 * Perintah ini TIDAK menjalankan migrasi di mesin pengembangan. Ia menjalankan
 * perkakas di dalam container migrator di host produksi, satu-satunya tempat
 * yang memiliki akses ke database produksi (jaringan `internal=true`, tanpa
 * port terbuka) sekaligus volume media kanonik.
 *
 * Seluruh keputusan ada di `lib/media-migration-command.ts`; berkas ini hanya
 * menjalankan proses nyata — pembagian yang sama dengan `scripts/deploy.ts`.
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { BACKUP_SET_MANIFEST, authorizeLegacyMediaMigration, parseBackupSetManifest } from "@/lib/backup-set"
import { production, redactSecrets } from "@/lib/deployment"
import {
  banner,
  decideMode,
  remoteMediaMigrationScript,
  writesData,
  type MediaMigrationMode,
} from "@/lib/media-migration-command"

const args = process.argv.slice(2)

function fail(message: string, code = 64): never {
  console.error(message)
  process.exit(code)
}

/**
 * Nilai untuk `--backup-set <dir>`.
 *
 * Bentuk `--backup-set=<dir>` juga diterima agar operator tidak tersandung
 * perbedaan gaya flag.
 */
function flagValue(name: string): string | null {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1] ?? null
}

/**
 * Gate backup untuk migrasi sungguhan.
 *
 * Migrasi menulis berkas dan memperbarui referensi database; tanpa set lengkap
 * terverifikasi yang mencerminkan produksi saat ini, tidak ada jalan pulang.
 * Dry-run dan verify tidak menulis apa pun sehingga tidak dikenai gate.
 */
function assertBackupGate(mode: MediaMigrationMode): void {
  if (!writesData(mode)) return

  const dir = flagValue("--backup-set")
  if (!dir) {
    fail(
      "ABORT: --apply memerlukan --backup-set <dir>, yaitu salinan lokal set backup lengkap\n" +
        "yang sudah lolos `npm run backup:production:verify`.",
      2,
    )
  }

  let manifest
  try {
    const raw = readFileSync(path.join(dir, BACKUP_SET_MANIFEST), "utf8")
    manifest = parseBackupSetManifest(JSON.parse(raw))
  } catch (error) {
    fail(`ABORT: manifest set backup tidak terbaca di ${dir}: ${(error as Error).message}`, 2)
  }

  const problems = authorizeLegacyMediaMigration(manifest)
  if (problems.length > 0) {
    fail(
      ["ABORT: set backup tidak memenuhi syarat migrasi media legacy:", ...problems.map((p) => `  - ${p.message}`)].join(
        "\n",
      ),
      2,
    )
  }
  console.log(`Backup gate ... ELIGIBLE (${manifest.setId})`)
}

function main(): number {
  const decision = decideMode(args)
  if (!decision.ok) {
    console.error(`ABORT: ${decision.reason}`)
    console.error("")
    console.error("Pemakaian:")
    console.error("  npm run media:migrate:production -- --dry-run")
    console.error("  npm run media:migrate:production -- --verify")
    console.error("  npm run media:migrate:production -- --apply --backup-set <dir>")
    return 64
  }
  const { mode } = decision

  assertBackupGate(mode)

  console.log(
    banner({
      mode,
      // Label, bukan DATABASE_URL: kredensial tidak boleh sampai ke terminal
      // maupun log operator.
      database: `${production.databaseService} @ ${production.sshAlias}`,
      mediaRoot: production.mediaRoot,
      service: production.migratorService,
    }),
  )
  console.log("")

  if (mode === "apply") {
    console.log("Menjalankan MIGRASI SUNGGUHAN. Berkas akan ditulis dan referensi database diperbarui.")
    console.log("")
  }

  const script = remoteMediaMigrationScript({
    appDir: production.appDir,
    composeFile: production.composeFile,
    mediaComposeFile: production.mediaComposeFile,
    envFile: production.envFile,
    service: production.migratorService,
    profile: production.migratorProfile,
    mediaRoot: production.mediaRoot,
    mode,
  })

  const result = spawnSync("ssh", ["-o", "BatchMode=yes", production.sshAlias, "bash -s"], {
    input: script,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  const output = redactSecrets(`${result.stdout ?? ""}${result.stderr ?? ""}`).trimEnd()
  if (output) console.log(output)

  if (result.error) {
    console.error(`ABORT: ssh gagal: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

process.exit(main())
