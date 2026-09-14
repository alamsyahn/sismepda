/**
 * Kontrak keamanan deployment produksi.
 *
 * Semua eksekusi dipalsukan lewat `DeploymentRunner`, jadi test ini tidak
 * pernah menyentuh SSH, Docker, maupun database mana pun. Yang diuji adalah
 * keputusannya: perintah apa yang akan dikirim ke produksi, dalam urutan apa,
 * dan langkah mana yang TIDAK dijalankan ketika langkah sebelumnya gagal.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  assertRemoteCommandSafe,
  backupFileName,
  ForbiddenRemoteCommandError,
  isCommitSha,
  parseKeyValues,
  parseMigrateDeploy,
  production,
  redactSecrets,
  remoteActivateScript,
  remoteBackupScript,
  remoteBuildScript,
  remoteMigrateDeployScript,
  remoteStatusScript,
  remoteUpdateSourceScript,
  shellQuote,
} from "@/lib/deployment"
import {
  DeployAbort,
  evaluateLocalState,
  runCheck,
  runDeploy,
  runStatus,
  type CommandResult,
  type DeploymentRunner,
} from "@/lib/deployment-flow"

const SHA = "a".repeat(39) + "7"
const PREVIOUS = "b".repeat(40)

type Recorded = { kind: "local" | "remote"; command: string }

/** Runner palsu: mencatat setiap perintah dan membalas sesuai skenario. */
function fakeRunner(
  overrides: {
    local?: (command: string, args: readonly string[]) => CommandResult | undefined
    remote?: (script: string) => CommandResult | undefined
    dirty?: string[]
    branch?: string
    origin?: string
  } = {},
) {
  const calls: Recorded[] = []
  const output: string[] = []
  const okResult = (stdout = ""): CommandResult => ({ ok: true, stdout, stderr: "", code: 0 })

  const runner: DeploymentRunner = {
    local(command, args) {
      calls.push({ kind: "local", command: `${command} ${args.join(" ")}` })
      const override = overrides.local?.(command, args)
      if (override) return override
      const joined = args.join(" ")
      if (joined === "rev-parse --is-inside-work-tree") return okResult("true")
      if (joined === "rev-parse --abbrev-ref HEAD") return okResult(overrides.branch ?? "main")
      if (joined.startsWith("rev-parse HEAD")) return okResult(SHA)
      if (joined.startsWith("rev-parse origin/")) return okResult(SHA)
      if (joined === "status --porcelain") return okResult((overrides.dirty ?? []).join("\n"))
      if (joined === "remote get-url origin") {
        return okResult(overrides.origin ?? "git@github.com:alamsyahn/sismepda.git")
      }
      if (joined.startsWith("rev-list")) return okResult("0")
      return okResult()
    },
    remote(script) {
      calls.push({ kind: "remote", command: script })
      const override = overrides.remote?.(script)
      if (override) return override
      if (script.includes("git status --porcelain | wc -l")) {
        return okResult(
          [`HEAD=${PREVIOUS}`, "BRANCH=main", "DIRTY=0", "DB_CONTAINER=sismepda-db-1", "COMPOSE_FILE=yes", "ENV_FILE=yes", "DOCKER=yes", "LOCK=free", "BACKUP=none"].join("\n"),
        )
      }
      if (script.includes("mkdir " + production.lockDir)) return okResult("LOCK_ACQUIRED")
      if (script.includes("pg_dump")) return okResult(`BACKUP=${production.backupDir}/x.dump\nSIZE=2048000`)
      if (script.includes("merge --ff-only")) return okResult(`HEAD=${SHA}`)
      if (script.includes("migrate deploy")) return okResult("No pending migrations to apply.")
      return okResult()
    },
    log(message) {
      output.push(message)
    },
    now: () => new Date("2026-09-14T13:30:25.000Z"),
  }

  return { runner, calls, output: () => output.join("\n") }
}

const remoteCommands = (calls: Recorded[]) => calls.filter((c) => c.kind === "remote").map((c) => c.command)
const remoteMentions = (calls: Recorded[], needle: string) =>
  remoteCommands(calls).some((command) => command.includes(needle))

function deployResult(runner: DeploymentRunner): { code: number; abort?: DeployAbort } {
  try {
    return { code: runDeploy(runner) }
  } catch (error) {
    assert.ok(error instanceof DeployAbort, `abort tak terduga: ${String(error)}`)
    return { code: error.exitCode, abort: error }
  }
}

// ---------------------------------------------------------------------------
// 1-2. Preflight lokal
// ---------------------------------------------------------------------------

test("working tree kotor membatalkan deploy sebelum menyentuh produksi", () => {
  const { runner, calls, output } = fakeRunner({ dirty: [" M app/page.tsx"] })

  assert.equal(runDeploy(runner), 1)
  assert.match(output(), /DEPLOY ABORTED/)
  assert.match(output(), /Working tree tidak bersih/)
  assert.equal(remoteCommands(calls).length, 0, "tidak boleh ada perintah SSH")
})

test("branch selain main membatalkan deploy", () => {
  const { runner, calls, output } = fakeRunner({ branch: "feature/x" })

  assert.equal(runDeploy(runner), 1)
  assert.match(output(), /hanya dari "main"/)
  assert.equal(remoteCommands(calls).length, 0)
})

test("origin yang bukan repositori SISMEPDA membatalkan deploy", () => {
  const { runner } = fakeRunner({ origin: "git@github.com:pihak-lain/lain.git" })
  assert.equal(runDeploy(runner), 1)
})

test("evaluateLocalState menerima keadaan yang benar-benar bersih", () => {
  assert.deepEqual(
    evaluateLocalState({
      branch: "main",
      sha: SHA,
      dirty: [],
      originUrl: "https://github.com/alamsyahn/sismepda.git",
      aheadOfOrigin: 0,
    }),
    [],
  )
})

// ---------------------------------------------------------------------------
// 3. Validasi lokal gagal ⇒ tidak ada SSH
// ---------------------------------------------------------------------------

test("validasi lokal gagal menghentikan deploy sebelum push dan SSH", () => {
  const { runner, calls } = fakeRunner({
    local: (command, args) =>
      command === "npm" && args[0] === "test"
        ? { ok: false, stdout: "", stderr: "1 test gagal", code: 1 }
        : undefined,
  })

  const { code, abort } = deployResult(runner)
  assert.equal(code, 1)
  assert.match(abort!.message, /Validasi lokal gagal pada: Tests/)
  assert.equal(remoteCommands(calls).length, 0)
  assert.ok(!calls.some((c) => c.command.startsWith("git push")), "push tidak boleh terjadi")
})

// ---------------------------------------------------------------------------
// 4. Backup gagal ⇒ sumber/migrasi tidak dijalankan
// ---------------------------------------------------------------------------

test("backup gagal menghentikan deploy sebelum sumber produksi berubah", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("pg_dump")
        ? { ok: false, stdout: "", stderr: "ABORT: berkas backup kosong", code: 4 }
        : undefined,
  })

  const { code, abort } = deployResult(runner)
  assert.equal(code, 4)
  assert.match(abort!.message, /Production application was not modified/)
  assert.ok(!remoteMentions(calls, "merge --ff-only"), "sumber tidak boleh diperbarui")
  assert.ok(!remoteMentions(calls, "migrate deploy"), "migrasi tidak boleh dijalankan")
  assert.ok(!remoteMentions(calls, "up -d"), "aplikasi tidak boleh di-restart")
})

test("backup selalu dibuat meski rilis hanya UI", () => {
  const { runner, calls } = fakeRunner()
  assert.equal(runDeploy(runner), 0)
  assert.ok(remoteMentions(calls, "pg_dump"), "setiap deploy wajib membuat backup")
  const backupIndex = remoteCommands(calls).findIndex((c) => c.includes("pg_dump"))
  const sourceIndex = remoteCommands(calls).findIndex((c) => c.includes("merge --ff-only"))
  assert.ok(backupIndex < sourceIndex, "backup harus mendahului pembaruan sumber")
})

// ---------------------------------------------------------------------------
// 5-7. Build, migrasi, healthcheck
// ---------------------------------------------------------------------------

test("build gagal mencegah migrasi database", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("build migrate")
        ? { ok: false, stdout: "", stderr: "syntax error", code: 1 }
        : undefined,
  })

  const { code, abort } = deployResult(runner)
  assert.equal(code, 6)
  assert.match(abort!.message, /Database TIDAK diubah/)
  assert.ok(!remoteMentions(calls, "migrate deploy"))
  assert.ok(!remoteMentions(calls, "up -d"))
})

test("migrasi gagal mencegah aktivasi aplikasi dan menyebut backup", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("migrate deploy")
        ? { ok: false, stdout: "", stderr: "P3009 migrasi gagal", code: 1 }
        : undefined,
  })

  const { code, abort } = deployResult(runner)
  assert.equal(code, 7)
  assert.match(abort!.message, /Backup predeploy/)
  assert.ok(!remoteMentions(calls, "up -d"), "aplikasi baru tidak boleh diaktifkan")
  assert.doesNotMatch(abort!.message, /db seed|migrate reset/)
})

test("healthcheck gagal menghasilkan exit non-zero beserta metadata pemulihan", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("State.Health")
        ? { ok: false, stdout: "", stderr: "STATE=restarting", code: 6 }
        : undefined,
  })

  const { code, abort } = deployResult(runner)
  assert.equal(code, 9)
  assert.match(abort!.message, /Attempted commit/)
  assert.match(abort!.message, /Previous commit/)
  assert.match(abort!.message, /Predeploy backup/)
  assert.ok(remoteMentions(calls, "logs --tail"), "log aplikasi harus ditampilkan")
})

test("HEAD produksi yang tidak sama dengan commit lokal membatalkan sebelum migrasi", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("merge --ff-only")
        ? { ok: true, stdout: `HEAD=${PREVIOUS}`, stderr: "", code: 0 }
        : undefined,
  })

  const { code, abort } = deployResult(runner)
  assert.equal(code, 5)
  assert.match(abort!.message, /tidak sama dengan commit lokal/)
  assert.ok(!remoteMentions(calls, "migrate deploy"))
})

test("deploy sukses melaporkan commit, backup, migrasi, dan kesehatan", () => {
  const { runner, output } = fakeRunner()
  assert.equal(runDeploy(runner), 0)
  const text = output()
  assert.match(text, /SISMEPDA DEPLOYMENT SUCCESS/)
  assert.match(text, /Commit +: a{6}/)
  assert.match(text, /Migration +: no pending migration/)
  assert.match(text, /Application +: healthy/)
})

test("lock dilepas meski deploy gagal", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) => (script.includes("pg_dump") ? { ok: false, stdout: "", stderr: "x", code: 4 } : undefined),
  })
  deployResult(runner)
  assert.ok(remoteMentions(calls, "rmdir"), "lock harus dilepas")
})

test("lock yang sudah dipegang membatalkan deploy tanpa backup", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("mkdir " + production.lockDir)
        ? { ok: false, stdout: "", stderr: "ABORT: deployment lain sedang berjalan", code: 3 }
        : undefined,
  })
  const { code } = deployResult(runner)
  assert.equal(code, 3)
  assert.ok(!remoteMentions(calls, "pg_dump"))
})

test("repositori produksi yang kotor membatalkan tanpa membuang perubahan", () => {
  const { runner, calls } = fakeRunner({
    remote: (script) =>
      script.includes("git status --porcelain | wc -l")
        ? { ok: true, stdout: `HEAD=${PREVIOUS}\nBRANCH=main\nDIRTY=3`, stderr: "", code: 0 }
        : undefined,
  })
  const { code, abort } = deployResult(runner)
  assert.equal(code, 2)
  assert.match(abort!.message, /TIDAK dibuang/)
  assert.ok(!remoteMentions(calls, "pg_dump"))
})

// ---------------------------------------------------------------------------
// 8-11. Operasi terlarang
// ---------------------------------------------------------------------------

test("tidak ada skrip remote yang memuat db push, migrate reset/dev, atau seed", () => {
  const scripts = [
    remoteBackupScript("2026-09-14_13-30-25_aaaaaaa.dump"),
    remoteUpdateSourceScript(SHA),
    remoteBuildScript(),
    remoteMigrateDeployScript(),
    remoteActivateScript(),
    remoteStatusScript(),
  ]

  for (const script of scripts) {
    assert.doesNotMatch(script, /db push/)
    assert.doesNotMatch(script, /migrate reset/)
    assert.doesNotMatch(script, /migrate dev/)
    assert.doesNotMatch(script, /db seed/)
    assert.doesNotMatch(script, /reset --hard/)
    assert.doesNotMatch(script, /compose[^\n]* down/)
    assert.doesNotMatch(script, /volume rm|system prune/)
    // Setiap skrip juga harus lolos guard yang sama saat runtime.
    assertRemoteCommandSafe(script)
  }
})

test("guard menolak perintah remote berbahaya apa pun", () => {
  for (const script of [
    "cd /srv/apps/sismepda && npx prisma db push",
    "cd /srv/apps/sismepda && npx prisma migrate reset --force",
    "cd /srv/apps/sismepda && npx prisma db seed",
    "docker compose -f deploy.yaml down",
    "docker volume rm sismepda_db",
    "git reset --hard origin/main",
  ]) {
    assert.throws(() => assertRemoteCommandSafe(script), ForbiddenRemoteCommandError, script)
  }
})

test("migrator image dan compose tidak lagi menjalankan seed sebagai bagian deploy", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8")
  const migratorStage = dockerfile.slice(dockerfile.indexOf("AS migrator"))
  const cmd = /CMD \[.*\]/.exec(migratorStage)?.[0] ?? ""
  assert.match(cmd, /prisma migrate deploy/)
  assert.doesNotMatch(cmd, /db seed/)

  const compose = readFileSync("compose.yaml", "utf8")
  const command = /command: \[.*\]/.exec(compose)?.[0] ?? ""
  assert.match(command, /prisma migrate deploy/)
  assert.doesNotMatch(command, /db seed/)
})

test("deploy tidak pernah menyentuh konfigurasi lokal/prodclone", () => {
  const { runner, calls } = fakeRunner()
  runDeploy(runner)
  for (const { command } of calls) {
    assert.doesNotMatch(command, /\.env\.local|prodclone|sismepda_dev|refresh-prodclone/)
  }
})

// ---------------------------------------------------------------------------
// 12. Rahasia
// ---------------------------------------------------------------------------

test("kredensial produksi tidak muncul pada keluaran", () => {
  const secret = "postgresql://sismepda:sangat-rahasia@db:5432/sismepda"
  const { runner, output } = fakeRunner({
    remote: (script) =>
      script.includes("pg_dump")
        ? { ok: false, stdout: "", stderr: `gagal terhubung ${secret}\nAUTH_SECRET=abc123`, code: 4 }
        : undefined,
  })

  const { abort } = deployResult(runner)
  const text = `${output()}\n${abort?.message}\n${abort?.detail}`
  assert.doesNotMatch(text, /sangat-rahasia/)
  assert.doesNotMatch(text, /abc123/)
  assert.match(abort!.detail!, /REDACTED/)
})

test("redactSecrets menyembunyikan URL database dan variabel rahasia", () => {
  assert.doesNotMatch(redactSecrets("postgresql://u:p@h/db"), /:p@/)
  assert.doesNotMatch(redactSecrets("DATABASE_URL=postgres://u:p@h/db"), /u:p/)
  assert.doesNotMatch(redactSecrets("AUTH_SECRET=rahasia"), /rahasia/)
  assert.equal(redactSecrets("tidak ada rahasia"), "tidak ada rahasia")
})

test("verifikasi arsip membaca backup dari stdin, bukan dari berkas bernama '-'", () => {
  const script = remoteBackupScript("2026-09-14_13-30-25_aaaaaaa.dump")
  // pg_restore memakai stdin justru ketika nama arsip DIHILANGKAN; `-` di
  // posisi itu diperlakukan sebagai nama berkas literal dan gagal dengan
  // "could not open input file". Redirection-lah yang menyalurkan dump.
  assert.doesNotMatch(
    script,
    /pg_restore\s+--list\s+-(?:\s|$)/,
    "`pg_restore --list -` membuat verifikasi backup selalu gagal",
  )
  assert.match(
    script,
    /pg_restore --list < '[^']+\.dump'/,
    "arsip harus dialirkan ke pg_restore lewat redirection stdin",
  )
})

test("skrip backup tidak memuat password pada argumen", () => {
  const script = remoteBackupScript("2026-09-14_13-30-25_aaaaaaa.dump")
  assert.doesNotMatch(script, /PGPASSWORD=/)
  assert.doesNotMatch(script, /--password/)
  // Kredensial dibaca dari environment container, bukan dikirim dari lokal.
  assert.match(script, /printenv POSTGRES_USER/)
})

// ---------------------------------------------------------------------------
// 13. check/status tidak mengubah apa pun
// ---------------------------------------------------------------------------

test("deploy:status hanya membaca dan tidak pernah push", () => {
  const { runner, calls } = fakeRunner()
  assert.equal(runStatus(runner), 0)
  for (const { command } of calls) {
    assert.doesNotMatch(command, /pg_dump|merge --ff-only|up -d|migrate deploy|git push|build migrate/)
  }
})

test("deploy:check hanya membaca produksi dan melaporkan kesiapan", () => {
  const { runner, calls, output } = fakeRunner()
  assert.equal(runCheck(runner, { skipValidation: true }), 0)
  assert.match(output(), /LOCAL CHECK/)
  assert.match(output(), /REMOTE READ-ONLY CHECK/)
  assert.match(output(), /Ready to deploy: YES/)
  for (const { command } of calls) {
    assert.doesNotMatch(command, /pg_dump|merge --ff-only|up -d|migrate deploy|git push|build migrate/)
  }
})

test("deploy:check melaporkan NO ketika produksi kotor", () => {
  const { runner, output } = fakeRunner({
    remote: () => ({ ok: true, stdout: `HEAD=${PREVIOUS}\nDIRTY=2\nCOMPOSE_FILE=yes\nENV_FILE=yes\nDOCKER=yes\nLOCK=free`, stderr: "", code: 0 }),
  })
  assert.equal(runCheck(runner, { skipValidation: true }), 1)
  assert.match(output(), /Ready to deploy: NO/)
})

test("dry run tidak push, tidak backup, tidak migrasi, dan tidak menghubungi produksi", () => {
  const { runner, calls, output } = fakeRunner()
  assert.equal(runDeploy(runner, { dryRun: true }), 0)
  assert.match(output(), /DRY RUN/)
  assert.equal(remoteCommands(calls).length, 0, "dry run tidak boleh mengirim perintah SSH")
  for (const { command } of calls) {
    assert.doesNotMatch(command, /pg_dump|merge --ff-only|up -d|migrate deploy|git push|build migrate/)
  }
})

// ---------------------------------------------------------------------------
// Helper murni
// ---------------------------------------------------------------------------

test("nama berkas backup mengikuti pola waktu + short commit", () => {
  assert.equal(backupFileName(new Date("2026-09-14T13:30:25Z"), SHA), "2026-09-14_13-30-25_aaaaaaa.dump")
})

test("SHA tidak sah menolak pembangunan perintah remote", () => {
  assert.equal(isCommitSha("abc"), false)
  assert.equal(isCommitSha(SHA), true)
  assert.throws(() => remoteUpdateSourceScript("main; rm -rf /"), /tidak sah/)
  assert.throws(() => backupFileName(new Date(), "HEAD"), /tidak sah/)
})

test("nama berkas backup yang tidak sah ditolak", () => {
  assert.throws(() => remoteBackupScript("../../etc/passwd"), /tidak sah/)
})

test("shellQuote menetralkan kutip tunggal", () => {
  assert.equal(shellQuote("a'b"), `'a'\\''b'`)
})

test("retention hanya menyentuh berkas predeploy di direktorinya sendiri", () => {
  const script = remoteBackupScript("2026-09-14_13-30-25_aaaaaaa.dump")
  assert.match(script, new RegExp(`ls -1t ${production.backupDir.replace(/\//g, "\\/")}/\\[0-9\\]`))
  assert.doesNotMatch(script, /rm -rf/)
  assert.doesNotMatch(script, /\*\.dump'?\s*$/m)
  assert.match(script, /tail -n \+\$\(\( 20 \+ 1 \)\)/)
})

test("keluaran migrate deploy tanpa migrasi tertunda dianggap normal", () => {
  assert.equal(parseMigrateDeploy("No pending migrations to apply."), "up-to-date")
  assert.equal(parseMigrateDeploy("Applied 2 migrations."), "applied")
  assert.equal(parseMigrateDeploy("keluaran asing"), "unknown")
})

test("parseKeyValues hanya mengambil kunci huruf besar", () => {
  assert.deepEqual(parseKeyValues("HEAD=abc\nbukan=kunci\nSIZE=10"), { HEAD: "abc", SIZE: "10" })
})
