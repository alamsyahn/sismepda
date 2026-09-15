/**
 * Kontrak jalur eksekusi migrasi media legacy di produksi.
 *
 * Migrasi ini menulis berkas ke volume media kanonik lalu memperbarui referensi
 * database. Jalur eksekusinya harus dibekukan: satu salah ketik `--dry-run`
 * berarti migrasi produksi sungguhan, dan mount yang salah berarti database
 * menunjuk kunci yang berkasnya hilang begitu container sekali-jalan dibuang.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { production } from "@/lib/deployment"
import {
  banner,
  decideMode,
  remoteMediaMigrationScript,
  scriptArgsFor,
  scriptFor,
  writesData,
} from "@/lib/media-migration-command"

const overlay = readFileSync("compose.media.yaml", "utf8")

function script(mode: "dry-run" | "apply" | "verify"): string {
  return remoteMediaMigrationScript({
    appDir: production.appDir,
    composeFile: production.composeFile,
    mediaComposeFile: production.mediaComposeFile,
    envFile: production.envFile,
    service: production.migratorService,
    profile: production.migratorProfile,
    mediaRoot: production.mediaRoot,
    mode,
  })
}

// ---------------------------------------------------------------------------
// Mode: fail closed
// ---------------------------------------------------------------------------

test("tanpa mode, perintah menolak alih-alih memilih default", () => {
  // Default yang menulis akan memigrasikan produksi pada percobaan pertama
  // operator yang hanya ingin melihat pemakaiannya.
  const decision = decideMode([])
  assert.equal(decision.ok, false)
})

test("mode yang saling bertentangan ditolak, bukan ditebak", () => {
  assert.equal(decideMode(["--dry-run", "--apply"]).ok, false)
})

test("hanya --apply yang mengaktifkan penulisan", () => {
  assert.equal(writesData("apply"), true)
  assert.equal(writesData("dry-run"), false)
  assert.equal(writesData("verify"), false)
})

test("dry-run meneruskan --dry-run ke skrip migrasi", () => {
  assert.equal(scriptFor("dry-run"), "scripts/migrate-media.ts")
  assert.deepEqual(scriptArgsFor("dry-run"), ["--dry-run"])
})

test("apply tidak pernah membawa flag --dry-run", () => {
  assert.deepEqual(scriptArgsFor("apply"), [])
})

test("verify memakai skrip verifikasi, bukan skrip migrasi", () => {
  assert.equal(scriptFor("verify"), "scripts/verify-media-migration.ts")
})

// ---------------------------------------------------------------------------
// Spanduk
// ---------------------------------------------------------------------------

test("spanduk menyatakan target dan status tulis tanpa menyamarkannya", () => {
  const text = banner({
    mode: "dry-run",
    database: "db @ smpn2",
    mediaRoot: "/app/media",
    service: "migrate",
  })
  assert.match(text, /PRODUCTION/)
  assert.match(text, /DRY RUN/)
  assert.match(text, /Write .*DISABLED/)
  assert.match(text, /Delete .*DISABLED/)
})

test("spanduk apply mengakui penulisan aktif", () => {
  const text = banner({ mode: "apply", database: "db @ smpn2", mediaRoot: "/app/media", service: "migrate" })
  assert.match(text, /Write .*ENABLED/)
})

test("spanduk tidak pernah memuat DATABASE_URL atau kredensial", () => {
  const text = banner({ mode: "dry-run", database: "db @ smpn2", mediaRoot: "/app/media", service: "migrate" })
  assert.doesNotMatch(text, /postgres(ql)?:\/\//)
  assert.doesNotMatch(text, /password|PASSWORD/)
})

// ---------------------------------------------------------------------------
// Skrip remote
// ---------------------------------------------------------------------------

test("skrip remote menjalankan perkakas di dalam container migrator", () => {
  const text = script("dry-run")
  assert.match(text, /docker compose/)
  assert.match(text, new RegExp(`run --rm[^\\n]*${production.migratorService}`))
  assert.match(text, new RegExp(`--profile ${production.migratorProfile}`))
})

test("skrip remote memakai kedua file compose, termasuk overlay media", () => {
  // Tanpa overlay, migrator berjalan tanpa volume media dan menulis ke
  // writable layer container yang lenyap saat --rm.
  const text = script("dry-run")
  assert.match(text, new RegExp(`-f ${production.composeFile}`))
  assert.match(text, new RegExp(`-f ${production.mediaComposeFile}`))
})

test("skrip remote membatalkan bila overlay media tidak ada", () => {
  assert.match(script("dry-run"), /ABORT: compose\.media\.yaml tidak ada/)
})

test("skrip remote memverifikasi skrip dan executor ada di dalam image", () => {
  const text = script("dry-run")
  assert.match(text, /ABORT: scripts\/migrate-media\.ts tidak ada di image migrator/)
  assert.match(text, /ABORT: npx tidak tersedia di image migrator/)
})

test("skrip remote menolak akar media yang bukan mount", () => {
  // Direktori biasa milik image lolos `test -d` tetapi hilang bersama container.
  const text = script("dry-run")
  assert.match(text, /bukan mount/)
  assert.match(text, /stat -c %d/)
})

test("skrip remote gagal cepat, tidak menelan error pipa", () => {
  assert.match(script("dry-run"), /set -euo pipefail/)
})

test("dry-run remote tidak pernah memanggil skrip tanpa --dry-run", () => {
  const text = script("dry-run")
  assert.match(text, /npx tsx scripts\/migrate-media\.ts --dry-run/)
})

test("skrip remote tidak memuat perintah destruktif", () => {
  for (const mode of ["dry-run", "apply", "verify"] as const) {
    const text = script(mode)
    for (const forbidden of [/down -v/, /volume rm/, /volume prune/, /DROP /, /TRUNCATE/, /rm -rf/]) {
      assert.doesNotMatch(text, forbidden, `mode ${mode} tidak boleh memuat ${forbidden}`)
    }
  }
})

test("skrip remote tidak menanamkan rahasia; env dibaca dari file host", () => {
  const text = script("dry-run")
  assert.match(text, new RegExp(`--env-file ${production.envFile}`))
  assert.doesNotMatch(text, /PASSWORD=/)
  assert.doesNotMatch(text, /postgres(ql)?:\/\//)
})

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

test("migrator memakai volume media yang SAMA dengan app", () => {
  // Volume terpisah membuat berkas hasil migrasi tidak pernah terbaca aplikasi.
  const mounts = overlay.match(/- media:\/app\/media/g) ?? []
  assert.ok(mounts.length >= 2, "app dan migrator harus sama-sama mount volume media")
})

test("overlay memasang media pada service migrator", () => {
  const start = overlay.indexOf(`  ${production.migratorService}:`)
  assert.ok(start > 0, "service migrator harus ada di overlay")
  const rest = overlay.slice(start)
  const next = rest.indexOf("\nvolumes:")
  const block = next === -1 ? rest : rest.slice(0, next)
  assert.match(block, /MEDIA_STORAGE_ROOT: \/app\/media/)
  assert.match(block, /- media:\/app\/media/)
})

test("titik mount migrator sama dengan MEDIA_STORAGE_ROOT kanonik", () => {
  assert.equal(production.mediaRoot, "/app/media")
  assert.match(overlay, new RegExp(`- media:${production.mediaRoot}`))
})

test("overlay memakai volume bernama kanonik, bukan volume migrasi terpisah", () => {
  assert.match(overlay, new RegExp(`name: ${production.mediaVolume}`))
  assert.doesNotMatch(overlay, /migration[-_]media/)
})

test("overlay tidak mengekspos port database", () => {
  // Isolasi jaringan tidak boleh dilemahkan demi migrasi.
  assert.doesNotMatch(overlay, /5432/)
  assert.doesNotMatch(overlay, /^\s*ports:/m)
})

test("overlay tidak mengubah isolasi internal jaringan database", () => {
  assert.doesNotMatch(overlay, /internal:\s*false/)
})
