/**
 * Populasi guru bersumber tunggal pada `User.isTeacher` di SELURUH modul server.
 *
 * File-file ini menyentuh database, sehingga yang diuji adalah TEKS SUMBERNYA:
 * tidak boleh ada lagi filter populasi memakai kolom legacy `User.role`.
 * Pemeriksaan murni statis dan tidak butuh koneksi database.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/** Modul server yang memilih target berdasarkan "apakah dia guru". */
const POPULATION_MODULES = [
  "../lib/server-teacher-profile.ts",
  "../lib/server-workbook.ts",
  "../app/api/teachers/[teacherId]/duties/route.ts",
  "../app/api/teachers/[teacherId]/schedule/route.ts",
] as const

for (const relative of POPULATION_MODULES) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8")

  test(`${relative} tidak memfilter populasi dengan kolom legacy role`, () => {
    assert.ok(
      !/role:\s*\{\s*in:\s*\[/.test(source),
      `${relative} masih memfilter populasi dengan role IN (...)`,
    )
  })

  test(`${relative} memakai helper populasi tunggal`, () => {
    assert.ok(
      source.includes("teacherPopulationWhere"),
      `${relative} harus memakai teacherPopulationWhere() sebagai sumber tunggal`,
    )
  })
}
