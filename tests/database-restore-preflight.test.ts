/**
 * Preflight kompatibilitas arsip restore.
 *
 * Konteks keamanan: `POST /api/admin/database` menjalankan
 * `TRUNCATE ... RESTART IDENTITY CASCADE` atas tabel yang terdaftar di arsip.
 * Setelah RBAC, `TRUNCATE "User" ... CASCADE` ikut mengosongkan `UserRole`
 * (FK onDelete: Cascade) sementara arsip pra-RBAC tidak memuat baris RBAC
 * untuk dipulihkan. Hasilnya: database kehilangan seluruh keanggotaan role,
 * termasuk system_admin — tidak ada lagi yang bisa mengelola akses.
 *
 * Karena itu kompatibilitas harus diputuskan SEBELUM perintah destruktif
 * pertama, dari daftar isi arsip secara menyeluruh, bukan dari satu tabel.
 *
 * Nama tabel di bawah diverifikasi langsung terhadap database (pg_tables),
 * bukan diturunkan dari nama model Prisma: hanya `Role` yang di-@@map ke
 * `RbacRole`; `UserRole` dan `RolePermission` memakai nama modelnya.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { evaluateRestorePreflight, REQUIRED_RBAC_TABLES } from "@/lib/database-restore-preflight"

/** Daftar tabel dari arsip pasca-RBAC yang sehat. */
function postRbacTables(): string[] {
  return ["Student", "AttendanceDay", ...REQUIRED_RBAC_TABLES]
}

test("arsip pasca-RBAC yang lengkap diterima", () => {
  const result = evaluateRestorePreflight({
    archiveTables: postRbacTables(),
    formatHeader: "postgresql-data-v1",
  })

  assert.equal(result.compatible, true)
})

test("arsip pra-RBAC ditolak sebelum ada perintah destruktif", () => {
  const result = evaluateRestorePreflight({
    archiveTables: ["User", "Student", "AttendanceDay"],
    formatHeader: "postgresql-data-v1",
  })

  assert.equal(result.compatible, false)
  assert.equal(result.reason, "rbac-tables-missing")
  assert.ok(result.missingTables.includes("UserRole"))
  assert.ok(result.missingTables.includes("RbacRole"))
})

test("arsip yang kehilangan sebagian tabel RBAC tetap ditolak", () => {
  // Kasus paling berbahaya: memeriksa satu tabel saja akan lolos karena
  // RbacRole hadir, padahal keanggotaan (UserRole) tidak ikut terbawa.
  const result = evaluateRestorePreflight({
    archiveTables: ["User", "RbacRole", "Permission", "RolePermission", "RbacMigration"],
    formatHeader: "postgresql-data-v1",
  })

  assert.equal(result.compatible, false)
  assert.equal(result.reason, "rbac-tables-missing")
  assert.deepEqual(result.missingTables, ["UserRole"])
})

test("arsip tanpa tabel sama sekali ditolak", () => {
  const result = evaluateRestorePreflight({ archiveTables: [], formatHeader: "postgresql-data-v1" })

  assert.equal(result.compatible, false)
  assert.equal(result.reason, "no-table-data")
})

test("format arsip yang tidak dikenal ditolak", () => {
  const result = evaluateRestorePreflight({
    archiveTables: postRbacTables(),
    formatHeader: "postgresql-data-v0",
  })

  assert.equal(result.compatible, false)
  assert.equal(result.reason, "format-unsupported")
})

test("arsip tanpa penanda format tetap dinilai dari isinya", () => {
  // Penanda format dikirim client dan karena itu tidak tepercaya; arsip
  // PostgreSQL sendiri tidak membawa metadata versi aplikasi. Ketiadaan
  // penanda tidak boleh memblokir arsip yang isinya terbukti lengkap,
  // dan tidak boleh meloloskan arsip yang isinya tidak lengkap.
  const lengkap = evaluateRestorePreflight({ archiveTables: postRbacTables(), formatHeader: null })
  assert.equal(lengkap.compatible, true)

  const praRbac = evaluateRestorePreflight({ archiveTables: ["User", "Student"], formatHeader: null })
  assert.equal(praRbac.compatible, false)
  assert.equal(praRbac.reason, "rbac-tables-missing")
})

test("arsip yang memuat tabel migrasi ditolak", () => {
  const result = evaluateRestorePreflight({
    archiveTables: [...postRbacTables(), "_prisma_migrations"],
    formatHeader: "postgresql-data-v1",
  })

  assert.equal(result.compatible, false)
  assert.equal(result.reason, "migration-table-present")
})

test("daftar tabel wajib mencakup identitas, role, permission, keanggotaan, dan state migrasi", () => {
  // Mengunci cakupan: kehilangan salah satu tabel ini menghancurkan akses
  // secara diam-diam, jadi tidak boleh dipersempit tanpa mengubah test ini.
  for (const table of ["User", "RbacRole", "Permission", "UserRole", "RolePermission", "RbacMigration"]) {
    assert.ok(REQUIRED_RBAC_TABLES.includes(table), `${table} wajib ada di REQUIRED_RBAC_TABLES`)
  }
})

test("urutan tabel pada arsip tidak memengaruhi keputusan", () => {
  const result = evaluateRestorePreflight({
    archiveTables: [...postRbacTables()].reverse(),
    formatHeader: "postgresql-data-v1",
  })

  assert.equal(result.compatible, true)
})
