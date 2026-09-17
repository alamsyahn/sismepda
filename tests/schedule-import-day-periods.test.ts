/**
 * Regresi untuk validasi impor aSc terhadap struktur waktu PER HARI.
 *
 * Bug yang dijaga: validator mengukur seluruh pekan dengan daftar jam milik
 * SATU hari (hari pertama yang terkonfigurasi, yaitu Senin). Sekolah yang
 * memakai Senin 1–7 tetapi Selasa–Kamis/Sabtu 1–8 jadi diblokir dengan pesan
 * "Jam ke-8 belum ada pada Waktu & Kegiatan", padahal jam ke-8 memang ada pada
 * setiap hari yang benar-benar memakainya. Lebih berbahaya lagi, jalur apply
 * memakai penyaring yang sama sehingga kartu jam ke-8 dibuang diam-diam.
 *
 * Yang benar adalah kombinasi (hari, jam) yang betul-betul dipakai <card>.
 */
import { strict as assert } from "node:assert"
import { test } from "node:test"

import { missingDayPeriodPairs } from "@/lib/server-schedule-import"
import { daysFromMask } from "@/lib/asc-timetable-parser"
import { resolveSlotForDayPeriod, type ProfileDay } from "@/lib/schedule-time"

/** Satu hari dengan jam pelajaran 1..maxPeriod. */
function day(dayNumber: number, maxPeriod: number): ProfileDay {
  return {
    id: `day-${dayNumber}`,
    day: dayNumber,
    position: dayNumber,
    slots: Array.from({ length: maxPeriod }, (_, index) => ({
      id: `slot-${dayNumber}-${index + 1}`,
      position: index + 1,
      kind: "PELAJARAN" as const,
      name: `Jam ke-${index + 1}`,
      startMinute: 420 + index * 40,
      endMinute: 460 + index * 40,
      ascPeriod: index + 1,
    })),
  }
}

/**
 * Struktur waktu nyata yang memicu laporan:
 * Senin 1–7, Selasa–Kamis 1–8, Jumat 1–5, Sabtu 1–8.
 */
const SCHOOL_DAYS: ProfileDay[] = [day(1, 7), day(2, 8), day(3, 8), day(4, 8), day(5, 5), day(6, 8)]

function placement(dayNumber: number, period: number) {
  return {
    lessonId: `l-${dayNumber}-${period}`,
    classExternalId: "C1",
    subjectExternalId: "S1",
    teacherExternalId: "T1",
    room: null,
    day: dayNumber,
    period,
  }
}

// --- A. hari dengan jumlah jam berbeda -------------------------------------

test("jam ke-8 diterima pada hari yang memakainya walau Senin hanya sampai 7", () => {
  // Persis seperti JADWAL(1).xml: period 8 hanya pada Selasa, Rabu, Kamis, Sabtu.
  const placements = [placement(2, 8), placement(3, 8), placement(4, 8), placement(6, 8)]
  assert.deepEqual(missingDayPeriodPairs(placements, SCHOOL_DAYS), [])
})

test("Senin max 7, Jumat max 5 tidak dianggap kurang bila XML tidak memakai jam itu", () => {
  const placements = [
    placement(1, 7), // Senin berhenti di jam ke-7
    placement(5, 5), // Jumat berhenti di jam ke-5
    placement(2, 8),
    placement(6, 8),
  ]
  assert.deepEqual(missingDayPeriodPairs(placements, SCHOOL_DAYS), [])
})

test("Sabtu boleh dipakai sebagian kelas saja pada jam 7–8", () => {
  // Hanya sebagian kelas memakai jam 7 dan 8; sisanya selesai lebih awal.
  const placements = [
    { ...placement(6, 7), classExternalId: "C1" },
    { ...placement(6, 8), classExternalId: "C1" },
    { ...placement(6, 6), classExternalId: "C2" },
  ]
  assert.deepEqual(missingDayPeriodPairs(placements, SCHOOL_DAYS), [])
})

test("seluruh kombinasi JADWAL(1).xml lolos tanpa blocker", () => {
  const placements: ReturnType<typeof placement>[] = []
  const maxPerDay: Record<number, number> = { 1: 7, 2: 8, 3: 8, 4: 8, 5: 5, 6: 8 }
  for (const [dayNumber, max] of Object.entries(maxPerDay)) {
    for (let period = 1; period <= max; period += 1) placements.push(placement(Number(dayNumber), period))
  }
  assert.deepEqual(missingDayPeriodPairs(placements, SCHOOL_DAYS), [])
})

// --- B. kekurangan yang nyata tetap dilaporkan -----------------------------

test("kombinasi yang benar-benar hilang dilaporkan per hari", () => {
  // Sabtu hanya sampai jam ke-7, tetapi XML memakai jam ke-8 pada Sabtu.
  const days = [day(1, 7), day(2, 8), day(3, 8), day(4, 8), day(5, 5), day(6, 7)]
  const missing = missingDayPeriodPairs([placement(2, 8), placement(6, 8)], days)
  assert.deepEqual(missing, [{ day: 6, period: 8 }])
})

test("laporan tidak menyebut hari yang tidak memakai jam tersebut", () => {
  const days = [day(1, 7), day(2, 7), day(3, 8), day(4, 8), day(5, 5), day(6, 8)]
  const missing = missingDayPeriodPairs([placement(2, 8), placement(3, 8)], days)
  // Hanya Selasa yang kurang. Senin dan Jumat tidak boleh ikut disebut.
  assert.deepEqual(missing, [{ day: 2, period: 8 }])
  assert.equal(
    missing.some((pair) => pair.day === 1 || pair.day === 5),
    false,
  )
})

test("kombinasi hilang tidak diduplikasi dan terurut hari lalu jam", () => {
  const days = [day(1, 6), day(2, 6), day(3, 8), day(4, 8), day(5, 5), day(6, 8)]
  const placements = [placement(2, 8), placement(2, 8), placement(1, 7), placement(2, 7)]
  assert.deepEqual(missingDayPeriodPairs(placements, days), [
    { day: 1, period: 7 },
    { day: 2, period: 7 },
    { day: 2, period: 8 },
  ])
})

test("hari yang belum dikonfigurasi sama sekali dilaporkan, bukan diabaikan", () => {
  const days = [day(1, 7), day(2, 8)] // Sabtu belum ada
  assert.deepEqual(missingDayPeriodPairs([placement(6, 1)], days), [{ day: 6, period: 1 }])
})

// --- C. penjaga: logika lama memang gagal ----------------------------------

test("logika lama (daftar jam satu hari) akan menolak jam ke-8 secara keliru", () => {
  // Meniru perilaku sebelum perbaikan: ukur seluruh pekan dengan hari pertama.
  const seninPeriods = new Set(SCHOOL_DAYS[0].slots.map((slot) => slot.ascPeriod as number))
  const placements = [placement(2, 8), placement(3, 8), placement(4, 8), placement(6, 8)]
  const lamaMenolak = placements.filter((row) => !seninPeriods.has(row.period))

  assert.equal(lamaMenolak.length, 4, "logika lama membuang keempat kartu jam ke-8")
  // Logika baru menerima semuanya — inilah perbedaan yang dijaga test ini.
  assert.deepEqual(missingDayPeriodPairs(placements, SCHOOL_DAYS), [])
})

// --- D. hari berasal dari atribut days, bukan dari urutan ------------------

test("atribut days aSc dipetakan ke hari yang benar", () => {
  assert.deepEqual(daysFromMask("100000"), [1]) // Senin
  assert.deepEqual(daysFromMask("010000"), [2]) // Selasa
  assert.deepEqual(daysFromMask("001000"), [3]) // Rabu
  assert.deepEqual(daysFromMask("000100"), [4]) // Kamis
  assert.deepEqual(daysFromMask("000001"), [6]) // Sabtu
})

test("kartu yang berlaku pada beberapa hari dicek pada tiap hari itu", () => {
  // days="011000" → Selasa dan Rabu; keduanya punya jam ke-8.
  const days = daysFromMask("011000")
  assert.deepEqual(days, [2, 3])
  const placements = days.map((dayNumber) => placement(dayNumber, 8))
  assert.deepEqual(missingDayPeriodPairs(placements, SCHOOL_DAYS), [])
})

test("waktu aktual diambil dari Waktu & Kegiatan, bukan dari period XML", () => {
  // Hari yang sama, nomor jam yang sama, jam mulai berbeda per hari.
  const pagi = day(2, 8)
  const siang: ProfileDay = {
    ...day(6, 8),
    slots: day(6, 8).slots.map((slot) => ({
      ...slot,
      startMinute: slot.startMinute + 60,
      endMinute: slot.endMinute + 60,
    })),
  }
  const selasa = resolveSlotForDayPeriod([pagi, siang], 2, 8)
  const sabtu = resolveSlotForDayPeriod([pagi, siang], 6, 8)
  assert.ok(selasa && sabtu)
  assert.notEqual(selasa.startMinute, sabtu.startMinute)
})
