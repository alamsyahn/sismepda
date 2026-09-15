/**
 * Kontrak packaging image migrator.
 *
 * Image migrator menjalankan migrasi, seed, sinkronisasi registry RBAC, dan
 * backfill legacy one-time. Kalau berkas yang dibutuhkan perintah-perintah itu
 * tidak ikut ter-COPY, kegagalannya baru muncul saat cutover — ketika aplikasi
 * lama sudah dihentikan. Test ini menguji Dockerfile sebagai kontrak build.
 *
 * Bukti eksekusi yang melatarbelakangi test ini: menjalankan
 * `tsx prisma/rbac-backfill-legacy.ts` pada direktori yang meniru COPY stage
 * migrator gagal dengan `Cannot find module '@/lib/rbac-legacy'`, karena
 * `tsconfig.json` (pemilik path alias `@/*`) tidak ikut disalin.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const dockerfile = readFileSync("Dockerfile", "utf8")

/** Baris COPY pada stage migrator saja. */
function migratorStage(): string {
  const start = dockerfile.indexOf("AS migrator")
  assert.ok(start > 0, "stage migrator harus ada")
  const rest = dockerfile.slice(start)
  const nextStage = rest.indexOf("\nFROM ")
  return nextStage === -1 ? rest : rest.slice(0, nextStage)
}

test("stage migrator menyalin tsconfig.json untuk resolusi alias @/", () => {
  // prisma/rbac-backfill-legacy.ts → lib/rbac-backfill.ts → "@/lib/rbac-legacy".
  // tsx membaca path alias dari tsconfig.json; tanpa berkas itu backfill gagal
  // MODULE_NOT_FOUND saat dijalankan di dalam image.
  assert.match(migratorStage(), /COPY .*tsconfig\.json/)
})

test("stage migrator menyertakan skrip backfill legacy", () => {
  // Backfill berada di prisma/, jadi COPY prisma sudah mencakupnya.
  assert.match(migratorStage(), /COPY prisma \.\/prisma/)
})

test("stage migrator menyertakan lib yang diimpor seed dan backfill", () => {
  assert.match(migratorStage(), /COPY lib \.\/lib/)
})

test("stage migrator menyertakan Prisma client hasil generate", () => {
  assert.match(migratorStage(), /COPY --from=builder \/app\/app\/generated/)
})

test("perintah default migrator memakai migrate deploy, bukan dev/push/reset", () => {
  const stage = migratorStage()
  assert.match(stage, /prisma migrate deploy/)
  assert.doesNotMatch(stage, /migrate dev/)
  assert.doesNotMatch(stage, /db push/)
  assert.doesNotMatch(stage, /migrate reset/)
})

test("perintah default migrator tidak menjalankan backfill legacy otomatis", () => {
  // Backfill harus dipicu operator secara eksplisit dengan --apply --database=,
  // bukan ikut berjalan pada deploy/seed normal.
  assert.doesNotMatch(migratorStage(), /rbac-backfill-legacy/)
})

test("stage migrator menyertakan scripts/ untuk perkakas operasional", () => {
  // Migrasi media legacy hanya dapat dijalankan di produksi dari dalam image
  // ini: runner adalah build standalone Next tanpa tsx, dan database produksi
  // berada di jaringan internal tanpa port terbuka. Tanpa COPY ini,
  // `npm run media:migrate:production` gagal karena skripnya tidak ada.
  assert.match(migratorStage(), /COPY scripts \.\/scripts/)
})

test("perintah default migrator tidak menjalankan migrasi media otomatis", () => {
  // Deploy hanya boleh MENYEDIAKAN perkakasnya. Migrasi media legacy adalah
  // operasi sekali-jalan yang dipicu operator setelah backup lengkap, bukan
  // efek samping rilis rutin. Yang diuji adalah CMD — bukan komentar, yang
  // memang menyebut nama skrip untuk menjelaskan alasan COPY di atasnya.
  const cmd = migratorStage()
    .split("\n")
    .filter((line) => line.startsWith("CMD") || line.startsWith("ENTRYPOINT"))
    .join("\n")
  assert.ok(cmd.length > 0, "stage migrator harus punya CMD")
  assert.doesNotMatch(cmd, /migrate-media/)
  assert.doesNotMatch(cmd, /media:migrate/)
})

test("stage runner tetap lean: tidak ikut menyalin scripts/", () => {
  // scripts/ hanya berguna bila ada tsx; runner tidak punya tsx, jadi
  // menyalinnya ke sana hanya memperbesar permukaan image produksi.
  const start = dockerfile.indexOf("AS runner")
  assert.ok(start > 0, "stage runner harus ada")
  const rest = dockerfile.slice(start)
  const nextStage = rest.indexOf("\nFROM ")
  const runnerStage = nextStage === -1 ? rest : rest.slice(0, nextStage)
  assert.doesNotMatch(runnerStage, /COPY scripts/)
})
