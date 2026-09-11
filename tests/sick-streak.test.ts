import { test } from "node:test"
import assert from "node:assert/strict"
import { addSchoolDays, requireSchoolDate, type SchoolDate } from "../lib/school-date"
import { MAX_HOLIDAY_GAP, sickStreakLengths, streakTone } from "../lib/sick-streak"

const d = (value: string): SchoolDate => requireSchoolDate(value)
const days = (...values: string[]) => values.map((value) => ({ date: d(value) }))

test("hari berurutan dinomori maju dari hari pertama", () => {
  assert.deepEqual(sickStreakLengths(days("2026-02-02", "2026-02-03", "2026-02-04"), []), [1, 2, 3])
})

test("tanggal yang berjauhan masing-masing kembali ke hari pertama", () => {
  assert.deepEqual(sickStreakLengths(days("2026-02-02", "2026-02-05"), []), [1, 1])
})

test("hari libur di tengah tidak memutus penomoran", () => {
  // Contoh dari permintaan: sakit 7, 8, 10 dengan 9 libur = hari ke-1, 2, 3.
  const result = sickStreakLengths(days("2026-02-07", "2026-02-08", "2026-02-10"), [d("2026-02-09")])
  assert.deepEqual(result, [1, 2, 3])
})

test("tanpa hari libur, tanggal yang bolong memulai rentetan baru", () => {
  const result = sickStreakLengths(days("2026-02-07", "2026-02-08", "2026-02-10"), [])
  assert.deepEqual(result, [1, 2, 1])
})

test("beberapa hari libur berurutan tetap menyambung", () => {
  const result = sickStreakLengths(
    days("2026-02-06", "2026-02-11"),
    [d("2026-02-07"), d("2026-02-08"), d("2026-02-09"), d("2026-02-10")],
  )
  assert.deepEqual(result, [1, 2])
})

test("kasus dari layar: dua episode dipisah satu tanggal kosong", () => {
  // 26-29 Agustus lalu 31 Agustus-5 September, tanpa entri 30 Agustus.
  const result = sickStreakLengths(
    days(
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ),
    [],
  )
  assert.deepEqual(result, [1, 2, 3, 4, 1, 2, 3, 4, 5, 6])
})

test("kasus dari layar dengan 30 Agustus sebagai hari libur", () => {
  // Minggu 30 Agustus didaftarkan libur: kedua episode menyatu jadi satu.
  const result = sickStreakLengths(
    days(
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-31",
      "2026-09-01",
    ),
    [d("2026-08-30")],
  )
  assert.deepEqual(result, [1, 2, 3, 4, 5, 6])
})

test("urutan masukan tidak mengubah hasil", () => {
  const result = sickStreakLengths(days("2026-02-04", "2026-02-03", "2026-02-02"), [])
  assert.deepEqual(result, [3, 2, 1], "nomor mengikuti tanggal, bukan posisi baris")
})

test("tanggal kembar tidak menggandakan hitungan", () => {
  const result = sickStreakLengths(days("2026-02-02", "2026-02-02", "2026-02-03"), [])
  assert.deepEqual(result, [1, 1, 2])
})

test("rentetan melintasi pergantian bulan dan tahun", () => {
  assert.deepEqual(sickStreakLengths(days("2025-12-31", "2026-01-01"), []), [1, 2])
})

test("libur yang sangat panjang tidak menyambungkan dua episode", () => {
  // Libur menutup seluruh celah, tetapi lebih panjang dari batas lompatan.
  const first = d("2026-03-01")
  const holidays: SchoolDate[] = []
  for (let offset = 1; offset <= MAX_HOLIDAY_GAP + 1; offset += 1) {
    holidays.push(addSchoolDays(first, offset))
  }
  const second = addSchoolDays(first, MAX_HOLIDAY_GAP + 2)
  const result = sickStreakLengths([{ date: first }, { date: second }], holidays)
  assert.deepEqual(result, [1, 1], "di atas batas dianggap episode terpisah")
})

test("libur tepat pada batas lompatan masih menyambung", () => {
  const first = d("2026-03-01")
  const holidays: SchoolDate[] = []
  for (let offset = 1; offset <= MAX_HOLIDAY_GAP; offset += 1) {
    holidays.push(addSchoolDays(first, offset))
  }
  const second = addSchoolDays(first, MAX_HOLIDAY_GAP + 1)
  const result = sickStreakLengths([{ date: first }, { date: second }], holidays)
  assert.deepEqual(result, [1, 2])
})

test("daftar kosong menghasilkan daftar kosong", () => {
  assert.deepEqual(sickStreakLengths([], []), [])
})

test("warna mengikuti nomor hari pada baris itu", () => {
  assert.equal(streakTone(1), "none", "hari pertama tidak diberi warna")
  assert.equal(streakTone(2), "warning")
  assert.equal(streakTone(3), "danger")
  assert.equal(streakTone(9), "danger")
})
