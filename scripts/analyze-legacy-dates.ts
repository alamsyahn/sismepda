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

console.log(`Menganalisis ${describeTarget(decision.parsed)}\n`)

const sql = readFileSync(ANALYSIS_SQL, "utf8")
const result = spawnSync(
  "docker",
  [
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
    decision.parsed.database,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ],
  { input: sql, encoding: "utf8" },
)

if (result.status !== 0) {
  fail(`psql gagal:\n${result.stderr?.slice(0, 1500) ?? "(tanpa stderr)"}`)
}

console.log(result.stdout)
