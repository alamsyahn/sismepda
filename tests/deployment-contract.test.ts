/**
 * Kontrak deploy: seed tidak boleh memicu backfill, readiness tidak boleh
 * dinyatakan palsu, dan rilis pertama tidak boleh memuat migrasi kontraksi.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { evaluateReadiness } from "@/lib/rbac-readiness"
import { LEGACY_BACKFILL_KEY } from "@/lib/rbac-legacy"

test("seed tidak memanggil backfill legacy", () => {
  // Backfill menulis keanggotaan role dari flag legacy. Menjalankannya otomatis
  // pada tiap deploy akan memulihkan grant yang sudah sengaja dicabut admin.
  //
  // Komentar dokumentasi dibuang lebih dulu agar test menilai kode, bukan
  // kalimat yang justru menjelaskan bahwa seed TIDAK melakukan backfill.
  const tanpaKomentar = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  const seed = tanpaKomentar(readFileSync("prisma/seed.ts", "utf8"))
  const seedRbac = tanpaKomentar(readFileSync("prisma/seed-rbac.ts", "utf8"))

  for (const [name, source] of [["seed.ts", seed], ["seed-rbac.ts", seedRbac]] as const) {
    assert.doesNotMatch(source, /rbac-backfill/, `${name} tidak boleh mengimpor backfill`)
    assert.doesNotMatch(source, /runLegacyBackfill/, `${name} tidak boleh menjalankan backfill`)
  }
})

test("seed tidak menulis marker readiness", () => {
  // Marker COMPLETED membuat guard RBAC menganggap sistem siap. Hanya backfill
  // yang benar-benar selesai yang boleh menulisnya; seed tidak.
  const tanpaKomentar = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  const seed = tanpaKomentar(readFileSync("prisma/seed.ts", "utf8"))
  const seedRbac = tanpaKomentar(readFileSync("prisma/seed-rbac.ts", "utf8"))

  for (const source of [seed, seedRbac]) {
    assert.doesNotMatch(source, /rbacMigration\s*\.\s*(create|upsert|update)/)
    assert.doesNotMatch(source, new RegExp(LEGACY_BACKFILL_KEY))
  }
})

test("backfill hanya menulis bila --apply disertai nama database", () => {
  const cli = readFileSync("prisma/rbac-backfill-legacy.ts", "utf8")

  assert.match(cli, /--apply membutuhkan --database=/)
  // Nama database diketik operator dan dicocokkan dengan current_database(),
  // sehingga .env yang salah tidak bisa diam-diam menulis ke target lain.
  assert.match(cli, /current_database/)
  assert.match(cli, /REFUSED/)
  assert.match(cli, /mode: apply \? "apply" : "dry-run"/)
})

test("database legacy tanpa marker tidak dianggap siap", () => {
  // Jalur forward: DB lama punya akun tetapi belum di-backfill.
  const readiness = evaluateReadiness({ backfill: null, userCount: 52 })

  assert.equal(readiness.state, "not-ready")
  assert.equal(readiness.reason, "backfill-missing")
})

test("database bootstrap segar dianggap siap tanpa backfill", () => {
  // Jalur fresh: tidak ada akun legacy yang bisa kehilangan akses.
  const readiness = evaluateReadiness({ backfill: null, userCount: 0 })

  assert.equal(readiness.state, "ready")
  assert.equal(readiness.reason, "fresh-database")
})

test("backfill yang belum selesai tidak menyatakan siap", () => {
  for (const status of ["RUNNING", "FAILED"] as const) {
    const readiness = evaluateReadiness({
      backfill: { key: LEGACY_BACKFILL_KEY, status },
      userCount: 52,
    })
    assert.equal(readiness.state, "not-ready", `status ${status} tidak boleh siap`)
  }
})

test("marker dengan key tak dikenal fail closed", () => {
  const readiness = evaluateReadiness({
    backfill: { key: "marker-palsu", status: "COMPLETED" },
    userCount: 52,
  })

  assert.equal(readiness.state, "error")
})

test("daftar migrasi rilis pertama tidak memuat kontraksi kolom legacy", () => {
  // Kontraksi (DROP COLUMN/TYPE atas otorisasi legacy) adalah proyek terpisah
  // setelah produksi stabil. Rilis ini harus additive sepenuhnya agar aplikasi
  // lama tetap valid terhadap skema baru sebelum cutover.
  const dir = "prisma/migrations"
  const terlarang: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sql = readFileSync(join(dir, entry.name, "migration.sql"), "utf8")

    for (const kolom of ["role", "canViewBos", "canEditBos", "canViewSarpras", "canViewEuks", "canManageTeacherProfiles"]) {
      const pola = new RegExp(`DROP\\s+COLUMN\\s+(IF\\s+EXISTS\\s+)?"?${kolom}"?`, "i")
      if (pola.test(sql)) terlarang.push(`${entry.name}: DROP COLUMN ${kolom}`)
    }
    if (/DROP\s+TYPE\s+(IF\s+EXISTS\s+)?"?LegacyRole"?/i.test(sql)) {
      terlarang.push(`${entry.name}: DROP TYPE LegacyRole`)
    }
  }

  assert.deepEqual(terlarang, [], `migrasi kontraksi belum boleh ada: ${terlarang.join(", ")}`)
})

test("kolom bisnis non-otorisasi tidak ikut didrop", () => {
  // isTeacher dan workbookSupervised adalah data bisnis, bukan flag otorisasi
  // legacy; keduanya tetap dipakai runtime dan tidak boleh terbawa kontraksi.
  const dir = "prisma/migrations"
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sql = readFileSync(join(dir, entry.name, "migration.sql"), "utf8")
    for (const kolom of ["isTeacher", "workbookSupervised"]) {
      assert.doesNotMatch(
        sql,
        new RegExp(`DROP\\s+COLUMN\\s+(IF\\s+EXISTS\\s+)?"?${kolom}"?`, "i"),
        `${entry.name} tidak boleh mendrop ${kolom}`,
      )
    }
  }
})
