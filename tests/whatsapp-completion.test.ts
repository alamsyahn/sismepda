/**
 * Pemicu pesan berbasis LENGKAPNYA ABSENSI, bukan jam.
 *
 * APA YANG DIJAGA BERKAS INI
 *
 * Dua kartu bawaan absensi membawa dua pesan sekaligus: versi pengingat yang
 * terikat jam, dan versi final yang terikat kelengkapan. Yang mudah rusak
 * bukan bunyi pesannya — itu sudah dijaga uji template — melainkan KAPAN
 * masing-masing boleh berangkat, dan berapa kali.
 *
 * `sendWhatsAppMessage` tidak dapat diimpor di sini: berkasnya menarik Prisma,
 * dan lewat `tsx --test` itu berarti membuka koneksi basis data sungguhan.
 * Karena itu aturannya diuji pada fungsi murni yang benar-benar dipanggil
 * jalur pengiriman, dan PEMANGGILANNYA dijaga pada sumber — pola yang sama
 * dengan `whatsapp-holiday-guard.test.ts` dan `whatsapp-idempotency.test.ts`.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  COMPLETION_SLOT,
  EMPTY_COMPLETION_ATTEMPTS,
  MAX_COMPLETION_ATTEMPTS,
  attendanceCompletion,
  completionGuard,
  completionIdempotencyKey,
  completionOccurrenceSlot,
  isCompletionDrivenType,
  isCompletionSlot,
  shouldAttemptCompletion,
  type CompletionAttempts,
} from "../lib/whatsapp-completion.js"
import type { WhatsAppReportClass } from "../lib/whatsapp-report.js"

const SERVER_SOURCE = readFileSync(
  new URL("../lib/server-whatsapp.ts", import.meta.url),
  "utf8",
)
const WORKER_SOURCE = readFileSync(
  new URL("../scripts/whatsapp-worker.mts", import.meta.url),
  "utf8",
)
const ATTENDANCE_SOURCE = readFileSync(
  new URL("../app/api/attendance/route.ts", import.meta.url),
  "utf8",
)
const PANEL_SOURCE = readFileSync(
  new URL("../components/whatsapp/whatsapp-panel.tsx", import.meta.url),
  "utf8",
)

function classOf(
  name: string,
  submitted: boolean,
  students: { status: WhatsAppReportClass["students"][number]["status"] }[],
): WhatsAppReportClass {
  return {
    id: `c-${name}`,
    name,
    grade: "VII",
    submitted,
    homeroomName: null,
    studentCount: students.length,
    students: students.map((student, index) => ({
      id: `s-${name}-${index}`,
      name: `Siswa ${index}`,
      status: student.status,
      note: null,
    })),
  }
}

/** Kelas lengkap: envelope tersimpan, dan tidak ada siswa berstatus kosong. */
const COMPLETE_A = classOf("VII A", true, [{ status: "SAKIT" }])
const COMPLETE_B = classOf("VII B", true, [])
/** Tersimpan, tetapi masih ada siswa tanpa status — BELUM lengkap. */
const PARTIAL = classOf("VII C", true, [{ status: null }])
/** Belum pernah disimpan sama sekali. */
const UNTOUCHED = classOf("VII D", false, [])

const MESSAGE = {
  id: "wa-msg-attendance-absent",
  kind: "BUILTIN" as const,
  builtinType: "ATTENDANCE_ABSENT" as const,
}

// --- definisi "lengkap" -----------------------------------------------------

test("kelas yang tersimpan sebagian belum dihitung lengkap", () => {
  // Menekan Simpan tidak cukup: status setiap siswa yang diwajibkan harus ada.
  const completion = attendanceCompletion([COMPLETE_A, PARTIAL])
  assert.equal(completion.complete, false)
  assert.equal(completion.incompleteCount, 1)
})

test("kelas yang belum pernah disimpan belum dihitung lengkap", () => {
  assert.equal(attendanceCompletion([COMPLETE_A, UNTOUCHED]).complete, false)
})

test("seluruh kelas lengkap menghasilkan verdict lengkap", () => {
  const completion = attendanceCompletion([COMPLETE_A, COMPLETE_B])
  assert.equal(completion.complete, true)
  assert.equal(completion.incompleteCount, 0)
})

test("tanpa satu pun kelas wajib, hari itu TIDAK dianggap lengkap", () => {
  // Daftar kosong berarti data tidak terbaca, bukan berarti semua sudah rekap.
  // Tanpa penjagaan ini, sekolah tanpa kelas akan menerima rekap NIHIL.
  const completion = attendanceCompletion([])
  assert.equal(completion.complete, false)
  assert.equal(completion.totalClasses, 0)
})

// --- slot jam: versi "belum" -------------------------------------------------

test("slot jam tetap mengirim selama masih ada kelas belum lengkap", () => {
  const guard = completionGuard({
    slot: "07:00",
    completion: attendanceCompletion([COMPLETE_A, PARTIAL]),
  })
  assert.equal(guard.blocked, false)
})

test("dua slot berbeda sama-sama boleh mengirim pada hari yang sama", () => {
  // Masing-masing slot adalah occurrence tersendiri; yang membatasi \"sekali
  // per slot\" adalah kunci idempotensi, bukan penjagaan kelengkapan.
  const completion = attendanceCompletion([PARTIAL])
  assert.equal(completionGuard({ slot: "07:00", completion }).blocked, false)
  assert.equal(completionGuard({ slot: "09:00", completion }).blocked, false)
})

test("slot jam dilewati bila absensi sudah lengkap sebelum jam itu berjalan", () => {
  const guard = completionGuard({
    slot: "09:00",
    completion: attendanceCompletion([COMPLETE_A, COMPLETE_B]),
  })
  assert.equal(guard.blocked, true)
  assert.equal(guard.blocked && guard.reason, "ALREADY_COMPLETE")
})

test("slot jam yang dilewati MEMAKAI HABIS occurrence-nya", () => {
  // Tanpa ini, tick berikutnya dalam masa grace akan mengirim pengingat yang
  // sudah tidak berlaku begitu seorang guru menyunting absensi mundur sesaat.
  const guard = completionGuard({
    slot: "09:00",
    completion: attendanceCompletion([COMPLETE_A]),
  })
  assert.equal(guard.blocked && guard.claimsOccurrence, true)
})

// --- occurrence penyelesaian: versi final -----------------------------------

test("rekap final tidak berangkat selama masih ada kelas belum lengkap", () => {
  const guard = completionGuard({
    slot: COMPLETION_SLOT,
    completion: attendanceCompletion([COMPLETE_A, PARTIAL]),
  })
  assert.equal(guard.blocked, true)
  assert.equal(guard.blocked && guard.reason, "NOT_COMPLETE")
})

test("rekap final yang ditunda TIDAK memakai occurrence-nya", () => {
  // Inilah yang membuat \"lengkap di antara slot\" dan \"lengkap setelah jam
  // terakhir\" tetap menghasilkan rekap: occurrence-nya masih tersedia.
  const guard = completionGuard({
    slot: COMPLETION_SLOT,
    completion: attendanceCompletion([PARTIAL]),
  })
  assert.equal(guard.blocked && guard.claimsOccurrence, false)
})

test("rekap final berangkat begitu seluruh kelas lengkap, tanpa menunggu slot", () => {
  const guard = completionGuard({
    slot: COMPLETION_SLOT,
    completion: attendanceCompletion([COMPLETE_A, COMPLETE_B]),
  })
  assert.equal(guard.blocked, false)
})

test("hari tanpa kelas tidak memicu rekap final", () => {
  const guard = completionGuard({ slot: COMPLETION_SLOT, completion: attendanceCompletion([]) })
  assert.equal(guard.blocked, true)
  assert.equal(guard.blocked && guard.reason, "NOT_COMPLETE")
})

// --- sekali sehari, tahan restart dan polling -------------------------------

test("occurrence penyelesaian yang sudah terkirim tidak dicoba lagi", () => {
  // Polling berulang dan restart worker sama-sama membaca keadaan ini dari
  // database, bukan dari memori proses.
  const attempts: CompletionAttempts = { sent: true, processing: false, failed: 0 }
  assert.equal(shouldAttemptCompletion(attempts), false)
})

test("absensi yang disunting mundur lalu lengkap lagi tidak mengirim ulang", () => {
  // Penandanya adalah baris SENT hari itu; kelengkapan yang datang untuk kedua
  // kalinya tidak menghapusnya.
  const afterResend: CompletionAttempts = { sent: true, processing: false, failed: 2 }
  assert.equal(shouldAttemptCompletion(afterResend), false)
})

test("klaim yang sedang diproses menahan percobaan paralel", () => {
  const attempts: CompletionAttempts = { sent: false, processing: true, failed: 0 }
  assert.equal(shouldAttemptCompletion(attempts), false)
})

test("hari yang belum punya jejak apa pun boleh mencoba", () => {
  assert.equal(shouldAttemptCompletion(EMPTY_COMPLETION_ATTEMPTS), true)
})

// --- kegagalan dan retry ----------------------------------------------------

test("kegagalan pengiriman masih menyisakan percobaan berikutnya", () => {
  const attempts: CompletionAttempts = { sent: false, processing: false, failed: 1 }
  assert.equal(shouldAttemptCompletion(attempts), true)
})

test("percobaan ulang memakai occurrence yang berbeda dari yang gagal", () => {
  // `idempotencyKey` UNIQUE dan baris FAILED tidak dihapus; tanpa nomor
  // percobaan, kegagalan pertama mengunci rekap final hari itu selamanya.
  assert.equal(completionOccurrenceSlot(1), COMPLETION_SLOT)
  assert.notEqual(completionOccurrenceSlot(2), completionOccurrenceSlot(1))
  assert.notEqual(
    completionIdempotencyKey(MESSAGE, "2026-09-16", 2),
    completionIdempotencyKey(MESSAGE, "2026-09-16", 1),
  )
})

test("nomor percobaan diturunkan dari keadaan, sehingga dua proses sepakat", () => {
  // Kunci dihitung dari jumlah kegagalan yang tercatat, bukan dari penghitung
  // di dalam proses — dua worker yang membaca keadaan sama menulis kunci yang
  // sama, dan yang kedua ditolak database sebelum transport disentuh.
  assert.equal(
    completionIdempotencyKey(MESSAGE, "2026-09-16", 3),
    completionIdempotencyKey(MESSAGE, "2026-09-16", 3),
  )
})

test("retry berhenti pada batas yang ditentukan, bukan tak terbatas", () => {
  const exhausted: CompletionAttempts = {
    sent: false,
    processing: false,
    failed: MAX_COMPLETION_ATTEMPTS,
  }
  assert.equal(shouldAttemptCompletion(exhausted), false)
})

test("occurrence penyelesaian dikenali termasuk bentuk percobaan ulangnya", () => {
  assert.equal(isCompletionSlot(COMPLETION_SLOT), true)
  assert.equal(isCompletionSlot(completionOccurrenceSlot(4)), true)
  assert.equal(isCompletionSlot("07:00"), false)
  assert.equal(isCompletionSlot(null), false)
})

// --- cakupan jenis pesan ----------------------------------------------------

test("hanya dua kartu absensi yang punya versi final berbasis kelengkapan", () => {
  assert.equal(isCompletionDrivenType("ATTENDANCE_MISSING"), true)
  assert.equal(isCompletionDrivenType("ATTENDANCE_ABSENT"), true)
  // Notifikasi UKS dipicu petugas, bukan absensi; ia tidak boleh ikut terbawa.
  assert.equal(isCompletionDrivenType("EUKS_VISIT_NOTIFICATION"), false)
  assert.equal(isCompletionDrivenType(null), false)
})

// --- penempatan penjagaan pada sumber ---------------------------------------

test("penjagaan kelengkapan dijalankan SEBELUM klaim occurrence ditulis", () => {
  // Memeriksanya setelah klaim berarti occurrence rekap final sudah terpakai
  // ketika ternyata absensi belum lengkap.
  const guardAt = SERVER_SOURCE.indexOf("const guard = completionGuard(")
  const claimAt = SERVER_SOURCE.indexOf('status: "PROCESSING"')
  assert.ok(guardAt > 0, "pemanggilan completionGuard tidak ditemukan")
  assert.ok(claimAt > 0, "klaim PROCESSING tidak ditemukan")
  assert.ok(guardAt < claimAt, "penjagaan kelengkapan harus mendahului klaim")
})

test("kiriman manual tidak pernah melewati penjagaan kelengkapan", () => {
  // Tombol \"Kirim sekarang\" adalah aksi admin; ia juga tidak boleh menghabiskan
  // jatah harian, dan karena itu tidak pernah menulis kunci idempotensi.
  assert.match(
    SERVER_SOURCE,
    /request\.trigger === "SCHEDULED" && isCompletionDrivenType\(message\.builtinType\)/,
  )
})

test("teks pesan disusun dari potret data yang sama dengan penjagaannya", () => {
  // Membaca ulang laporan setelah penjagaan membuka celah: seorang guru dapat
  // menyimpan absensi di antara dua query, sehingga rekap \"final\" terkirim
  // dengan isi yang berbeda dari keadaan yang memicunya.
  assert.match(SERVER_SOURCE, /composeMessage\(message, date, displaySlot, completionClasses/)
})

test("{{waktu}} pada rekap final memakai waktu kirim, bukan nama occurrence", () => {
  assert.match(
    SERVER_SOURCE,
    /isCompletionSlot\(slot\)\s*\?\s*formatSchoolTime\(new Date\(\), timeZone\)/,
  )
})

test("penyimpanan absensi memicu pemeriksaan rekap final", () => {
  // Tanpa ini, rekap final hanya berangkat pada tick berikutnya — dan pada
  // instalasi tanpa jadwal sama sekali, pemicu jam tidak pernah datang.
  assert.match(ATTENDANCE_SOURCE, /notifyAttendanceCompletion\(\)/)
})

test("pemicu absensi berjalan setelah transaksi commit", () => {
  // Memanggilnya di dalam transaksi membuat worker membaca keadaan lama dan
  // menyimpulkan absensi belum lengkap.
  const txEnd = ATTENDANCE_SOURCE.indexOf("})\r\n    // PEMICU REKAP FINAL")
  const notifyAt = ATTENDANCE_SOURCE.indexOf("void notifyAttendanceCompletion()")
  assert.ok(notifyAt > 0, "pemicu tidak ditemukan")
  assert.ok(txEnd > 0 && txEnd < notifyAt, "pemicu harus berada setelah $transaction")
})

test("worker tetap memeriksa rekap final walau tak ada slot jatuh tempo", () => {
  // Jaring pengaman untuk proses web yang mati, panggilan HTTP yang hilang,
  // dan worker yang baru hidup setelah absensi terakhir tersimpan.
  assert.match(WORKER_SOURCE, /await runCompletion\(\)/)
  assert.match(WORKER_SOURCE, /case "POST \/completion"/)
})

test("UI tidak menampilkan rekap final sebagai slot jadwal yang dapat digeser", () => {
  assert.match(PANEL_SOURCE, /slot\.completion \? COMPLETION_SLOT_LABEL : slot\.slot/)
})

test("teks bantuan menyatakan jam hanya mengatur versi belum lengkap", () => {
  assert.match(PANEL_SOURCE, /hanya mengatur pengingat “belum semua rekap”/)
  assert.match(PANEL_SOURCE, /hanya mengatur rekap sementara “belum lengkap”/)
})
