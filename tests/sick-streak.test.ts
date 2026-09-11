import { test } from "node:test"
import assert from "node:assert/strict"
import { addSchoolDays, requireSchoolDate, type SchoolDate } from "../lib/school-date"
import { MAX_HOLIDAY_GAP, sickStreakLengths, streakTone } from "../lib/sick-streak"

const d = (value: string): SchoolDate => requireSchoolDate(value)
const days = (...values: string[]) => values.map((value) => ({ date: d(value) }))

test("hari berurutan menjadi satu rentetan", () => {
  assert.deepEqual(sickStreakLengths(days("2026-02-02", "2026-02-03", "2026-02-04"), []), [3, 3, 3])
})

test("hari terpisah tetap satu hari masing-masing", () => {
  assert.deepEqual(sickStreakLengths(days("2026-02-02", "2026-02-05"), []), [1, 1])
})

/** Contoh yang diminta: sakit 7, 8, 10 dengan 9 libur = 3 hari berturut-turut. */
test("hari libur dianggap tidak ada sehingga rentetan tersambung", () => {
  const result = sickStreakLengths(
    days("2026-02-07", "2026-02-08", "2026-02-10"),
    [d("2026-02-09")],
  )
  assert.deepEqual(result, [3, 3, 3])
})

test("tanpa hari libur terdaftar, celah tanggal memutus rentetan", () => {
  const result = sickStreakLengths(days("2026-02-07", "2026-02-08", "2026-02-10"), [])
  assert.deepEqual(result, [2, 2, 1])
})

test("beberapa hari libur berturut-turut tetap tersambung", () => {
  const result = sickStreakLengths(
    days("2026-02-06", "2026-02-09"),
    [d("2026-02-07"), d("2026-02-08")],
  )
  assert.deepEqual(result, [2, 2])
})

/** Sekolah ini masuk hari Sabtu, jadi akhir pekan tidak boleh dilewati diam-diam. */
test("akhir pekan tidak dilewati kecuali terdaftar sebagai libur", () => {
  // 2026-02-07 Sabtu, 2026-02-08 Minggu, 2026-02-09 Senin.
  assert.deepEqual(sickStreakLengths(days("2026-02-07", "2026-02-09"), []), [1, 1])
  assert.deepEqual(
    sickStreakLengths(days("2026-02-07", "2026-02-09"), [d("2026-02-08")]),
    [2, 2],
  )
})

test("urutan masukan dipertahankan meski tanggal menurun", () => {
  const result = sickStreakLengths(days("2026-02-04", "2026-02-03", "2026-02-02"), [])
  assert.deepEqual(result, [3, 3, 3])
})

test("tanggal kembar tidak menggandakan hitungan", () => {
  const result = sickStreakLengths(days("2026-02-02", "2026-02-02", "2026-02-03"), [])
  assert.deepEqual(result, [2, 2, 2])
})

test("melewati batas tahun", () => {
  assert.deepEqual(sickStreakLengths(days("2025-12-31", "2026-01-01"), []), [2, 2])
})

test("libur yang sangat panjang tidak menyambungkan dua episode", () => {
  // Libur menutup seluruh celah, tetapi lebih panjang dari batas lompatan.
  const first = d("2026-03-01")
  const holidays: SchoolDate[] = []
  for (let step = 1; step <= MAX_HOLIDAY_GAP + 2; step += 1) {
    holidays.push(addSchoolDays(first, step))
  }
  const second = addSchoolDays(first, MAX_HOLIDAY_GAP + 3)
  const result = sickStreakLengths([{ date: first }, { date: second }], holidays)
  assert.deepEqual(result, [1, 1])
})

test("libur yang masih dalam batas tetap menyambungkan", () => {
  const first = d("2026-03-01")
  const holidays: SchoolDate[] = []
  for (let step = 1; step <= 3; step += 1) holidays.push(addSchoolDays(first, step))
  const second = addSchoolDays(first, 4)
  const result = sickStreakLengths([{ date: first }, { date: second }], holidays)
  assert.deepEqual(result, [2, 2])
})

test("daftar kosong menghasilkan hasil kosong", () => {
  assert.deepEqual(sickStreakLengths([], []), [])
})

test("penandaan warna mengikuti ambang yang disepakati", () => {
  assert.equal(streakTone(1), "none")
  assert.equal(streakTone(2), "warning")
  assert.equal(streakTone(3), "danger")
  assert.equal(streakTone(9), "danger")
})
