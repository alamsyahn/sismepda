/**
 * Bootstrap database development SETELAH restore production → local selesai.
 *
 * `npm run dev:bootstrap [-- --seed=12345]`
 *
 * Urutan:
 *   1. verifikasi database benar-benar development (guard fail-closed);
 *   2. pastikan akun uji lokal ada — memakai mekanisme yang sudah ada
 *      (`scripts/ensure-local-test-user.ts`), bukan sistem akun paralel baru;
 *   3. generate data uji E-UKS;
 *   4. tampilkan ringkasan.
 *
 * Script ini TIDAK pernah melakukan restore database. Mengambil dump produksi
 * dan me-restore-nya ke lokal tetap proses manual terpisah; arah sinkronisasi
 * hanya PRODUCTION → LOCAL, tidak pernah sebaliknya.
 */
import "dotenv/config"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { REFUSAL_PREFIX, planEuksTestData } from "../lib/euks-test-data"
import { planLocalTestUser } from "../lib/local-test-user"

const LOG = "[dev:bootstrap]"
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli")

// Guard dievaluasi lebih dulu supaya bootstrap berhenti sebelum langkah apa pun
// dijalankan, bukan setelah satu script sudah menulis.
const decision = planEuksTestData(process.env)
if (!decision.ok) {
  console.error(`${LOG} ${REFUSAL_PREFIX}`)
  console.error(`${LOG} Alasan: ${decision.reason}`)
  console.error(`${LOG} Tidak ada langkah yang dijalankan.`)
  process.exit(1)
}

const plan = decision.plan
console.log(`${LOG} Target development terverifikasi: host=${plan.databaseHost} db=${plan.databaseName}`)

function run(label: string, script: string, args: string[] = []): void {
  console.log("")
  console.log(`${LOG} ${label}`)
  // tsx dipanggil lewat resolusi modul, bukan lewat shell: argumen tidak
  // pernah digabung menjadi string perintah sehingga tidak ada celah injeksi,
  // dan jalurnya sama di Windows maupun Linux tanpa bergantung pada biner
  // `npx` milik package manager tertentu.
  const result = spawnSync(process.execPath, [tsxCli, script, ...args], {
    stdio: "inherit",
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`${LOG} Langkah "${label}" gagal. Bootstrap dihentikan.`)
    process.exit(result.status ?? 1)
  }
}

// Akun uji lokal punya guard-nya sendiri (ALLOW_LOCAL_TEST_USER). Bila operator
// sengaja tidak mengaktifkannya, langkah ini dilewati alih-alih menggagalkan
// bootstrap: data E-UKS tetap dapat dibuat untuk akun yang sudah ada.
const testUser = planLocalTestUser(process.env)
if (testUser.ok) {
  run("Memastikan akun uji lokal", "scripts/ensure-local-test-user.ts")
} else {
  console.log(`${LOG} Akun uji lokal dilewati: ${testUser.reason}`)
}

run("Generate data uji E-UKS", "scripts/generate-euks-test-data.ts", process.argv.slice(2))

console.log("")
console.log(`${LOG} Selesai. Database: ${plan.databaseName} (development).`)
