/**
 * Aturan kartu pesan WhatsApp.
 *
 * Yang diuji di sini adalah keputusan yang menentukan APA yang terkirim dan
 * BERAPA KALI — bukan tampilan. Semuanya dapat diuji tanpa database karena
 * aturannya memang tidak membutuhkan database untuk menjawab.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { requireSchoolDate } from "../lib/school-date"
import {
  attendanceActivityDecision,
} from "../lib/whatsapp-attendance-activity"
import {
  BUILTIN_MESSAGE_IDS,
  MANUAL_MESSAGE_ID,
  MESSAGE_TITLE_MAX_LENGTH,
  canonicalOrder,
  isDeletable,
  isSchedulable,
  messageIdempotencyKey,
  messageTitleErrorMessage,
  normalizeMessageTitle,
  reorderMessages,
} from "../lib/whatsapp-message"

const SCHOOL_DATE = requireSchoolDate("2026-09-22")

// --- identitas kartu --------------------------------------------------------

test("kartu manual tidak dapat dijadwalkan", () => {
  assert.equal(isSchedulable({ kind: "MANUAL" }), false)
  assert.equal(isSchedulable({ kind: "BUILTIN" }), true)
  assert.equal(isSchedulable({ kind: "CUSTOM" }), true)
})

test("hanya kartu buatan admin yang boleh dihapus", () => {
  // Menghapus kartu bawaan berarti menghapus jadwal yang dipakai sekolah,
  // tanpa cara mengembalikannya dari layar.
  assert.equal(isDeletable({ kind: "CUSTOM" }), true)
  assert.equal(isDeletable({ kind: "BUILTIN" }), false)
  assert.equal(isDeletable({ kind: "MANUAL" }), false)
})

// --- kunci occurrence -------------------------------------------------------

test("kartu bawaan mempertahankan format kunci lama", () => {
  // Mengubah format kunci pada hari migrasi akan membuat occurrence yang sudah
  // terkirim pagi itu tampak belum terkirim, lalu terkirim dua kali.
  const key = messageIdempotencyKey(
    { id: BUILTIN_MESSAGE_IDS.ATTENDANCE_MISSING, kind: "BUILTIN", builtinType: "ATTENDANCE_MISSING" },
    SCHOOL_DATE,
    "08:00",
  )
  assert.equal(key, "attendance_missing:2026-09-22:08:00")
})

test("kartu buatan admin memakai id sebagai identitas kunci", () => {
  const key = messageIdempotencyKey(
    { id: "abc123", kind: "CUSTOM", builtinType: null },
    SCHOOL_DATE,
    "09:30",
  )
  assert.ok(key.includes("abc123"))
  assert.ok(key.endsWith("2026-09-22:09:30"))
})

test("dua kartu berbeda tidak pernah berbagi kunci pada slot yang sama", () => {
  const first = messageIdempotencyKey(
    { id: "aaa", kind: "CUSTOM", builtinType: null },
    SCHOOL_DATE,
    "08:00",
  )
  const second = messageIdempotencyKey(
    { id: "bbb", kind: "CUSTOM", builtinType: null },
    SCHOOL_DATE,
    "08:00",
  )
  assert.notEqual(first, second)
})

// --- urutan kartu -----------------------------------------------------------

test("menggeser kartu menukarnya dengan tetangganya", () => {
  const next = reorderMessages(["a", "b", "c"], "b", "UP")
  assert.deepEqual(next?.map((entry) => entry.id), ["b", "a", "c"])
})

test("kartu di ujung tidak dapat digeser keluar", () => {
  assert.equal(reorderMessages(["a", "b"], "a", "UP"), null)
  assert.equal(reorderMessages(["a", "b"], "b", "DOWN"), null)
})

test("urutan tersimpan selalu rapat mulai dari nol", () => {
  // sortOrder yang berlubang membuat perbandingan urutan bergantung pada
  // urutan penyisipan, bukan pada angka yang tersimpan.
  const order = canonicalOrder(["x", "y", "z"])
  assert.deepEqual(order, [
    { id: "x", sortOrder: 0 },
    { id: "y", sortOrder: 1 },
    { id: "z", sortOrder: 2 },
  ])
})

test("menggeser kartu yang tidak ada bukan kesalahan diam", () => {
  assert.equal(reorderMessages(["a", "b"], "zzz", "UP"), null)
})

// --- judul kartu ------------------------------------------------------------

test("judul kosong ditolak dengan alasan yang dapat dibaca", () => {
  const result = normalizeMessageTitle("   ")
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(messageTitleErrorMessage(result.error).length > 0)
})

test("judul yang terlalu panjang ditolak", () => {
  const result = normalizeMessageTitle("x".repeat(MESSAGE_TITLE_MAX_LENGTH + 1))
  assert.equal(result.ok, false)
})

test("spasi di tepi judul dirapikan, bukan ditolak", () => {
  const result = normalizeMessageTitle("  Rekap sore  ")
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.title, "Rekap sore")
})

// --- penjagaan aktivitas absensi -------------------------------------------

test("hari tanpa aktivitas absensi membatalkan kiriman terjadwal", () => {
  const decision = attendanceActivityDecision({
    trigger: "SCHEDULED",
    required: true,
    hasActivity: false,
  })
  assert.equal(decision.blocked, true)
})

test("satu kelas yang mengisi absensi sudah cukup", () => {
  const decision = attendanceActivityDecision({
    trigger: "SCHEDULED",
    required: true,
    hasActivity: true,
  })
  assert.equal(decision.blocked, false)
})

test("kiriman manual tidak pernah dibatalkan penjagaan absensi", () => {
  // Admin yang menekan tombol tahu persis hari apa ini; memblokirnya membuat
  // tombol tampak rusak.
  const decision = attendanceActivityDecision({
    trigger: "MANUAL",
    required: true,
    hasActivity: false,
  })
  assert.equal(decision.blocked, false)
})

test("kartu yang tidak mengaktifkan penjagaan berperilaku seperti sebelumnya", () => {
  const decision = attendanceActivityDecision({
    trigger: "SCHEDULED",
    required: false,
    hasActivity: false,
  })
  assert.equal(decision.blocked, false)
})

// --- teks manual dikirim apa adanya -----------------------------------------

/**
 * Komentar dibuang sebelum diperiksa.
 *
 * Berkas ini menjelaskan larangannya dalam bahasa manusia ("tidak ada penanda
 * [MANUAL]"), dan pemeriksaan yang membaca komentar akan menuduh penjelasan
 * itu sebagai pelanggaran.
 */
const SERVER = readFileSync("lib/server-whatsapp.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "")

test("teks pesan manual tidak dirender sebagai template", () => {
  // Placeholder yang kebetulan ditulis admin adalah teks biasa baginya.
  const branch = SERVER.slice(
    SERVER.indexOf("const messageText ="),
    SERVER.indexOf("requireAttendanceActivity)"),
  )
  assert.ok(branch.includes('message.kind === "MANUAL"'))
  assert.ok(branch.includes("request.text"))
  assert.ok(!branch.includes("renderTemplate("), "teks manual tidak boleh melewati renderer")
})

test("tidak ada prefix, header, atau penanda yang ditambahkan ke teks manual", () => {
  for (const forbidden of ["[MANUAL]", "PESAN MANUAL", "Dikirim oleh"]) {
    assert.ok(!SERVER.includes(forbidden), `teks manual tidak boleh disisipi ${forbidden}`)
  }
})

test("pembatalan karena absensi menulis klaim occurrence, bukan sekadar return", () => {
  // Verdict-nya bisa berubah dalam masa grace 20 menit, jadi occurrence-nya
  // harus dipakai habis agar tick berikutnya tidak mengirim ulang.
  const guard = SERVER.slice(
    SERVER.indexOf("attendanceActivityDecision({"),
    SERVER.indexOf("let claim"),
  )
  assert.ok(guard.includes('status: "SKIPPED"'))
  assert.ok(guard.includes("messageIdempotencyKey("))
})

test("kartu manual ditolak jalur terjadwal", () => {
  assert.ok(SERVER.includes('reason: "NOT_SCHEDULABLE"'))
})

test("id kartu bawaan deterministik dan berbeda dari kartu manual", () => {
  const ids = Object.values(BUILTIN_MESSAGE_IDS)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(!ids.includes(MANUAL_MESSAGE_ID))
})
