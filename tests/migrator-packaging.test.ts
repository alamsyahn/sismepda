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
