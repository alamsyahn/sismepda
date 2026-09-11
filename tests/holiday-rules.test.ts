import { test } from "node:test"
import assert from "node:assert/strict"
import { requireSchoolDate, type SchoolDate } from "../lib/school-date"
import {
  holidayNameFor,
  resolveHoliday,
  weekdayOf,
  type HolidayRule,
  type WeekdayIndex,
} from "../lib/holiday-rules"

const d = (value: string): SchoolDate => requireSchoolDate(value)

const single = (date: string, name: string): HolidayRule => ({
  id: `s-${date}`,
  kind: "SINGLE",
  name,
  date: d(date),
  weekday: null,
  startDate: null,
  endDate: null,
})

const recurring = (
  weekday: WeekdayIndex,
  name: string,
  startDate: string | null,
  endDate: string | null,
): HolidayRule => ({
  id: `r-${weekday}-${startDate ?? "awal"}`,
  kind: "RECURRING",
  name,
  date: null,
  weekday,
  startDate: startDate ? d(startDate) : null,
  endDate: endDate ? d(endDate) : null,
})

const schoolDay = (date: string, name: string): HolidayRule => ({
  id: `o-${date}`,
  kind: "SCHOOL_DAY",
  name,
  date: d(date),
  weekday: null,
  startDate: null,
  endDate: null,
})

test("weekdayOf membaca tanggal sebagai UTC", () => {
  // 2026-09-06 adalah hari Minggu.
  assert.equal(weekdayOf(d("2026-09-06")), 0)
  assert.equal(weekdayOf(d("2026-09-07")), 1)
  assert.equal(weekdayOf(d("2026-09-05")), 6)
})

test("libur biasa hanya berlaku pada tanggalnya", () => {
  const rules = [single("2026-08-17", "HUT RI")]
  assert.equal(holidayNameFor(d("2026-08-17"), rules), "HUT RI")
  assert.equal(holidayNameFor(d("2026-08-18"), rules), null)
})

test("libur tetap berulang setiap pekan", () => {
  const rules = [recurring(0, "Hari Minggu", "2026-07-01", null)]
  assert.equal(holidayNameFor(d("2026-09-06"), rules), "Hari Minggu")
  assert.equal(holidayNameFor(d("2026-09-13"), rules), "Hari Minggu")
  assert.equal(holidayNameFor(d("2026-09-07"), rules), null)
})

test("libur tetap tanpa batas akhir berlaku selamanya", () => {
  const rules = [recurring(0, "Hari Minggu", "2026-07-01", null)]
  assert.equal(holidayNameFor(d("2040-01-01"), rules), "Hari Minggu")
})

test("libur tetap menghormati batas awal dan batas akhir", () => {
  const rules = [recurring(6, "Sabtu libur", "2026-07-01", "2026-08-31")]
  assert.equal(holidayNameFor(d("2026-06-27"), rules), null, "sebelum batas awal")
  assert.equal(holidayNameFor(d("2026-07-04"), rules), "Sabtu libur")
  assert.equal(holidayNameFor(d("2026-08-29"), rules), "Sabtu libur", "tepat di batas akhir")
  assert.equal(holidayNameFor(d("2026-09-05"), rules), null, "setelah batas akhir")
})

test("hari masuk khusus membatalkan libur tetap", () => {
  const rules = [
    recurring(0, "Hari Minggu", "2026-07-01", null),
    schoolDay("2026-09-06", "Kegiatan tengah semester"),
  ]
  assert.equal(holidayNameFor(d("2026-09-06"), rules), null)
  assert.equal(holidayNameFor(d("2026-09-13"), rules), "Hari Minggu", "pekan lain tetap libur")
})

test("hari masuk khusus membatalkan libur biasa", () => {
  const rules = [single("2026-08-17", "HUT RI"), schoolDay("2026-08-17", "Upacara")]
  assert.equal(holidayNameFor(d("2026-08-17"), rules), null)
})

test("hari masuk khusus menang walau terdaftar lebih dulu", () => {
  // Urutan masukan tidak boleh mengubah hasil.
  const rules = [schoolDay("2026-09-06", "Upacara"), recurring(0, "Hari Minggu", null, null)]
  assert.equal(holidayNameFor(d("2026-09-06"), rules), null)
})

test("alasan pertama yang cocok yang dilaporkan", () => {
  const rules = [single("2026-09-06", "Libur nasional"), recurring(0, "Hari Minggu", null, null)]
  const verdict = resolveHoliday(d("2026-09-06"), rules)
  assert.equal(verdict.isHoliday, true)
  assert.equal(verdict.reason, "Libur nasional")
})

test("tanpa aturan, semua hari adalah hari masuk", () => {
  assert.equal(resolveHoliday(d("2026-09-06"), []).isHoliday, false)
})
