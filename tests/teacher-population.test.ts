/**
 * Populasi guru bersumber tunggal pada `User.isTeacher`.
 *
 * Kolom legacy `User.role` TIDAK ikut menentukan keanggotaan populasi. Test ini
 * mengunci keputusan itu: menambahkan kembali cabang `role = "GURU"` akan
 * memerahkannya.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { teacherPopulationWhere } from "../lib/teacher-population"

test("populasi guru hanya memeriksa isTeacher", () => {
  assert.deepEqual(teacherPopulationWhere(), { isTeacher: true })
})

test("filter tidak menyebut kolom legacy sama sekali", () => {
  // Serialisasi dipakai supaya cabang `role` yang bersarang di mana pun
  // tetap tertangkap, bukan hanya pada level teratas.
  const serialized = JSON.stringify(teacherPopulationWhere())
  assert.ok(!serialized.includes("role"), `filter masih menyebut role: ${serialized}`)
  assert.ok(!serialized.includes("GURU"), `filter masih menyebut GURU: ${serialized}`)
})
