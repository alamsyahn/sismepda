import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  MINUTES_PER_DAY,
  formatMinuteOfDay,
  parseTimeOfDay,
  scheduleDayFromSchoolDate,
  toTimeInputValue,
} from "../lib/schedule-constants"
import {
  DEFAULT_TIME_SLOTS,
  currentSlot,
  defaultPeriodForNow,
  lessonSlots,
  slotByPeriod,
  validateTimeSlot,
  validateTimeStructure,
  type TimeSlot,
} from "../lib/schedule-time"
import { schoolMinutesOfDay, todayInSchoolTimeZone } from "../lib/school-date"

function slot(partial: Partial<TimeSlot> & { id: string }): TimeSlot {
  return {
    position: 1,
    kind: "PELAJARAN",
    name: "Jam ke-1",
    startMinute: 7 * 60,
    endMinute: 7 * 60 + 40,
    ascPeriod: 1,
    ...partial,
  }
}

const PROFILE: TimeSlot[] = DEFAULT_TIME_SLOTS.map((row, index) => ({ ...row, id: `s${index + 1}` }))

test("jam dinding diurai dan dicetak tanpa melibatkan Date", () => {
  assert.equal(parseTimeOfDay("07:00"), 420)
  assert.equal(parseTimeOfDay("7:05"), 425)
  assert.equal(parseTimeOfDay("23:59"), 1439)
  assert.equal(parseTimeOfDay("24:00"), null)
  assert.equal(parseTimeOfDay("07:60"), null)
  assert.equal(parseTimeOfDay("pagi"), null)
  assert.equal(parseTimeOfDay(null), null)

  assert.equal(formatMinuteOfDay(420), "07.00")
  assert.equal(formatMinuteOfDay(MINUTES_PER_DAY), "-")
  assert.equal(toTimeInputValue(425), "07:05")
})

test("hari sekolah dihitung dari tanggal, dan Minggu bukan hari sekolah", () => {
  // 2026-09-16 adalah Rabu.
  assert.equal(scheduleDayFromSchoolDate("2026-09-16"), 3)
  assert.equal(scheduleDayFromSchoolDate("2026-09-14"), 1)
  assert.equal(scheduleDayFromSchoolDate("2026-09-19"), 6)
  assert.equal(scheduleDayFromSchoolDate("2026-09-20"), null)
  assert.equal(scheduleDayFromSchoolDate("bukan-tanggal"), null)
})

test("slot pelajaran wajib punya nomor jam; istirahat justru tidak boleh", () => {
  assert.equal(validateTimeSlot(slot({ id: "a" })), null)
  assert.ok(validateTimeSlot(slot({ id: "a", ascPeriod: null })))
  assert.ok(validateTimeSlot(slot({ id: "a", kind: "ISTIRAHAT", ascPeriod: 3 })))
  assert.equal(validateTimeSlot(slot({ id: "a", kind: "ISTIRAHAT", ascPeriod: null })), null)
})

test("jam selesai harus setelah jam mulai dan nama wajib diisi", () => {
  assert.ok(validateTimeSlot(slot({ id: "a", startMinute: 500, endMinute: 500 })))
  assert.ok(validateTimeSlot(slot({ id: "a", startMinute: 500, endMinute: 400 })))
  assert.ok(validateTimeSlot(slot({ id: "a", name: "   " })))
})

test("struktur menolak tumpang tindih walau posisinya berjauhan", () => {
  const problems = validateTimeStructure([
    slot({ id: "a", position: 1, startMinute: 420, endMinute: 460, ascPeriod: 1 }),
    slot({ id: "b", position: 9, name: "Jam ke-2", startMinute: 450, endMinute: 500, ascPeriod: 2 }),
  ])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /bertabrakan/)
})

test("nomor jam dan urutan tidak boleh dipakai dua slot", () => {
  const problems = validateTimeStructure([
    slot({ id: "a", position: 1, startMinute: 420, endMinute: 460, ascPeriod: 1 }),
    slot({ id: "b", position: 1, name: "Jam ke-2", startMinute: 460, endMinute: 500, ascPeriod: 1 }),
  ])
  assert.ok(problems.some((row) => /Urutan 1/.test(row)))
  assert.ok(problems.some((row) => /Nomor jam 1/.test(row)))
})

test("struktur bawaan sah dan bersambung tanpa tabrakan", () => {
  assert.deepEqual(validateTimeStructure(PROFILE), [])
})

test("nomor period aSc diterjemahkan menjadi jam dinding SISMEPDA", () => {
  const map = slotByPeriod(PROFILE)
  assert.equal(map.get(1)?.startMinute, 7 * 60)
  assert.equal(map.get(4)?.startMinute, 9 * 60 + 20) // setelah istirahat
  assert.equal(map.get(4)?.name, "Jam ke-4")
  // Istirahat tidak pernah menempati nomor period.
  assert.equal(lessonSlots(PROFILE).length, 8)
})

test("deteksi jam sekarang membedakan pelajaran, istirahat, dan di luar jam", () => {
  assert.deepEqual(currentSlot(PROFILE, 7 * 60 + 10), {
    state: "lesson",
    slot: PROFILE[0],
    period: 1,
  })

  const istirahat = currentSlot(PROFILE, 9 * 60 + 5)
  assert.equal(istirahat.state, "break")

  assert.deepEqual(currentSlot(PROFILE, 5 * 60), { state: "outside" })
  assert.deepEqual(currentSlot(PROFILE, 20 * 60), { state: "outside" })
})

test("pada menit pergantian, yang berlaku adalah slot berikutnya", () => {
  const result = currentSlot(PROFILE, 7 * 60 + 40)
  assert.equal(result.state, "lesson")
  assert.equal(result.state === "lesson" ? result.period : null, 2)
})

test("default filter jam kosong hanya terisi bila sekarang jam pelajaran", () => {
  assert.equal(defaultPeriodForNow(PROFILE, 7 * 60 + 10), 1)
  // Saat istirahat tidak ada default: berpura-pura ada "jam kosong" menyesatkan.
  assert.equal(defaultPeriodForNow(PROFILE, 9 * 60 + 5), null)
  assert.equal(defaultPeriodForNow(PROFILE, 20 * 60), null)
})

test("menit sekarang diproyeksikan ke zona waktu sekolah, bukan waktu server", () => {
  // 2026-09-16T00:30:00Z = 07.30 WIB pada hari yang sama.
  const instant = new Date("2026-09-16T00:30:00.000Z")

  assert.equal(schoolMinutesOfDay(instant, "Asia/Jakarta"), 7 * 60 + 30)
  assert.equal(todayInSchoolTimeZone(instant, "Asia/Jakarta"), "2026-09-16")

  // Jam yang sama di UTC masih 00.30 dan BUKAN jam pelajaran — inilah bug yang
  // muncul bila menit dihitung dari waktu server.
  assert.equal(schoolMinutesOfDay(instant, "UTC"), 30)
  assert.equal(currentSlot(PROFILE, schoolMinutesOfDay(instant, "Asia/Jakarta")).state, "lesson")
  assert.equal(currentSlot(PROFILE, schoolMinutesOfDay(instant, "UTC")).state, "outside")
})

test("pergantian hari WIB terjadi sebelum pergantian hari UTC", () => {
  // 2026-09-16T17:00:00Z = 2026-09-17 pukul 00.00 WIB.
  const instant = new Date("2026-09-16T17:00:00.000Z")
  assert.equal(todayInSchoolTimeZone(instant, "Asia/Jakarta"), "2026-09-17")
  assert.equal(todayInSchoolTimeZone(instant, "UTC"), "2026-09-16")

  assert.equal(scheduleDayFromSchoolDate(todayInSchoolTimeZone(instant, "Asia/Jakarta")), 4)
})

test("zona waktu lain tetap dihormati (tidak ada +07:00 yang ditanam)", () => {
  const instant = new Date("2026-09-16T00:30:00.000Z")
  assert.equal(schoolMinutesOfDay(instant, "Asia/Makassar"), 8 * 60 + 30)
  assert.equal(schoolMinutesOfDay(instant, "Asia/Jayapura"), 9 * 60 + 30)
})
