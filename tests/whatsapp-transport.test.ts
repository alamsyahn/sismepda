/**
 * Batas transport, resolusi grup tujuan, dan kebijakan slot.
 *
 * Tidak ada koneksi WhatsApp di sini — itulah maksud dari batas transport.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CONNECTION_STATE_LABELS,
  ERROR_MESSAGES,
  WhatsAppSendError,
  errorMessageFor,
  reconnectDelayMs,
  shouldReconnect,
} from "@/lib/whatsapp-transport"
import {
  DEFAULT_TARGET_GROUP_NAME,
  isGroupJid,
  resolveTargetGroup,
  targetStateOf,
} from "@/lib/whatsapp-target"
import { SLOT_GRACE_MINUTES, dueSlots, missedSlots, slotDecision, slotMinutes } from "@/lib/whatsapp-slots"

const GROUP = { jid: "120363000000000001@g.us", name: "REKAP ABSENSI SISWA" }
const OTHER = { jid: "120363000000000002@g.us", name: "Guru SMPN 2" }

// --- pesan kesalahan --------------------------------------------------------

test("setiap kode kesalahan punya kalimat bahasa Indonesia, bukan stack trace", () => {
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    assert.ok(message.trim().length > 0, `${code} tidak punya pesan`)
    assert.ok(!message.includes("Error:"), `${code} membocorkan istilah teknis`)
    assert.ok(!/\bat\s+\w+\./.test(message), `${code} terlihat seperti stack trace`)
  }
})

test("pesan tidak terhubung persis seperti yang diminta admin", () => {
  assert.equal(
    errorMessageFor("NOT_CONNECTED"),
    "WhatsApp tidak terhubung. Hubungkan kembali sebelum mengirim pesan.",
  )
})

test("WhatsAppSendError membawa kode dan pesan aman, menyembunyikan penyebab asli", () => {
  const cause = new Error("websocket 428 baileys internal")
  const error = new WhatsAppSendError("NOT_CONNECTED", cause)
  assert.equal(error.code, "NOT_CONNECTED")
  assert.equal(error.message, ERROR_MESSAGES.NOT_CONNECTED)
  assert.ok(!error.message.includes("baileys"))
  assert.equal(error.cause, cause)
})

test("setiap status koneksi punya label yang dapat dipahami admin", () => {
  for (const [state, label] of Object.entries(CONNECTION_STATE_LABELS)) {
    assert.ok(label.trim().length > 0, `${state} tanpa label`)
    assert.ok(!/[A-Z_]{4,}/.test(label), `${state} membocorkan istilah internal: ${label}`)
  }
})

// --- backoff sambung ulang --------------------------------------------------

test("jeda sambung ulang menaik secara eksponensial", () => {
  assert.equal(reconnectDelayMs(0), 2_000)
  assert.equal(reconnectDelayMs(1), 4_000)
  assert.equal(reconnectDelayMs(2), 8_000)
  assert.equal(reconnectDelayMs(3), 16_000)
})

test("jeda sambung ulang punya batas atas agar tidak menjadi loop membanjiri", () => {
  assert.equal(reconnectDelayMs(50), 300_000)
  assert.ok(reconnectDelayMs(1_000) <= 300_000)
})

test("sesi yang sudah logged out tidak disambung ulang otomatis", () => {
  assert.equal(shouldReconnect("LOGGED_OUT"), false, "login ulang menuntut manusia memindai QR")
  assert.equal(shouldReconnect("CONNECTED"), false)
  assert.equal(shouldReconnect("DISCONNECTED"), true, "putus sementara memang boleh pulih sendiri")

  // Hanya putus SEMENTARA yang boleh pulih sendiri. ERROR dipakai untuk
  // penolakan akun (403) yang tidak berubah dengan mencoba lagi, UNPAIRED
  // belum punya apa pun untuk disambung, dan keadaan transisi bukan titik
  // keputusan sambung-ulang.
  assert.equal(shouldReconnect("ERROR"), false, "akun ditolak tidak pulih dengan mencoba lagi")
  assert.equal(shouldReconnect("UNPAIRED"), false)
  assert.equal(shouldReconnect("CONNECTING"), false)
  assert.equal(shouldReconnect("WAITING_QR"), false)
})

// --- resolusi grup tujuan ---------------------------------------------------

test("grup tujuan ditemukan berdasarkan nama dan disimpan sebagai JID", () => {
  const resolution = resolveTargetGroup([OTHER, GROUP])
  assert.equal(resolution.status, "RESOLVED")
  if (resolution.status !== "RESOLVED") return
  assert.equal(resolution.jid, GROUP.jid)
  assert.equal(resolution.name, DEFAULT_TARGET_GROUP_NAME)
})

test("pencocokan nama mengabaikan besar-kecil huruf dan spasi berlebih", () => {
  const resolution = resolveTargetGroup([{ jid: GROUP.jid, name: "  rekap   absensi siswa " }])
  assert.equal(resolution.status, "RESOLVED")
})

test("grup tidak ditemukan dilaporkan, tidak diganti tujuan lain", () => {
  const resolution = resolveTargetGroup([OTHER])
  assert.equal(resolution.status, "NOT_FOUND")
})

test("nama grup kembar dilaporkan ambigu, bukan dipilih diam-diam", () => {
  const twin = { jid: "120363000000000009@g.us", name: "REKAP ABSENSI SISWA" }
  const resolution = resolveTargetGroup([GROUP, twin])
  assert.equal(resolution.status, "AMBIGUOUS")
  if (resolution.status !== "AMBIGUOUS") return
  assert.equal(resolution.candidates.length, 2)
})

test("hanya JID grup yang diterima; JID perorangan ditolak", () => {
  assert.equal(isGroupJid(GROUP.jid), true)
  assert.equal(isGroupJid("6281234567890@s.whatsapp.net"), false)
  assert.equal(isGroupJid("REKAP ABSENSI SISWA"), false)
  assert.equal(isGroupJid(null), false)
})

test("konfigurasi tanpa JID berarti tujuan belum siap", () => {
  assert.deepEqual(targetStateOf(null, null), { status: "NOT_RESOLVED" })
  assert.deepEqual(targetStateOf("", "REKAP ABSENSI SISWA"), { status: "NOT_RESOLVED" })
})

test("JID tersimpan yang rusak ditolak, bukan jatuh kembali ke pencarian nama", () => {
  const state = targetStateOf("bukan-jid", "REKAP ABSENSI SISWA")
  assert.equal(state.status, "INVALID")
})

test("JID tersimpan yang sah dipakai apa adanya", () => {
  const state = targetStateOf(GROUP.jid, GROUP.name)
  assert.equal(state.status, "RESOLVED")
  if (state.status !== "RESOLVED") return
  assert.equal(state.jid, GROUP.jid)
})

// --- kebijakan slot ---------------------------------------------------------

test("slot sebelum waktunya belum jatuh tempo", () => {
  assert.deepEqual(slotDecision("08:00", 7 * 60 + 59), { due: false, reason: "NOT_YET" })
})

test("slot tepat pada jamnya jatuh tempo", () => {
  assert.deepEqual(slotDecision("08:00", 8 * 60), { due: true, reason: "DUE" })
})

test("slot masih jatuh tempo dalam tenggang", () => {
  assert.equal(slotDecision("08:00", 8 * 60 + SLOT_GRACE_MINUTES).due, true)
})

// Jadwal yang dahulu berupa konstanta kini datang dari konfigurasi admin.
// Tes ini memakai jam lama agar perilaku jatuh-tempo tetap terjaga.
const SCHEDULE = [
  { messageId: "ATTENDANCE_MISSING", slots: ["08:00", "10:00"] },
  { messageId: "ATTENDANCE_ABSENT", slots: ["12:00"] },
]

test("slot yang lewat jauh TIDAK dikirim belakangan", () => {
  // Worker mati 07.50, hidup 11.30: slot 08.00 dan 10.00 sudah kedaluwarsa.
  const at1130 = 11 * 60 + 30
  assert.deepEqual(slotDecision("08:00", at1130), { due: false, reason: "EXPIRED" })
  assert.deepEqual(slotDecision("10:00", at1130), { due: false, reason: "EXPIRED" })
  assert.deepEqual(dueSlots(SCHEDULE, at1130), [])
})

test("slot terlewat tetap dapat dilaporkan untuk pemantauan", () => {
  const missed = missedSlots(SCHEDULE, 11 * 60 + 30)
  assert.deepEqual(
    missed.map((entry) => entry.slot),
    ["08:00", "10:00"],
  )
})

test("pada 08.00 hanya slot 08.00 yang jatuh tempo", () => {
  const due = dueSlots(SCHEDULE, 8 * 60)
  assert.deepEqual(due, [{ messageId: "ATTENDANCE_MISSING", slot: "08:00" }])
})

test("pada 12.00 hanya rekap siswa tidak hadir yang jatuh tempo", () => {
  const due = dueSlots(SCHEDULE, 12 * 60)
  assert.deepEqual(due, [{ messageId: "ATTENDANCE_ABSENT", slot: "12:00" }])
})

test("tengah malam dan dini hari tidak menjatuhtempokan slot apa pun", () => {
  assert.deepEqual(dueSlots(SCHEDULE, 0), [])
  assert.deepEqual(dueSlots(SCHEDULE, 5 * 60), [])
  assert.deepEqual(dueSlots(SCHEDULE, 23 * 60 + 59), [])
})

test("slot berformat salah gagal keras", () => {
  assert.throws(() => slotMinutes("8:00"), /tidak valid/i)
  assert.throws(() => slotMinutes("0800"), /tidak valid/i)
})
