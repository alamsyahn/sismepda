/**
 * Analisis read-only tanggal bisnis legacy `AttendanceDay` (TD-014).
 *
 * Menjalankan `prisma/legacy-date-analysis.sql` terhadap database clone.
 * Skrip ini tidak pernah menulis: ia hanya melaporkan berapa baris yang akan
 * digeser, pasangan mana yang bertabrakan, dan konflik mana yang butuh
 * keputusan manusia.
 *
 * Guard sengaja sama ketatnya dengan alur destruktif: analisis hanya boleh
 * menunjuk database clone lokal, tidak pernah produksi maupun `sismepda_dev`.
 *
 * CLI: `npm run db:analyze-legacy-dates:prodclone`. Target ada di namanya
 * karena skrip ini membaca `.env.prodclone` langsung, bukan lewat
 * `scripts/with-db.ts`, sehingga peran tidak terlihat dari perintah tanpa
 * sufiks itu.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  assertDestroyableClone,
  describeTarget,
  parseDatabaseUrl,
  parseEnvFile,
} from "@/lib/database-target"
import {
  businessDateColumnTypeQuery,
  parseBusinessDateColumnTypes,
  planLegacyDateRepair,
} from "@/lib/legacy-date-repair"

const CLONE_ENV_FILE = resolve(process.cwd(), ".env.prodclone")
const ANALYSIS_SQL = resolve(process.cwd(), "prisma/legacy-date-analysis.sql")

function fail(message: string): never {
  console.error(`\nABORT: ${message}`)
  process.exit(1)
}

let envText: string
try {
  envText = readFileSync(CLONE_ENV_FILE, "utf8")
} catch {
  fail(`${CLONE_ENV_FILE} belum ada. Jalankan \`npm run db:prodclone:refresh\` lebih dulu.`)
}

const url = parseEnvFile(envText).DATABASE_URL
if (!url) fail("DATABASE_URL tidak ditemukan di .env.prodclone.")

const decision = parseDatabaseUrl(url)
if (!decision.ok) fail(decision.reason)

// Memakai guard yang sama dengan operasi destruktif: kalau target bukan clone
// lokal, berhenti. Analisis read-only pun tidak boleh menyentuh produksi.
try {
  assertDestroyableClone(decision.parsed)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

// Password tidak pernah keluar dari parser (desain anti-bocor), jadi diambil
// langsung dari URL hanya untuk diteruskan sebagai environment ke psql.
const credentials = new URL(url)

// Narrowing `decision` tidak bertahan di dalam closure, dan target clone memang
// hanya perlu ditetapkan sekali setelah seluruh guard lolos.
const target = decision.parsed

console.log(`Menganalisis ${describeTarget(target)}\n`)

/**
 * Argumen psql yang dipakai dua kali: sekali untuk membaca tipe kolom, sekali
 * untuk analisis penuh. Dibuat sebagai fungsi supaya kredensial tidak pernah
 * disalin ke lebih dari satu tempat.
 */
function psqlArgs(): string[] {
  return [
    "exec",
    "-i",
    "-e",
    `PGPASSWORD=${decodeURIComponent(credentials.password)}`,
    "sismepda-prodclone-db",
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    decodeURIComponent(credentials.username),
    "-d",
    target.database,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ]
}

/**
 * `prisma/legacy-date-analysis.sql` membaca `date::time`, yang hanya ada pada
 * schema pra-migrasi date-only. Terhadap clone modern kolomnya sudah bertipe
 * `date` dan cast itu tidak ada di PostgreSQL. Statusnya ditentukan dari
 * metadata schema — sama seperti yang dilakukan refresh — supaya perintah ini
 * melaporkan keadaan sebenarnya alih-alih gagal dengan error cast.
 */
const typeProbe = spawnSync("docker", psqlArgs(), {
  input: businessDateColumnTypeQuery(),
  encoding: "utf8",
})
if (typeProbe.status !== 0) {
  fail(`Gagal membaca tipe kolom tanggal bisnis:\n${typeProbe.stderr?.slice(0, 1500) ?? ""}`)
}
const observed = parseBusinessDateColumnTypes(typeProbe.stdout ?? "")
if (!observed) fail("Tipe kolom tanggal bisnis tidak dapat dibaca dari schema clone.")

const plan = planLegacyDateRepair(observed)
if (plan.action === "abort") fail(plan.reason)
if (plan.action === "skip") {
  console.log(`Tidak ada yang dianalisis.\n\n${plan.reason}`)
  process.exit(0)
}

const sql = readFileSync(ANALYSIS_SQL, "utf8")
const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" })

if (result.status !== 0) {
  fail(`psql gagal:\n${result.stderr?.slice(0, 1500) ?? "(tanpa stderr)"}`)
}

console.log(result.stdout)
