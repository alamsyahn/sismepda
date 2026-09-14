/**
 * Orkestrasi deployment produksi SISMEPDA.
 *
 * Seluruh efek samping — proses lokal dan perintah SSH — masuk lewat satu
 * antarmuka `DeploymentRunner`. Karena itu urutan langkah, titik abort, dan
 * jaminan "backup gagal ⇒ sumber produksi tidak disentuh" dapat diuji dengan
 * runner palsu, tanpa SSH dan tanpa produksi.
 *
 * Invarian yang dijaga di sini:
 *   preflight lokal → push → preflight produksi → lock → BACKUP → pull commit
 *   → build → migrate deploy → aktivasi app → healthcheck
 * Setiap langkah yang gagal menghentikan rantai; langkah sesudahnya tidak
 * pernah dipanggil.
 */

import {
  assertRemoteCommandSafe,
  backupFileName,
  formatSummary,
  banner,
  isCommitSha,
  parseKeyValues,
  parseMigrateDeploy,
  production,
  redactSecrets,
  remoteActivateScript,
  remoteAcquireLockScript,
  remoteAppLogsScript,
  remoteBackupScript,
  remoteBuildScript,
  remoteHealthScript,
  remoteMigrateDeployScript,
  remoteMigrateStatusScript,
  remotePreflightScript,
  remoteReleaseLockScript,
  remoteStatusScript,
  remoteUpdateSourceScript,
  shortSha,
  stepLine,
  type MigrationOutcome,
} from "@/lib/deployment"

export type CommandResult = { ok: boolean; stdout: string; stderr: string; code: number | null }

export type DeploymentRunner = {
  /** Perintah lokal (git, npm). Tidak pernah dipakai untuk produksi. */
  local(command: string, args: readonly string[]): CommandResult
  /** Skrip shell di produksi lewat alias SSH. */
  remote(script: string, options?: { streamed?: boolean }): CommandResult
  log(message: string): void
  now(): Date
}

export class DeployAbort extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly detail?: string,
  ) {
    super(message)
  }
}

function abort(message: string, exitCode = 1, detail?: string): never {
  throw new DeployAbort(message, exitCode, detail)
}

/** Satu-satunya jalan perintah remote keluar: guard dijalankan di sini. */
function remote(
  runner: DeploymentRunner,
  script: string,
  options: { streamed?: boolean } = {},
): CommandResult {
  assertRemoteCommandSafe(script)
  return runner.remote(script, options)
}

// ---------------------------------------------------------------------------
// Preflight lokal
// ---------------------------------------------------------------------------

export type LocalState = {
  branch: string
  sha: string
  dirty: string[]
  originUrl: string
  aheadOfOrigin: number
}

export function readLocalState(runner: DeploymentRunner): LocalState {
  const inside = runner.local("git", ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout.trim() !== "true") {
    abort("Direktori kerja bukan repositori Git.", 1)
  }

  const branch = runner.local("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()
  const sha = runner.local("git", ["rev-parse", "HEAD"]).stdout.trim()
  const status = runner.local("git", ["status", "--porcelain"])
  const originUrl = runner.local("git", ["remote", "get-url", "origin"]).stdout.trim()
  const ahead = runner.local("git", ["rev-list", "--count", `origin/${production.branch}..HEAD`])

  return {
    branch,
    sha,
    dirty: status.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    originUrl,
    aheadOfOrigin: ahead.ok ? Number.parseInt(ahead.stdout.trim() || "0", 10) : Number.NaN,
  }
}

export type Blocker = { code: string; message: string }

/**
 * Murni: menilai keadaan lokal tanpa menjalankan apa pun. Dipakai bersama oleh
 * `deploy:prod` dan `deploy:check` supaya keduanya tidak bisa berbeda pendapat.
 */
export function evaluateLocalState(state: LocalState): Blocker[] {
  const blockers: Blocker[] = []

  if (state.branch !== production.branch) {
    blockers.push({
      code: "branch",
      message: `Branch aktif "${state.branch}", deployment hanya dari "${production.branch}".`,
    })
  }
  if (state.dirty.length > 0) {
    blockers.push({
      code: "dirty",
      message:
        `Working tree tidak bersih (${state.dirty.length} berkas).\n` +
        state.dirty.slice(0, 10).map((l) => `  ${l}`).join("\n"),
    })
  }
  if (!isCommitSha(state.sha)) {
    blockers.push({ code: "sha", message: "Commit SHA lokal tidak dapat ditentukan." })
  }
  if (!state.originUrl) {
    blockers.push({ code: "origin", message: "Remote `origin` tidak dikonfigurasi." })
  } else if (!state.originUrl.includes(production.repositorySlug)) {
    blockers.push({
      code: "origin",
      message: `Remote origin bukan ${production.repositorySlug}: ${state.originUrl}`,
    })
  }

  return blockers
}

/** Validasi canonical proyek: `npm test`, `npm run lint`, `npm run build`. */
export const validationCommands = [
  { label: "Tests", args: ["test"] },
  { label: "Lint", args: ["run", "lint"] },
  { label: "Build", args: ["run", "build"] },
] as const

export function runLocalValidation(runner: DeploymentRunner): void {
  for (const { label, args } of validationCommands) {
    const result = runner.local("npm", args)
    if (!result.ok) {
      abort(
        `Validasi lokal gagal pada: ${label} (npm ${args.join(" ")}).`,
        1,
        redactSecrets(result.stderr || result.stdout).slice(-4000),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// deploy:prod
// ---------------------------------------------------------------------------

export type DeployOptions = { dryRun?: boolean; skipValidation?: boolean }

const TOTAL_STEPS = 9

export function runDeploy(runner: DeploymentRunner, options: DeployOptions = {}): number {
  const dryRun = options.dryRun === true
  const state = readLocalState(runner)
  const blockers = evaluateLocalState(state)

  runner.log(banner(dryRun ? "SISMEPDA DEPLOYMENT — DRY RUN" : "SISMEPDA Production Deployment"))
  runner.log(
    formatSummary([
      ["Local commit", state.sha ? shortSha(state.sha) : "(unknown)"],
      ["Branch", state.branch || "(unknown)"],
      ["Target", production.sshAlias],
      ["App path", production.appDir],
      ["Compose", production.composeFile],
    ]) + "\n",
  )

  if (blockers.length > 0) {
    runner.log("DEPLOY ABORTED")
    for (const blocker of blockers) runner.log(blocker.message)
    return 1
  }

  let step = 0
  const ok = (label: string) => runner.log(stepLine((step += 1), TOTAL_STEPS, label, "OK"))
  const skipped = (label: string) =>
    runner.log(stepLine((step += 1), TOTAL_STEPS, label, "SKIPPED (dry run)"))

  // 1. Validasi lokal -------------------------------------------------------
  if (dryRun || options.skipValidation) skipped("Local validation")
  else {
    runLocalValidation(runner)
    ok("Local validation")
  }

  // 2. Push -----------------------------------------------------------------
  if (dryRun) skipped("Push origin/main")
  else {
    const push = runner.local("git", ["push", "origin", production.branch])
    if (!push.ok) {
      abort("Push ke origin/main gagal.", 1, redactSecrets(push.stderr))
    }
    ok("Push origin/main")
  }

  // 3. Preflight produksi ---------------------------------------------------
  // Dry run tidak mengirim perintah apa pun ke produksi, bahkan yang read-only.
  let previousHead = "(unknown)"
  if (dryRun) {
    skipped("Production preflight")
  } else {
    const preflight = remote(runner, remotePreflightScript())
    if (!preflight.ok) {
      abort("Preflight produksi gagal.", 2, redactSecrets(preflight.stderr || preflight.stdout))
    }
    const info = parseKeyValues(preflight.stdout)
    if (info.DIRTY !== "0") {
      abort(
        `Repositori produksi punya ${info.DIRTY} perubahan lokal yang belum di-commit.\n` +
          "Deployment dibatalkan; perubahan itu TIDAK dibuang. Selesaikan manual di server.",
        2,
      )
    }
    previousHead = info.HEAD ?? "(unknown)"
    ok("Production preflight")
  }

  if (dryRun) {
    runner.log("\nRencana langkah produksi (tidak dieksekusi):")
    for (const line of [
      `lock   ${production.lockDir}`,
      `backup ${production.backupDir}/${backupFileName(runner.now(), state.sha)}`,
      `source git merge --ff-only ${shortSha(state.sha)}`,
      `build  compose --profile migration build migrate app`,
      `db     prisma migrate deploy`,
      `app    compose up -d app`,
      `health ${production.healthPath}`,
    ]) {
      runner.log(`  ${line}`)
    }
    runner.log("\nDry run selesai. Produksi tidak diubah.")
    return 0
  }

  // 4. Lock -----------------------------------------------------------------
  const lock = remote(runner, remoteAcquireLockScript(state.sha))
  if (!lock.ok) abort("Deployment lain sedang berjalan.", 3, redactSecrets(lock.stderr))
  ok("Deployment lock")

  let backupPath = "(belum dibuat)"
  try {
    // 5. Backup -------------------------------------------------------------
    const fileName = backupFileName(runner.now(), state.sha)
    const backup = remote(runner, remoteBackupScript(fileName))
    if (!backup.ok) {
      abort(
        "DEPLOY ABORTED\nProduction database backup failed.\nProduction application was not modified.",
        4,
        redactSecrets(backup.stderr || backup.stdout),
      )
    }
    const backupInfo = parseKeyValues(backup.stdout)
    backupPath = backupInfo.BACKUP ?? `${production.backupDir}/${fileName}`
    ok(`Database backup (${(Number(backupInfo.SIZE ?? 0) / 1024 / 1024).toFixed(1)} MB)`)

    // 6. Sumber -------------------------------------------------------------
    const source = remote(runner, remoteUpdateSourceScript(state.sha))
    if (!source.ok) {
      abort(
        "Pembaruan sumber produksi gagal atau tidak fast-forward.",
        5,
        redactSecrets(source.stderr || source.stdout),
      )
    }
    if (parseKeyValues(source.stdout).HEAD !== state.sha) {
      abort("HEAD produksi tidak sama dengan commit lokal. Migrasi tidak dijalankan.", 5)
    }
    ok(`Source ${shortSha(state.sha)}`)

    // 7. Build sebelum menyentuh database -----------------------------------
    const build = remote(runner, remoteBuildScript(), { streamed: true })
    if (!build.ok) {
      abort(
        "Build image gagal. Database TIDAK diubah dan aplikasi lama tetap berjalan.",
        6,
        redactSecrets(build.stderr).slice(-4000),
      )
    }
    ok("Docker build")

    // 8. Migrasi ------------------------------------------------------------
    const migrate = remote(runner, remoteMigrateDeployScript(), { streamed: true })
    if (!migrate.ok) {
      abort(
        [
          "Prisma migrate deploy gagal.",
          "Aplikasi lama TIDAK dihentikan dan tidak ada seed/reset/restore otomatis.",
          `Backup predeploy: ${backupPath}`,
          `Commit sebelumnya: ${shortSha(previousHead)}`,
        ].join("\n"),
        7,
        redactSecrets(migrate.stderr || migrate.stdout).slice(-4000),
      )
    }
    const outcome: MigrationOutcome = parseMigrateDeploy(migrate.stdout + migrate.stderr)
    ok(`Migration (${describeMigration(outcome)})`)

    // 9. Aktivasi + healthcheck ---------------------------------------------
    const activate = remote(runner, remoteActivateScript(), { streamed: true })
    if (!activate.ok) {
      abort(
        `Aktivasi aplikasi gagal.\nBackup predeploy: ${backupPath}`,
        8,
        redactSecrets(activate.stderr),
      )
    }
    ok("Application activation")

    const health = remote(runner, remoteHealthScript())
    if (!health.ok) {
      const logs = remote(runner, remoteAppLogsScript())
      abort(
        [
          "Healthcheck gagal setelah aktivasi.",
          "",
          formatSummary([
            ["Attempted commit", shortSha(state.sha)],
            ["Previous commit", shortSha(previousHead)],
            ["Predeploy backup", backupPath],
            ["Container", redactSecrets(health.stderr).trim() || "(tidak diketahui)"],
          ]),
          "",
          "Log aplikasi terakhir:",
          redactSecrets(logs.stdout || logs.stderr).slice(-4000),
          "",
          "Pemulihan: rollback kode ke commit sebelumnya hanya aman bila rilis ini",
          "tidak memuat migrasi. Bila memuat, tentukan restore backup secara manual.",
        ].join("\n"),
        9,
      )
    }
    ok("Healthcheck")

    runner.log(
      "\n" +
        banner("SISMEPDA DEPLOYMENT SUCCESS") +
        "\n" +
        formatSummary([
          ["Commit", shortSha(state.sha)],
          ["Previous", shortSha(previousHead)],
          ["Backup", backupPath],
          ["Migration", describeMigration(outcome)],
          ["Application", "healthy"],
        ]) +
        "\n" +
        "=".repeat(56),
    )
    return 0
  } finally {
    // Lock selalu dilepas, termasuk saat abort; tidak ada efek destruktif.
    remote(runner, remoteReleaseLockScript())
  }
}

function describeMigration(outcome: MigrationOutcome): string {
  if (outcome === "up-to-date") return "no pending migration"
  if (outcome === "applied") return "applied"
  return "selesai (keluaran tidak dikenali)"
}

// ---------------------------------------------------------------------------
// deploy:check — read-only
// ---------------------------------------------------------------------------

export function runCheck(runner: DeploymentRunner, options: { skipValidation?: boolean } = {}): number {
  const blockers: Blocker[] = []
  const state = readLocalState(runner)

  runner.log(banner("SISMEPDA Deployment Check (read-only)"))
  runner.log("\nLOCAL CHECK")
  const localBlockers = evaluateLocalState(state)
  blockers.push(...localBlockers)
  runner.log(`  branch          ${state.branch} ${state.branch === production.branch ? "OK" : "BLOCKER"}`)
  runner.log(`  working tree    ${state.dirty.length === 0 ? "clean OK" : `${state.dirty.length} berkas BLOCKER`}`)
  runner.log(`  commit          ${isCommitSha(state.sha) ? shortSha(state.sha) : "BLOCKER"}`)
  runner.log(`  origin          ${state.originUrl.includes(production.repositorySlug) ? "OK" : "BLOCKER"}`)
  runner.log(
    `  unpushed        ${Number.isNaN(state.aheadOfOrigin) ? "tidak diketahui" : `${state.aheadOfOrigin} commit`}`,
  )

  if (options.skipValidation) {
    runner.log("  validation      dilewati (--skip-validation)")
  } else {
    for (const { label, args } of validationCommands) {
      const result = runner.local("npm", args)
      runner.log(`  ${label.toLowerCase().padEnd(15)} ${result.ok ? "OK" : "BLOCKER"}`)
      if (!result.ok) blockers.push({ code: "validation", message: `Validasi gagal: ${label}.` })
    }
  }

  runner.log("\nREMOTE READ-ONLY CHECK")
  const status = remote(runner, remoteStatusScript())
  if (!status.ok) {
    blockers.push({ code: "ssh", message: `Tidak dapat membaca status produksi: ${redactSecrets(status.stderr).trim()}` })
    runner.log("  ssh             BLOCKER")
  } else {
    const info = parseKeyValues(status.stdout)
    runner.log(`  ssh             OK (${production.sshAlias})`)
    runner.log(`  app dir         ${production.appDir}`)
    runner.log(`  compose file    ${info.COMPOSE_FILE === "yes" ? "OK" : "BLOCKER"}`)
    runner.log(`  env file        ${info.ENV_FILE === "yes" ? "OK (tidak dibaca)" : "BLOCKER"}`)
    runner.log(`  docker          ${info.DOCKER === "yes" ? "OK" : "BLOCKER"}`)
    runner.log(`  prod HEAD       ${info.HEAD ? shortSha(info.HEAD) : "?"} (${info.BRANCH ?? "?"})`)
    runner.log(`  prod tree       ${info.DIRTY === "0" ? "clean OK" : `${info.DIRTY} berkas BLOCKER`}`)
    runner.log(`  deploy lock     ${info.LOCK === "free" ? "free OK" : "held BLOCKER"}`)
    runner.log(`  last backup     ${info.BACKUP && info.BACKUP !== "none" ? info.BACKUP : "(belum ada)"}`)

    if (info.COMPOSE_FILE !== "yes") blockers.push({ code: "compose", message: `${production.composeFile} tidak ada di produksi.` })
    if (info.ENV_FILE !== "yes") blockers.push({ code: "env", message: `${production.envFile} tidak ada di produksi.` })
    if (info.DOCKER !== "yes") blockers.push({ code: "docker", message: "Docker tidak tersedia di produksi." })
    if (info.DIRTY !== "0") blockers.push({ code: "prod-dirty", message: "Working tree produksi tidak bersih." })
    if (info.LOCK !== "free") blockers.push({ code: "lock", message: "Deployment lain sedang memegang lock." })
  }

  runner.log("")
  if (blockers.length === 0) {
    runner.log("Ready to deploy: YES")
    return 0
  }
  runner.log("Ready to deploy: NO")
  for (const blocker of blockers) runner.log(`  - ${blocker.message}`)
  return 1
}

// ---------------------------------------------------------------------------
// deploy:status — read-only, cepat
// ---------------------------------------------------------------------------

export function runStatus(runner: DeploymentRunner): number {
  const localSha = runner.local("git", ["rev-parse", "HEAD"]).stdout.trim()
  const originSha = runner.local("git", ["rev-parse", `origin/${production.branch}`]).stdout.trim()

  const status = remote(runner, remoteStatusScript())
  runner.log("SISMEPDA Production\n")
  runner.log(
    formatSummary([
      ["Local", isCommitSha(localSha) ? shortSha(localSha) : "?"],
      ["Origin", isCommitSha(originSha) ? shortSha(originSha) : "? (jalankan git fetch)"],
    ]),
  )

  if (!status.ok) {
    runner.log(`\nProduction  tidak dapat dihubungi: ${redactSecrets(status.stderr).trim()}`)
    return 1
  }

  const info = parseKeyValues(status.stdout)
  const services = status.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("PS="))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)

  const appLine = services.find((line) => line.startsWith(production.appService)) ?? "app (tidak berjalan)"
  const dbLine = services.find((line) => line.startsWith(production.databaseService)) ?? "db (tidak berjalan)"

  runner.log(
    formatSummary([
      ["Production", info.HEAD ? shortSha(info.HEAD) : "?"],
      ["App", appLine],
      ["Database", dbLine],
      ["Prod tree", info.DIRTY === "0" ? "clean" : `${info.DIRTY} berkas berubah`],
      ["Deploy lock", info.LOCK ?? "?"],
      ["Backup", info.BACKUP && info.BACKUP !== "none" ? info.BACKUP : "(belum ada)"],
    ]),
  )

  const synced = isCommitSha(localSha) && info.HEAD === localSha
  runner.log(`\n${synced ? "Produksi sinkron dengan commit lokal." : "Produksi TIDAK sinkron dengan commit lokal."}`)
  return 0
}

/** Status migrasi produksi (read-only) — dipakai `deploy:status --migrations`. */
export function readMigrationStatus(runner: DeploymentRunner): CommandResult {
  return remote(runner, remoteMigrateStatusScript())
}
