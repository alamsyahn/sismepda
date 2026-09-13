/**
 * Kontrak route restore: preflight harus mendahului perintah destruktif.
 *
 * Menguji TEKS SUMBER `app/api/admin/database/route.ts`. Alasannya: kegagalan
 * yang ingin dicegah bersifat urutan (TRUNCATE sudah terkirim sebelum arsip
 * divalidasi), dan mengeksekusi route asli berarti benar-benar men-TRUNCATE
 * database. Test ini mengunci urutan dan keberadaan guard tanpa risiko itu;
 * perilaku end-to-end-nya diverifikasi terpisah oleh
 * `scripts/verify-backup-roundtrip.ts`.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = readFileSync("app/api/admin/database/route.ts", "utf8")

test("route restore memanggil preflight kompatibilitas", () => {
  assert.match(source, /evaluateRestorePreflight/)
})

test("backup mengecualikan tabel migrasi dengan pola berkualifikasi schema", () => {
  // `--exclude-table=_prisma_migrations` tanpa prefiks schema hanya cocok di
  // `public`. Pada deployment dengan schema khusus tabel migrasi tetap terbawa,
  // sehingga arsip hasil backup sendiri ditolak oleh preflight restore.
  assert.match(source, /--exclude-table=\*\._prisma_migrations/)
  assert.doesNotMatch(source, /--exclude-table=_prisma_migrations/)
})

test("preflight dievaluasi sebelum TRUNCATE disusun", () => {
  const preflightAt = source.indexOf("evaluateRestorePreflight")
  const truncateAt = source.indexOf("TRUNCATE")

  assert.ok(preflightAt > 0, "preflight harus dipanggil")
  assert.ok(truncateAt > 0, "TRUNCATE harus ada di route restore")
  assert.ok(
    preflightAt < truncateAt,
    "preflight wajib dievaluasi sebelum TRUNCATE disusun, bukan setelahnya",
  )
})

test("preflight dievaluasi sebelum psql dijalankan", () => {
  const preflightAt = source.indexOf("evaluateRestorePreflight")
  const psqlAt = source.indexOf('"psql"')

  assert.ok(psqlAt > 0, "psql harus dipanggil oleh restore")
  assert.ok(preflightAt < psqlAt, "preflight wajib mendahului eksekusi psql")
})

test("arsip tidak kompatibel menghentikan request dengan 409", () => {
  // 409 Conflict: arsip sah tetapi bertentangan dengan skema target.
  assert.match(source, /status:\s*409/)
})

test("backup menyertakan tabel RBAC sehingga arsip baru lolos preflight", () => {
  // pg_dump data-only tanpa --table mencakup semua tabel; yang harus dijaga
  // adalah tidak adanya exclude atas tabel RBAC wajib.
  for (const table of ["UserRole", "RbacRole", "RolePermission", "RbacMigration", "Permission"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`--exclude-table=${table}\\b`),
      `${table} tidak boleh dikecualikan dari backup`,
    )
  }
})

test("header format backup memakai konstanta preflight yang sama", () => {
  // Mencegah backup dan preflight menyimpang: keduanya harus memakai satu
  // sumber kebenaran untuk penanda format.
  assert.match(source, /SUPPORTED_BACKUP_FORMAT/)
})
