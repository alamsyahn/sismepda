/**
 * Aturan bisnis pesan WhatsApp otomatis.
 *
 * Seluruh berkas ini berjalan tanpa database dan tanpa koneksi WhatsApp:
 * builder-nya murni, jadi yang diuji adalah aturannya, bukan infrastrukturnya.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildAbsentStudentsMessage,
  buildMissingAttendanceMessage,
  incompleteClasses,
  isClassIncomplete,
} from "@/lib/whatsapp-messages"
import {
  WHATSAPP_MESSAGE_TYPES,
  WHATSAPP_SCHEDULE,
  formatSlots,
  idempotencyKeyFor,
  scheduleFor,
} from "@/lib/whatsapp-schedule"
import type { WhatsAppReportClass } from "@/lib/whatsapp-report"

type StudentSpec = {
  id: string
  name: string
  status: WhatsAppReportClass["students"][number]["status"]
  note?: string | null
}

function classOf(
  name: string,
  submitted: boolean,
  students: StudentSpec[],
  grade = "VII",
): WhatsAppReportClass {
  return {
    id: `c-${name}`,
    name,
    grade,
    submitted,
    homeroomName: null,
    studentCount: students.length,
    students: students.map((student) => ({ ...student, note: student.note ?? null })),
  }
}

const DATE_LABEL = "15 September 2026"

// --- kelengkapan kelas ------------------------------------------------------

test("kelas tanpa envelope harian dihitung belum mengisi absensi", () => {
  assert.equal(isClassIncomplete(classOf("VII A", false, [])), true)
})

test("kelas tersimpan sebagian tetap dihitung belum lengkap", () => {
  const partial = classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: null }])
  assert.equal(isClassIncomplete(partial), true)
})

test("kelas lengkap tidak masuk daftar, termasuk yang punya siswa tidak hadir", () => {
  const complete = classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: "SAKIT" }])
  assert.equal(isClassIncomplete(complete), false)
  assert.deepEqual(incompleteClasses([complete]), [])
})

// --- TYPE 1: kelas belum mengisi absensi ------------------------------------

test("pesan 08.00 mendaftar kelas yang belum mengisi absensi", () => {
  const message = buildMissingAttendanceMessage(DATE_LABEL, "08:00", [
    classOf("VII A", false, []),
    classOf("VII B", true, [{ id: "s1", name: "Budi", status: "SAKIT" }]),
    classOf("VII C", false, []),
  ])

  assert.match(message, /REKAP ABSENSI/)
  assert.match(message, /15 September 2026 • 08\.00 WIB/)
  assert.match(message, /1\. 7A/)
  assert.match(message, /2\. 7C/)
  assert.ok(!message.includes("7B"), "kelas lengkap tidak boleh ikut didaftar")
  assert.match(message, /Total: 2 kelas\./)
})

test("pesan 10.00 memakai slot yang diberikan, bukan jam tetap", () => {
  const message = buildMissingAttendanceMessage(DATE_LABEL, "10:00", [classOf("VII A", false, [])])
  assert.match(message, /10\.00 WIB/)
  assert.ok(!message.includes("08.00"))
})

test("kelas tersimpan sebagian disebut kekurangan berapa siswa", () => {
  const message = buildMissingAttendanceMessage(DATE_LABEL, "08:00", [
    classOf("VIII B", true, [
      { id: "s1", name: "Ani", status: null },
      { id: "s2", name: "Beni", status: null },
      { id: "s3", name: "Cici", status: "IZIN" },
    ], "VIII"),
  ])
  assert.match(message, /8B \(kurang 2 siswa\)/)
})

test("NIHIL: semua kelas lengkap tetap mengirim konfirmasi, bukan diam", () => {
  const message = buildMissingAttendanceMessage(DATE_LABEL, "08:00", [
    classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: "SAKIT" }]),
  ])
  assert.match(message, /Seluruh kelas telah mengisi absensi\./)
  assert.match(message, /NIHIL kelas yang belum melakukan rekap\./)
  assert.ok(!message.includes("Total:"))
})

// --- TYPE 2: rekap siswa tidak hadir ----------------------------------------

test("rekap 12.00 mengelompokkan siswa per status dan menjumlahkannya", () => {
  const message = buildAbsentStudentsMessage(DATE_LABEL, "12:00", [
    classOf("VII A", true, [
      { id: "s1", name: "Ahmad", status: "SAKIT" },
      { id: "s2", name: "Bayu", status: "ALFA" },
      { id: "s3", name: "Cahya", status: "IZIN" },
    ]),
    classOf("IX A", true, [{ id: "s4", name: "Dewi", status: "DISPENSASI" }], "IX"),
  ])

  assert.match(message, /REKAP SISWA TIDAK HADIR/)
  assert.match(message, /12\.00 WIB/)
  assert.match(message, /\*SAKIT — 1\*/)
  assert.match(message, /• 7A — Ahmad/)
  assert.match(message, /\*IZIN — 1\*/)
  assert.match(message, /\*ALFA — 1\*/)
  assert.match(message, /\*DISPENSASI — 1\*/)
  assert.match(message, /Total siswa tidak hadir: 4/)
})

test("status HADIR tidak pernah masuk rekap tidak hadir", () => {
  const message = buildAbsentStudentsMessage(DATE_LABEL, "12:00", [
    classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: "SAKIT" }]),
  ])
  assert.ok(!message.includes("HADIR — "), "tidak boleh ada seksi HADIR")
  assert.match(message, /Total siswa tidak hadir: 1/)
})

test("NIHIL penuh hanya diklaim saat seluruh kelas sudah merekap", () => {
  // Kelas lengkap (envelope ada, tidak ada siswa berstatus null) dan seluruh
  // siswanya hadir — sehingga tidak ada satu pun baris ketidakhadiran.
  const message = buildAbsentStudentsMessage(DATE_LABEL, "12:00", [
    {
      id: "c-VII A",
      name: "VII A",
      grade: "VII",
      submitted: true,
      homeroomName: null,
      studentCount: 0,
      students: [],
    },
  ])
  assert.match(message, /Seluruh siswa yang telah direkap tercatat hadir\./)
})

test("kelas belum merekap: pesan nihil TIDAK boleh menyesatkan", () => {
  const message = buildAbsentStudentsMessage(DATE_LABEL, "12:00", [
    classOf("VII A", false, []),
    classOf("VII B", false, []),
  ])
  assert.ok(
    !message.includes("Seluruh siswa yang telah direkap tercatat hadir"),
    "tidak boleh mengklaim seluruh siswa hadir saat data belum lengkap",
  )
  assert.match(message, /2 kelas belum mengisi absensi sehingga data belum lengkap/)
})

test("rekap dengan sebagian kelas belum merekap tetap memberi catatan", () => {
  const message = buildAbsentStudentsMessage(DATE_LABEL, "12:00", [
    classOf("VII A", true, [{ id: "s1", name: "Ahmad", status: "SAKIT" }]),
    classOf("VII B", false, []),
  ])
  assert.match(message, /Total siswa tidak hadir: 1/)
  assert.match(message, /1 kelas belum mengisi absensi sehingga data belum lengkap/)
})

test("siswa ganda dalam satu kelas hanya dihitung sekali", () => {
  const message = buildAbsentStudentsMessage(DATE_LABEL, "12:00", [
    classOf("VII A", true, [
      { id: "s1", name: "Ahmad", status: "SAKIT" },
      { id: "s1", name: "Ahmad", status: "SAKIT" },
    ]),
  ])
  assert.match(message, /Total siswa tidak hadir: 1/)
})

// --- jadwal & idempotensi ---------------------------------------------------

test("jam bawaan hanya benih migrasi: 08.00 dan 10.00 untuk kelas belum mengisi, 12.00 untuk rekap", () => {
  // Ini BUKAN jadwal yang dipakai runtime. Scheduler membaca jam dari
  // konfigurasi database; nilai di sini hanya mengisi baris yang belum pernah
  // diatur admin, sehingga sekolah yang sudah berjalan tidak kehilangan jadwal.
  assert.deepEqual(scheduleFor("ATTENDANCE_MISSING").defaultSlots, ["08:00", "10:00"])
  assert.deepEqual(scheduleFor("ATTENDANCE_ABSENT").defaultSlots, ["12:00"])
  assert.deepEqual(WHATSAPP_MESSAGE_TYPES, ["ATTENDANCE_MISSING", "ATTENDANCE_ABSENT"])
})

test("label jadwal siap tampil tanpa menghitung ulang jam di UI", () => {
  assert.equal(formatSlots(["08:00", "10:00"]), "08.00 & 10.00 WIB")
  assert.equal(formatSlots(["12:00"]), "12.00 WIB")
})

test("jenis pesan tak dikenal gagal keras, bukan diam-diam tanpa jadwal", () => {
  assert.throws(() => scheduleFor("TIDAK_ADA" as never), /tidak dikenal/i)
})

test("idempotency key menyatukan jenis, tanggal sekolah, dan slot", () => {
  assert.equal(
    idempotencyKeyFor("ATTENDANCE_MISSING", "2026-09-15", "08:00"),
    "attendance_missing:2026-09-15:08:00",
  )
  assert.equal(
    idempotencyKeyFor("ATTENDANCE_ABSENT", "2026-09-15", "12:00"),
    "attendance_absent:2026-09-15:12:00",
  )
})

test("slot berbeda pada hari sama menghasilkan kunci berbeda", () => {
  const eight = idempotencyKeyFor("ATTENDANCE_MISSING", "2026-09-15", "08:00")
  const ten = idempotencyKeyFor("ATTENDANCE_MISSING", "2026-09-15", "10:00")
  assert.notEqual(eight, ten)
})

test("setiap jenis pesan punya label, deskripsi, dan minimal satu jam bawaan", () => {
  for (const definition of WHATSAPP_SCHEDULE) {
    assert.ok(definition.label.trim().length > 0)
    assert.ok(definition.description.trim().length > 0)
    assert.ok(definition.defaultSlots.length > 0)
    for (const slot of definition.defaultSlots) {
      assert.match(slot, /^\d{2}:\d{2}$/, `slot tidak berformat HH:mm: ${slot}`)
    }
  }
})
