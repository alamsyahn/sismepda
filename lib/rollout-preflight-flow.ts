/**
 * Orkestrasi `deploy:preflight` — rollout penyimpanan media.
 *
 * Seperti `lib/deployment-flow.ts`, seluruh efek samping lewat
 * `DeploymentRunner`, jadi alur ini dapat diuji penuh dengan runner palsu.
 *
 * Preflight ini READ-ONLY terhadap produksi tanpa kecuali. Ia tidak membuat
 * berkas uji, tidak menyentuh database, dan tidak menjalankan container.
 */

import {
  parseKeyValues,
  production,
  redactSecrets,
  remoteLegacyMediaBytesScript,
  remoteRolloutFactsScript,
  shortSha,
  banner,
  formatSummary,
  assertRemoteCommandSafe,
} from "@/lib/deployment"
import {
  blockersOf,
  estimateDiskRequirement,
  evaluateRollout,
  formatBytes,
  rolloutReady,
  type ContainerMount,
  type RolloutFacts,
} from "@/lib/rollout-preflight"
import type { DeploymentRunner } from "@/lib/deployment-flow"

/**
 * Baca baris `MOUNT=type|name|destination|source|rw` dari keluaran
 * `docker inspect`. Baris yang tidak berbentuk demikian diabaikan, bukan
 * ditebak: mount yang tidak dapat dibaca lebih baik hilang dari daftar (dan
 * memicu blocker "tidak ada mount") daripada dianggap persisten secara keliru.
 */
export function parseMounts(output: string): ContainerMount[] {
  const mounts: ContainerMount[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("MOUNT=")) continue
    const parts = trimmed.slice("MOUNT=".length).split("|")
    if (parts.length < 5) continue
    mounts.push({
      type: parts[0],
      name: parts[1],
      destination: parts[2],
      source: parts[3],
      readWrite: parts[4].toLowerCase() === "true",
    })
  }
  return mounts
}

/** Nama volume yang dideklarasikan konfigurasi compose, dari baris bertanda. */
export function parseConfiguredVolumes(output: string): string[] {
  const names: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^CONFIG_VOLUME=(.+)$/.exec(line.trim())
    if (match && match[1].trim()) names.push(match[1].trim())
  }
  return names
}

/** Migrasi yang tercatat di produksi, dibaca dari blok bertanda. */
export function parseAppliedMigrations(output: string): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const start = lines.indexOf("APPLIED_MIGRATIONS_BEGIN")
  const end = lines.indexOf("APPLIED_MIGRATIONS_END")
  if (start < 0 || end < 0 || end <= start) return []
  return lines.slice(start + 1, end).filter(Boolean)
}

/** Migrasi repo yang belum ada di produksi, dalam urutan repo. */
export function pendingMigrations(
  repoMigrations: readonly string[],
  appliedMigrations: readonly string[],
): string[] {
  const applied = new Set(appliedMigrations)
  return repoMigrations.filter((name) => !applied.has(name))
}

export type PreflightOptions = {
  /** Nama direktori migrasi di repo, terurut. */
  repoMigrations: readonly string[]
  /** Commit lokal, hanya untuk ditampilkan. */
  commit?: string
}

export function runRolloutPreflight(
  runner: DeploymentRunner,
  options: PreflightOptions,
): number {
  runner.log(banner("SISMEPDA Production Rollout Preflight"))
  runner.log(
    formatSummary([
      ["SSH", production.sshAlias],
      ["App", production.appDir],
      ["Compose", production.composeFile],
      ["Commit", options.commit ? shortSha(options.commit) : "(tidak diketahui)"],
    ]) + "\n",
  )

  const factsScript = remoteRolloutFactsScript()
  assertRemoteCommandSafe(factsScript)
  const factsResult = runner.remote(factsScript)
  if (!factsResult.ok) {
    const output = redactSecrets(factsResult.stderr || factsResult.stdout).trim()
    runner.log("Result .............. NOT READY")
    // Overlay media baru sampai ke produksi lewat `git merge --ff-only` pada
    // deploy berikutnya. Sebelum itu, ketiadaannya adalah keadaan yang
    // diharapkan — bukan kesalahan konfigurasi — dan pesannya harus mengatakan
    // apa yang harus dilakukan, bukan sekadar melaporkan berkas tidak ada.
    if (output.includes(production.mediaComposeFile)) {
      runner.log(
        `\nOverlay ${production.mediaComposeFile} belum ada di produksi.\n` +
          `Produksi masih menjalankan commit yang mendahului overlay tersebut.\n` +
          "Overlay ikut terkirim pada deploy berikutnya (git merge --ff-only);\n" +
          "jalankan preflight ini lagi setelah kode tersinkron.",
      )
      return 1
    }
    runner.log(`\nTidak dapat membaca fakta produksi:\n${output}`)
    return 1
  }

  const legacyScript = remoteLegacyMediaBytesScript()
  assertRemoteCommandSafe(legacyScript)
  const legacyResult = runner.remote(legacyScript)

  const info = parseKeyValues(factsResult.stdout)
  const facts: RolloutFacts = {
    mediaStorageRoot: info.MEDIA_ROOT ? info.MEDIA_ROOT : null,
    appMounts: parseMounts(factsResult.stdout),
    freeDiskBytes: Number.parseInt(info.FREE_BYTES ?? "0", 10) || 0,
    databaseBytes: Number.parseInt(info.DB_BYTES ?? "0", 10) || 0,
    legacyMediaBytes: legacyResult.ok
      ? Number.parseInt(parseKeyValues(legacyResult.stdout).LEGACY_MEDIA_BYTES ?? "0", 10) || 0
      : 0,
    backupDirWritable: info.BACKUP_WRITABLE === "yes",
    pendingMigrations: pendingMigrations(
      options.repoMigrations,
      parseAppliedMigrations(factsResult.stdout),
    ),
    configuredMediaMount: info.CONFIG_MEDIA_MOUNT ? info.CONFIG_MEDIA_MOUNT : null,
    configuredVolumes: parseConfiguredVolumes(factsResult.stdout),
    resolvedMediaVolumeName: info.CONFIG_VOLUME_NAME ? info.CONFIG_VOLUME_NAME : null,
  }

  const checks = evaluateRollout(facts)
  const estimate = estimateDiskRequirement(facts)

  const width = Math.max(...checks.map((check) => check.label.length))
  for (const check of checks) {
    const status = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "BLOCKER"
    runner.log(`  ${check.label.padEnd(width, " ")} ${status.padEnd(8)} ${firstLine(check.detail)}`)
  }

  runner.log(
    "\n" +
      formatSummary([
        ["Estimasi dump database", formatBytes(estimate.databaseBackupBytes)],
        ["Estimasi arsip media", formatBytes(estimate.mediaBackupBytes)],
        ["Duplikasi media sementara", formatBytes(estimate.mediaDuplicationBytes)],
        ["Overhead build Docker", formatBytes(estimate.dockerOverheadBytes)],
        ["Total dibutuhkan", formatBytes(estimate.requiredBytes)],
        ["Tersedia", formatBytes(facts.freeDiskBytes)],
      ]),
  )

  const ready = rolloutReady(checks)
  runner.log(`\nResult .............. ${ready ? "READY" : "NOT READY"}`)

  if (!ready) {
    runner.log("")
    for (const blocker of blockersOf(checks)) {
      runner.log(`BLOCKER ${blocker.label}`)
      for (const line of blocker.detail.split("\n")) runner.log(`  ${line}`)
    }
    return 1
  }

  return 0
}

function firstLine(text: string): string {
  const [line] = text.split("\n")
  return line
}
