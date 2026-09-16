/**
 * Penjagaan hari libur pada pengiriman WhatsApp otomatis.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Hari libur adalah keadaan DI ATAS seluruh kondisi laporan: bukan "kirim pesan
 * lain", melainkan "jangan kirim apa pun". Karena itu yang diuji di sini bukan
 * bunyi pesannya, melainkan bahwa tidak satu pun dari empat kondisi template
 * dapat lolos pada tanggal yang dinyatakan libur oleh sistem hari efektif yang
 * sudah dipakai SISMEPDA.
 *
 * `sendWhatsAppMessage` tidak dapat diimpor di sini: berkasnya menarik Prisma,
 * dan lewat `tsx --test` itu berarti membuka koneksi basis data sungguhan.
 * Karena itu penempatan penjagaannya dijaga pada sumbernya — sama seperti
 * urutan klaim-sebelum-kirim di `whatsapp-idempotency.test.ts` — sementara
 * keputusan liburnya sendiri diuji langsung pada `resolveHoliday`, fungsi murni
 * yang memang dipanggil jalur itu.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { resolveHoliday, type HolidayRule } from "../lib/holiday-rules.js"
import type { SchoolDate } from "../lib/school-date.js"

const SOURCE = readFileSync(new URL("../lib/server-whatsapp.ts", import.meta.url), "utf8")

function schoolDate(value: string): SchoolDate {
  return value as unknown as SchoolDate
}

function rule(overrides: Partial<HolidayRule> & Pick<HolidayRule, "kind" | "name">): HolidayRule {
  return {
    id: `r-${overrides.name}`,
    date: null,
    weekday: null,
    startDate: null,
    endDate: null,
    ...overrides,
  }
}

/**
 * Akhir pekan pun berasal dari kalender, bukan dari nomor hari.
 *
 * Hari Sabtu di bawah ini libur karena sekolah mencatatnya sebagai libur tetap
 * (`RECURRING`), bukan karena kodenya menganggap Sabtu selalu libur.
 */
const RULES: HolidayRule[] = [
  rule({ kind: "RECURRING", name: "Libur akhir pekan", weekday: 6 }),
  rule({ kind: "SINGLE", name: "Libur nasional", date: schoolDate("2026-09-17") }),
]

const WEEKDAY = schoolDate("2026-09-16") // Rabu
const WEEKEND = schoolDate("2026-09-19") // Sabtu
const NATIONAL = schoolDate("2026-09-17")

// --- 17: hari efektif tetap berjalan ---------------------------------------

test("hari efektif tidak dianggap libur, sehingga pengiriman dapat berlanjut", () => {
  const verdict = resolveHoliday(WEEKDAY, RULES)
  assert.equal(verdict.isHoliday, false)
})

// --- 18: tanggal libur menurut sistem existing ------------------------------

test("akhir pekan menurut aturan sekolah dinyatakan libur", () => {
  const verdict = resolveHoliday(WEEKEND, RULES)
  assert.equal(verdict.isHoliday, true)
})

test("tanggal merah pada kalender sekolah dinyatakan libur beserta alasannya", () => {
  const verdict = resolveHoliday(NATIONAL, RULES)
  assert.equal(verdict.isHoliday, true)
  assert.equal(verdict.reason, "Libur nasional")
})

test("hari efektif yang ditetapkan sekolah mengalahkan akhir pekan", () => {
  // Sekolah dapat menjadwalkan kegiatan pada hari Sabtu. Penjagaan ini harus
  // memakai keputusan kalender sekolah, bukan nomor hari dalam sepekan.
  const verdict = resolveHoliday(WEEKEND, [
    ...RULES,
    rule({ kind: "SCHOOL_DAY", name: "Kegiatan sekolah", date: schoolDate("2026-09-19") }),
  ])
  assert.equal(verdict.isHoliday, false)
})

// --- 19-22: tak satu pun dari empat template lolos pada hari libur ----------

/**
 * Keempat kondisi template berbagi SATU penjagaan.
 *
 * Inilah alasan uji 19-22 tidak berupa empat skenario pengiriman yang berbeda:
 * pada `sendWhatsAppMessage`, penjagaan hari libur berada SEBELUM laporan
 * dibaca, sehingga kondisi mana yang akan terpilih bahkan belum dihitung ketika
 * pengiriman dibatalkan. Yang menjaga keempatnya karena itu adalah urutan di
 * bawah ini, bukan empat cabang terpisah.
 */
test("penjagaan hari libur berada sebelum laporan dibaca dan sebelum template dipilih", () => {
  // Yang dicari adalah PEMANGGILAN composeMessage di dalam alur pengiriman,
  // bukan definisinya — definisinya berada lebih dulu di berkas ini.
  const sendAt = SOURCE.indexOf("export async function sendWhatsAppMessage")
  const body = SOURCE.slice(sendAt)

  const holidayAt = body.indexOf('reason: "HOLIDAY"')
  const composeAt = body.indexOf("await composeMessage(")
  const claimAt = body.indexOf('status: "PROCESSING"')
  const transportAt = body.indexOf("transport.sendMessage(")

  assert.ok(sendAt > 0, "sendWhatsAppMessage tidak ditemukan")
  assert.ok(holidayAt > 0, "penjagaan hari libur tidak ditemukan")
  assert.ok(composeAt > 0, "pemanggilan composeMessage tidak ditemukan")
  // Template A dan B (kelas belum rekap / semua sudah) serta C dan D (ada yang
  // tidak hadir / nihil) seluruhnya disusun di dalam composeMessage.
  assert.ok(holidayAt < composeAt, "hari libur harus diperiksa sebelum pesan disusun")
  assert.ok(holidayAt < claimAt, "hari libur harus diperiksa sebelum occurrence diklaim")
  assert.ok(holidayAt < transportAt, "hari libur harus diperiksa sebelum pesan dikirim")
})

test("pembatalan karena libur berstatus SKIPPED, bukan FAILED", () => {
  // FAILED akan tampil merah di layar dan terbaca sebagai gangguan, padahal
  // tidak mengirim pada hari libur justru perilaku yang benar.
  const guard = SOURCE.slice(SOURCE.indexOf('reason: "HOLIDAY"') - 200, SOURCE.indexOf('reason: "HOLIDAY"') + 60)
  assert.match(guard, /status: "SKIPPED"/)
})

test("hari libur hanya membatalkan jadwal, tidak membatalkan kiriman manual", () => {
  // Admin yang menekan tombol tahu persis hari apa ini; memblokirnya akan
  // membuat tombol itu tampak rusak pada hari libur.
  const guardStart = SOURCE.indexOf('reason: "HOLIDAY"')
  const before = SOURCE.slice(guardStart - 400, guardStart)
  assert.match(before, /trigger === "SCHEDULED"/)
})

test("penjagaan memakai kalender sekolah, bukan perhitungan akhir pekan sendiri", () => {
  // Menghitung sendiri akan mengabaikan hari efektif pengganti dan tanggal
  // merah yang sudah dicatat sekolah.
  assert.match(SOURCE, /resolveHoliday\(date, await readHolidayRules\(\)\)/)
  assert.doesNotMatch(SOURCE, /getDay\(\)\s*===\s*0/)
})
