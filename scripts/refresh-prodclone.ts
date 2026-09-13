/**
 * Refresh clone lokal database produksi.
 *
 *     produksi → dump → prodclone lokal → migrasi repo → bootstrap lokal
 *
 * Produksi diperlakukan READ-ONLY tanpa kecuali. Satu-satunya perintah yang
 * pernah dijalankan di sana adalah `pg_dump` dan `SELECT`; seluruh operasi
 * tulis — drop, create, restore, migrate, seed — hanya menyentuh container
 * PostgreSQL lokal yang dibuat khusus untuk clone ini.
 *
 * Clone berjalan di container terpisah, bukan di server PostgreSQL 15 milik
 * Windows, karena produksi memakai PostgreSQL 17: arsip custom-format 17 tidak
 * dapat dibaca `pg_restore` 15, dan dump plain-nya memuat direktif yang server
 * 15 tolak. Menyamakan versi menghapus seluruh kelas masalah itu, sekaligus
 * membuat clone benar-benar setara produksi.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  assertDestroyableClone,
  databaseTargets,
  describeTarget,
  parseDatabaseUrl,
  verifyServedDatabase,
} from "@/lib/database-target"

// ---------------------------------------------------------------------------
// Konfigurasi lokal clone
// ---------------------------------------------------------------------------

/** Host produksi; hanya dipakai untuk `ssh` dan `pg_dump`. */
const PRODUCTION_SSH_ALIAS = "smpn2"
const PRODUCTION_APP_DIR = "/srv/apps/sismepda"

/**
 * Container clone. Nama, port, dan volume sengaja berbeda dari container
 * PostgreSQL lain di mesin ini supaya workflow ini tidak dapat menabrak
 * database proyek lain: port 5432 milik PostgreSQL 15 Windows dan 5433 milik
 * container proyek lain keduanya dihindari.
 */
const CLONE_CONTAINER = "sismepda-prodclone-db"
const CLONE_IMAGE = "postgres:17.10-alpine"
const CLONE_PORT = 5434
const CLONE_VOLUME = "sismepda_prodclone_data"
const CLONE_SUPERUSER = "prodclone"
const CLONE_DATABASE = databaseTargets.prodclone.expectedDatabase
const CLONE_ENV_FILE = databaseTargets.prodclone.envFile

const DUMP_DIR = resolve(process.cwd(), ".prodclone")
const DUMP_FILE = resolve(DUMP_DIR, "production.dump")
const KEEP_DUMP = process.argv.includes("--keep-dump")
const SKIP_DUMP = process.argv.includes("--reuse-dump")

// ---------------------------------------------------------------------------
// Util proses
// ---------------------------------------------------------------------------

function step(message: string): void {
  console.log(`\n▶ ${message}`)
}

function fail(message: string): never {
  console.error(`\nABORT: ${message}`)
  process.exit(1)
}

type RunOptions = {
  /** Rahasia yang diteruskan lewat environment, bukan argumen. */
  env?: Record<string, string>
  allowFailure?: boolean
  quiet?: boolean
}

function run(command: string, args: string[], options: RunOptions = {}) {
  const result = spawnSync(command, args, {
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
  })
  if (result.error) {
    if (options.allowFailure) return { ok: false as const, stdout: "", stderr: String(result.error) }
    fail(`Gagal menjalankan \`${command}\`: ${result.error.message}`)
  }
  const ok = result.status === 0
  if (!ok && !options.allowFailure) {
    const detail = options.quiet ? `\n${result.stderr ?? ""}` : ""
    fail(`Perintah \`${command} ${args[0] ?? ""}\` gagal dengan kode ${result.status}.${detail}`)
  }
  return { ok, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() }
}

/** Perintah di produksi. Hanya boleh read-only; dipakai untuk probe dan dump. */
function ssh(remoteCommand: string, options: RunOptions = {}) {
  return run("ssh", ["-o", "BatchMode=yes", PRODUCTION_SSH_ALIAS, remoteCommand], options)
}

function docker(args: string[], options: RunOptions = {}) {
  return run("docker", args, options)
}

/** psql di dalam container clone; password lewat environment. */
function clonePsql(database: string, sql: string, options: { allowFailure?: boolean } = {}) {
  return docker(
    [
      "exec",
      "-e",
      `PGPASSWORD=${clonePassword}`,
      CLONE_CONTAINER,
      "psql",
      // Host TCP eksplisit: server sementara milik entrypoint hanya
      // mendengarkan socket Unix, jadi memaksa TCP membuat probe kesiapan
      // benar-benar menguji server yang akan dipakai aplikasi.
      "-h",
      "127.0.0.1",
      "-U",
      CLONE_SUPERUSER,
      "-d",
      database,
      "-At",
      "-c",
      sql,
    ],
    { quiet: true, allowFailure: options.allowFailure },
  )
}

// ---------------------------------------------------------------------------
// 1. Prasyarat lokal
// ---------------------------------------------------------------------------

step("Memverifikasi prasyarat lokal")

/**
 * `ssh` tidak punya `--version`; ia mencetak versi ke stderr lalu keluar dengan
 * kode non-nol. Jadi keberadaannya diuji lewat `-V`, dan yang dinilai adalah
 * apakah biner dapat dijalankan sama sekali, bukan exit code-nya.
 */
const sshProbeBinary = run("ssh", ["-V"], { quiet: true, allowFailure: true })
if (sshProbeBinary.stderr === "" && sshProbeBinary.stdout === "") {
  fail("`ssh` tidak tersedia di PATH.")
}
if (!run("docker", ["--version"], { quiet: true, allowFailure: true }).ok) {
  fail("`docker` tidak tersedia di PATH.")
}
if (!docker(["info"], { quiet: true, allowFailure: true }).ok) {
  fail("Docker daemon tidak berjalan. Jalankan Docker Desktop lalu ulangi.")
}
console.log("  ssh, docker, dan daemon Docker siap.")

/**
 * Password superuser clone dibuat sekali lalu disimpan di file environment yang
 * sudah ter-gitignore. Nilainya acak dan tidak pernah dicetak: clone memuat
 * data siswa nyata, jadi kredensialnya diperlakukan seperti kredensial nyata.
 */
function loadOrCreateClonePassword(): string {
  if (existsSync(CLONE_ENV_FILE)) {
    const existing = readFileSync(CLONE_ENV_FILE, "utf8").match(/postgresql:\/\/[^:]+:([^@]+)@/)
    if (existing?.[1]) return decodeURIComponent(existing[1])
  }
  return crypto.randomUUID().replace(/-/g, "")
}
const clonePassword = loadOrCreateClonePassword()

// ---------------------------------------------------------------------------
// 2. Koneksi produksi
// ---------------------------------------------------------------------------

step(`Memverifikasi koneksi SSH ke ${PRODUCTION_SSH_ALIAS}`)
const sshProbe = ssh("echo ok", { quiet: true, allowFailure: true })
if (!sshProbe.ok || sshProbe.stdout !== "ok") {
  fail(
    `SSH ke ${PRODUCTION_SSH_ALIAS} gagal.\n` +
      `Pastikan alias ada di ~/.ssh/config dan kunci sudah dimuat (BatchMode menolak prompt password).`,
  )
}
console.log(`  SSH ke ${PRODUCTION_SSH_ALIAS} berhasil.`)

// ---------------------------------------------------------------------------
// 3. Identifikasi database produksi dari deployment nyata
// ---------------------------------------------------------------------------

step("Mengidentifikasi database produksi dari konfigurasi deployment")

/**
 * Nama container dan database TIDAK diasumsikan. Container ditemukan dari
 * daftar container berjalan yang memakai image `postgres`, lalu nama database
 * dan user dibaca dari environment container itu sendiri — sumber yang sama
 * yang dipakai aplikasi produksi.
 */
const containerList = ssh(
  `docker ps --filter ancestor=postgres --format '{{.Names}}' ; docker ps --format '{{.Names}}\t{{.Image}}' | grep -i postgres | cut -f1`,
  { quiet: true },
)
const candidates = [...new Set(containerList.stdout.split(/\s+/).filter(Boolean))]
if (candidates.length === 0) {
  fail(`Tidak menemukan container PostgreSQL yang berjalan di ${PRODUCTION_SSH_ALIAS}.`)
}

const appContainer = ssh(
  `cd ${PRODUCTION_APP_DIR} && docker ps --format '{{.Names}}' | grep -E '^sismepda-(app|db)-' | head -5`,
  { quiet: true, allowFailure: true },
)
const dbCandidates = candidates.filter((name) => name.includes("sismepda"))
if (dbCandidates.length !== 1) {
  fail(
    `Container database produksi tidak dapat ditentukan secara tunggal. Kandidat: ${candidates.join(", ") || "(tidak ada)"}.\n` +
      `Periksa manual, jangan biarkan skrip menebak.`,
  )
}
const productionContainer = dbCandidates[0]

const productionEnv = ssh(
  `docker exec ${productionContainer} env | grep -E '^POSTGRES_(DB|USER)='`,
  { quiet: true },
)
const productionDatabase = productionEnv.stdout.match(/^POSTGRES_DB=(.+)$/m)?.[1]?.trim()
const productionUser = productionEnv.stdout.match(/^POSTGRES_USER=(.+)$/m)?.[1]?.trim()
if (!productionDatabase || !productionUser) {
  fail(`Tidak dapat membaca POSTGRES_DB/POSTGRES_USER dari container ${productionContainer}.`)
}

console.log(`  Container produksi : ${productionContainer}`)
console.log(`  Database produksi  : ${productionDatabase}`)
console.log(`  Aplikasi terkait   : ${appContainer.stdout.split("\n").join(", ") || "(tidak terdeteksi)"}`)

// Baseline read-only sebelum dump, untuk dibandingkan setelah selesai.
const baseline = ssh(
  `docker exec ${productionContainer} psql -U ${productionUser} -d ${productionDatabase} -At ` +
    `-c "select count(*) from _prisma_migrations where finished_at is not null" ` +
    `-c "select count(*) from pg_tables where schemaname='public'" ` +
    `-c "select count(*) from \\"User\\"" -c "select count(*) from \\"Student\\""`,
  { quiet: true },
)
const [baseMigrations, baseTables, baseUsers, baseStudents] = baseline.stdout.split("\n").map((v) => v.trim())
console.log(
  `  Baseline produksi  : ${baseMigrations} migrasi, ${baseTables} tabel, ${baseUsers} user, ${baseStudents} siswa`,
)

// ---------------------------------------------------------------------------
// 4. Dump produksi (READ-ONLY)
// ---------------------------------------------------------------------------

if (SKIP_DUMP) {
  if (!existsSync(DUMP_FILE)) fail(`--reuse-dump diminta tetapi ${DUMP_FILE} tidak ada.`)
  step("Memakai ulang dump yang sudah ada (--reuse-dump); produksi tidak disentuh")
} else {
  step(`Membuat dump produksi (read-only, custom format) dari ${productionDatabase}`)
  mkdirSync(DUMP_DIR, { recursive: true })

  /**
   * `pg_dump` dijalankan di dalam container produksi, menulis ke stdout, dan
   * dialirkan langsung ke file lokal. Tidak ada file sementara yang ditinggal
   * di server produksi, dan tidak ada perintah selain pg_dump yang dikirim.
   */
  const dumpResult = spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      PRODUCTION_SSH_ALIAS,
      `docker exec ${productionContainer} pg_dump -U ${productionUser} -d ${productionDatabase} --format=custom --no-owner --no-privileges`,
    ],
    { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 * 1024 },
  )
  if (dumpResult.status !== 0) {
    fail(`pg_dump gagal: ${dumpResult.stderr?.toString().slice(0, 500)}`)
  }
  writeFileSync(DUMP_FILE, dumpResult.stdout)
  const size = statSync(DUMP_FILE).size
  if (size < 1024) fail(`Dump hanya ${size} byte — tidak masuk akal. Dibatalkan.`)
  console.log(`  Dump tersimpan: ${DUMP_FILE} (${(size / 1024 / 1024).toFixed(2)} MB)`)
}

// ---------------------------------------------------------------------------
// 5. Container clone lokal
// ---------------------------------------------------------------------------

step(`Menyiapkan container clone lokal ${CLONE_CONTAINER} (${CLONE_IMAGE}, port ${CLONE_PORT})`)

const running = docker(["ps", "--filter", `name=^${CLONE_CONTAINER}$`, "--format", "{{.Names}}"], {
  quiet: true,
})
if (running.stdout !== CLONE_CONTAINER) {
  const existsStopped = docker(
    ["ps", "-a", "--filter", `name=^${CLONE_CONTAINER}$`, "--format", "{{.Names}}"],
    { quiet: true },
  )
  if (existsStopped.stdout === CLONE_CONTAINER) {
    docker(["start", CLONE_CONTAINER], { quiet: true })
    console.log("  Container clone dihidupkan kembali.")
  } else {
    docker(
      [
        "run",
        "--detach",
        "--name",
        CLONE_CONTAINER,
        "--restart",
        "unless-stopped",
        "--publish",
        `127.0.0.1:${CLONE_PORT}:5432`,
        "--volume",
        `${CLONE_VOLUME}:/var/lib/postgresql/data`,
        "--env",
        `POSTGRES_USER=${CLONE_SUPERUSER}`,
        "--env",
        `POSTGRES_PASSWORD=${clonePassword}`,
        "--env",
        "POSTGRES_DB=postgres",
        CLONE_IMAGE,
      ],
      { quiet: true },
    )
    console.log("  Container clone dibuat.")
  }
}

/**
 * Tunggu sampai siap; tanpa ini perintah berikutnya gagal dengan pesan koneksi.
 * Jeda memakai `docker exec sleep` alih-alih `await` supaya modul tetap skrip
 * sinkron — tsconfig proyek belum mengizinkan top-level await.
 */
let ready = false
for (let attempt = 0; attempt < 90; attempt += 1) {
  /**
   * Kesiapan diuji dengan query TCP sungguhan, bukan `pg_isready` saja:
   * entrypoint image postgres menjalankan server sementara pada socket Unix
   * selama inisialisasi, sehingga `pg_isready` sudah menjawab "accepting"
   * sebelum server yang sebenarnya mendengarkan koneksi kita.
   */
  if (clonePsql("postgres", "select 1", { allowFailure: true }).ok) {
    ready = true
    break
  }
  spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { stdio: "ignore" })
}
if (!ready) fail(`Container ${CLONE_CONTAINER} tidak menjadi ready dalam 90 detik.`)

const cloneVersion = clonePsql("postgres", "show server_version").stdout
console.log(`  PostgreSQL clone siap: ${cloneVersion}`)

// ---------------------------------------------------------------------------
// 6. Recreate HANYA database clone
// ---------------------------------------------------------------------------

step(`Membuat ulang database lokal ${CLONE_DATABASE}`)

const cloneUrl = `postgresql://${CLONE_SUPERUSER}:${encodeURIComponent(clonePassword)}@localhost:${CLONE_PORT}/${CLONE_DATABASE}`
const planned = parseDatabaseUrl(cloneUrl)
if (!planned.ok) fail(planned.reason)

/**
 * Guard terakhir sebelum DROP. Memeriksa host lokal, bukan produksi, bukan
 * `sismepda_dev`, dan benar-benar bernama prodclone. Bila salah satu gagal,
 * skrip berhenti — tidak ada usaha "memperbaiki" dengan mereset database lain.
 */
assertDestroyableClone(planned.parsed)
console.log(`  Guard lolos untuk ${describeTarget(planned.parsed)}`)

/**
 * Container clone hanya berisi database clone ini. Memastikannya secara
 * eksplisit menutup kemungkinan port 5434 diambil alih container lain di masa
 * depan tanpa disadari.
 */
const inventory = clonePsql(
  "postgres",
  "select string_agg(datname, ',' order by datname) from pg_database where datistemplate = false",
).stdout
const unexpected = inventory
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name && name !== "postgres" && name !== CLONE_DATABASE)
if (unexpected.length > 0) {
  fail(
    `Container ${CLONE_CONTAINER} memuat database tak terduga: ${unexpected.join(", ")}.\n` +
      `Workflow ini menolak menghapus apa pun pada server yang tidak jelas isinya.`,
  )
}

clonePsql("postgres", `drop database if exists "${CLONE_DATABASE}" with (force)`)
clonePsql("postgres", `create database "${CLONE_DATABASE}"`)
verifyServedDatabase(clonePsql(CLONE_DATABASE, "select current_database()").stdout, CLONE_DATABASE)
console.log(`  Database ${CLONE_DATABASE} dibuat bersih.`)

// ---------------------------------------------------------------------------
// 7. Restore dump ke clone
// ---------------------------------------------------------------------------

step("Merestorasi dump produksi ke clone lokal")

docker(["cp", DUMP_FILE, `${CLONE_CONTAINER}:/tmp/production.dump`], { quiet: true })
const restore = docker(
  [
    "exec",
    "-e",
    `PGPASSWORD=${clonePassword}`,
    CLONE_CONTAINER,
    "pg_restore",
    "-h",
    "127.0.0.1",
    "-U",
    CLONE_SUPERUSER,
    "-d",
    CLONE_DATABASE,
    "--no-owner",
    "--no-privileges",
    "/tmp/production.dump",
  ],
  { quiet: true, allowFailure: true },
)
if (!restore.ok) {
  fail(`pg_restore gagal:\n${restore.stderr.slice(0, 1500)}`)
}
docker(["exec", CLONE_CONTAINER, "rm", "-f", "/tmp/production.dump"], { quiet: true })

const restoredTables = clonePsql(
  CLONE_DATABASE,
  "select count(*) from pg_tables where schemaname='public'",
).stdout
const restoredMigrations = clonePsql(
  CLONE_DATABASE,
  "select count(*) from _prisma_migrations where finished_at is not null",
).stdout
console.log(`  Restore selesai: ${restoredTables} tabel, ${restoredMigrations} migrasi tercatat.`)
if (restoredTables !== baseTables) {
  fail(`Jumlah tabel clone (${restoredTables}) berbeda dari produksi (${baseTables}).`)
}

// ---------------------------------------------------------------------------
// 8. File environment peran prodclone
// ---------------------------------------------------------------------------

step(`Menulis ${CLONE_ENV_FILE}`)
writeFileSync(
  CLONE_ENV_FILE,
  [
    "# Dibuat otomatis oleh `npm run db:refresh-prodclone`. JANGAN di-commit.",
    "#",
    "# Clone data produksi nyata: perlakukan kredensial di bawah seperti",
    "# kredensial nyata. File ini hanya memuat DATABASE_URL; variabel lain",
    "# tetap dibaca dari .env.",
    `DATABASE_URL="${cloneUrl}"`,
    "",
  ].join("\n"),
  "utf8",
)
console.log(`  ${CLONE_ENV_FILE} ditulis (sudah ter-gitignore).`)

// ---------------------------------------------------------------------------
// 9. Migrasi repo terbaru
// ---------------------------------------------------------------------------

step("Menerapkan migrasi repository terbaru (prisma migrate deploy)")

/**
 * `migrate deploy` — bukan `migrate dev`, bukan `db push`, dan tidak pernah
 * `migrate reset`. Deploy hanya menerapkan migrasi yang belum tercatat; bila
 * riwayat tidak konsisten ia gagal alih-alih menulis ulang schema, dan itulah
 * perilaku yang diinginkan: drift harus dilaporkan, bukan ditambal.
 */
const migrate = run("npx", ["prisma", "migrate", "deploy"], {
  env: { DATABASE_URL: cloneUrl },
  allowFailure: true,
})
if (!migrate.ok) {
  fail(
    "prisma migrate deploy gagal.\n" +
      "Jangan memperbaiki dengan `db push --force-reset` atau membuat migrasi baru.\n" +
      "Laporkan pesan di atas: kemungkinan drift, migrasi hilang, atau migrasi gagal di produksi.",
  )
}

const afterMigrationTables = clonePsql(
  CLONE_DATABASE,
  "select count(*) from pg_tables where schemaname='public'",
).stdout
const afterMigrations = clonePsql(
  CLONE_DATABASE,
  "select count(*) from _prisma_migrations where finished_at is not null",
).stdout
console.log(`  Setelah migrasi: ${afterMigrationTables} tabel, ${afterMigrations} migrasi.`)

// ---------------------------------------------------------------------------
// 10. Bootstrap lokal: registry RBAC, backfill, akun uji
// ---------------------------------------------------------------------------

step("Bootstrap lokal: seed registry RBAC, backfill legacy, akun uji")

/**
 * Dump produksi berasal dari schema pra-RBAC, jadi clone tidak memiliki role,
 * permission, maupun keanggotaan. Tanpa tiga langkah ini aplikasi dapat login
 * tetapi tanpa satu pun izin. Urutannya mengikuti jalur forward yang sudah
 * didokumentasikan di docs/operations/development.md.
 */
run("npx", ["prisma", "db", "seed"], { env: { DATABASE_URL: cloneUrl } })

const backfill = run(
  "npx",
  ["tsx", "prisma/rbac-backfill-legacy.ts", "--apply", `--database=${CLONE_DATABASE}`],
  { env: { DATABASE_URL: cloneUrl }, allowFailure: true },
)
if (!backfill.ok) {
  fail("Backfill RBAC legacy gagal. Clone dibiarkan apa adanya; tidak ada reset otomatis.")
}

/**
 * Akun uji lokal memakai script yang sudah ada. Guard di
 * `lib/local-test-user.ts` membatasi nama database ke allowlist development,
 * jadi prodclone ikut disertakan di allowlist itu — bukan dengan melemahkan
 * guard, tetapi dengan menambahkan satu nama database lokal yang eksplisit.
 */
const testUser = run("npx", ["tsx", "scripts/ensure-local-test-user.ts"], {
  env: { DATABASE_URL: cloneUrl },
  allowFailure: true,
})
if (!testUser.ok) {
  console.warn(
    "  CATATAN: akun uji lokal tidak dibuat. Periksa ALLOW_LOCAL_TEST_USER dan DEV_TEST_USER_* di .env.",
  )
}

// ---------------------------------------------------------------------------
// 11. Validasi
// ---------------------------------------------------------------------------

step("Validasi clone")

const counts = clonePsql(
  CLONE_DATABASE,
  'select (select count(*) from "User"), (select count(*) from "Student"), ' +
    '(select count(*) from "Role"), (select count(*) from "UserRole")',
).stdout.split("|")
console.log(`  User ${counts[0]} · Student ${counts[1]} · Role ${counts[2]} · UserRole ${counts[3]}`)

if (counts[0] !== baseUsers) {
  console.warn(
    `  CATATAN: jumlah User clone (${counts[0]}) berbeda dari produksi (${baseUsers}); akun uji lokal menambah satu baris.`,
  )
}
if (counts[1] !== baseStudents) {
  fail(`Jumlah Student clone (${counts[1]}) tidak sama dengan produksi (${baseStudents}).`)
}

// ---------------------------------------------------------------------------
// 12. Produksi harus tetap sama
// ---------------------------------------------------------------------------

step("Memastikan produksi tidak berubah")

const after = ssh(
  `docker exec ${productionContainer} psql -U ${productionUser} -d ${productionDatabase} -At ` +
    `-c "select count(*) from _prisma_migrations where finished_at is not null" ` +
    `-c "select count(*) from pg_tables where schemaname='public'" ` +
    `-c "select count(*) from \\"User\\"" -c "select count(*) from \\"Student\\""`,
  { quiet: true },
)
const afterValues = after.stdout.split("\n").map((v) => v.trim())
const beforeValues = [baseMigrations, baseTables, baseUsers, baseStudents]
if (afterValues.join("|") !== beforeValues.join("|")) {
  fail(
    `Produksi berubah selama proses: sebelum ${beforeValues.join("/")} vs sesudah ${afterValues.join("/")}.\n` +
      `Ini tidak boleh terjadi — laporkan segera.`,
  )
}
console.log(`  Produksi identik: ${afterValues.join(" / ")} (migrasi/tabel/user/siswa)`)

// ---------------------------------------------------------------------------
// 13. Bersihkan dump
// ---------------------------------------------------------------------------

if (KEEP_DUMP) {
  console.log(`\n  Dump dipertahankan atas permintaan: ${DUMP_FILE}`)
} else {
  rmSync(DUMP_DIR, { recursive: true, force: true })
  console.log("\n  Dump sementara dihapus.")
}

console.log(
  [
    "",
    "Selesai. Clone siap dipakai:",
    "",
    "  npm run dev:prodclone      # jalankan aplikasi di atas clone",
    "  npm run dev:local          # kembali ke database development",
    "",
    `Database development ${databaseTargets.local.expectedDatabase} tidak disentuh sama sekali.`,
    "",
  ].join("\n"),
)
