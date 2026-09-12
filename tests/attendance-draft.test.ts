import assert from "node:assert/strict"
import test from "node:test"

import {
  applyDraft,
  attendanceInputHref,
  draftDiffersFromServer,
  parseDraft,
  parseReturnPosition,
  serializeDraft,
  serializeReturnPosition,
  studentRowId,
  type AttendanceDraft,
  type RosterState,
} from "../lib/attendance-draft"
import type { InputStatus } from "../lib/attendance-input"

const DRAFT: AttendanceDraft = {
  classId: "kelas-8a",
  date: "2026-02-10",
  statuses: { s1: "sakit", s2: "hadir" },
  notes: { s1: "Demam" },
  absentPending: { s3: true },
}

function serverState(): RosterState {
  return {
    statuses: { s1: "belum", s2: "belum", s3: "belum" } as Record<string, InputStatus>,
    notes: { s1: "", s2: "", s3: "" },
    absentPending: {},
  }
}

test("draft pulih untuk kelas dan tanggal yang sama", () => {
  const parsed = parseDraft(serializeDraft(DRAFT), "kelas-8a", "2026-02-10")
  assert.ok(parsed)
  assert.equal(parsed.statuses.s1, "sakit")
  assert.equal(parsed.notes.s1, "Demam")
  assert.deepEqual(parsed.absentPending, { s3: true })
})

test("draft ditolak untuk kelas atau tanggal lain", () => {
  const raw = serializeDraft(DRAFT)
  assert.equal(parseDraft(raw, "kelas-8b", "2026-02-10"), null)
  assert.equal(parseDraft(raw, "kelas-8a", "2026-02-11"), null)
})

test("draft rusak atau kosong tidak menghentikan halaman", () => {
  assert.equal(parseDraft(null, "kelas-8a", "2026-02-10"), null)
  assert.equal(parseDraft("bukan json", "kelas-8a", "2026-02-10"), null)
  assert.equal(parseDraft("[]", "kelas-8a", "2026-02-10"), null)
  assert.equal(
    parseDraft(JSON.stringify({ classId: "kelas-8a", date: "2026-02-10" }), "kelas-8a", "2026-02-10"),
    null,
  )
})

test("draft hanya menimpa siswa yang masih ada di roster", () => {
  const parsed = parseDraft(serializeDraft(DRAFT), "kelas-8a", "2026-02-10")
  const restored = applyDraft(serverState(), parsed, ["s1", "s2", "s3"])
  assert.equal(restored.statuses.s1, "sakit")
  assert.equal(restored.notes.s1, "Demam")
  assert.deepEqual(restored.absentPending, { s3: true })

  // Siswa yang sudah tidak ada di kelas tidak boleh ikut kembali.
  const narrowed = applyDraft(serverState(), parsed, ["s2", "s3"])
  assert.equal(narrowed.statuses.s1, "belum")
  assert.equal(narrowed.notes.s1, "")
})

test("status tidak dikenal pada draft diabaikan", () => {
  const raw = JSON.stringify({
    classId: "kelas-8a",
    date: "2026-02-10",
    statuses: { s1: "libur" },
    notes: {},
    absentPending: {},
  })
  const parsed = parseDraft(raw, "kelas-8a", "2026-02-10")
  assert.ok(parsed)
  assert.deepEqual(parsed.statuses, {})
})

test("tanpa draft, data server dipakai apa adanya", () => {
  const server = serverState()
  const restored = applyDraft(server, null, ["s1", "s2", "s3"])
  assert.deepEqual(restored, server)
  assert.equal(draftDiffersFromServer(server, restored), false)
})

test("draft yang berbeda dari server menandai perubahan belum disimpan", () => {
  const server = serverState()
  const parsed = parseDraft(serializeDraft(DRAFT), "kelas-8a", "2026-02-10")
  const restored = applyDraft(server, parsed, ["s1", "s2", "s3"])
  assert.equal(draftDiffersFromServer(server, restored), true)
})

test("draft identik dengan data server tidak menandai perubahan", () => {
  const server: RosterState = {
    statuses: { s1: "sakit" } as Record<string, InputStatus>,
    notes: { s1: "Demam" },
    absentPending: {},
  }
  const raw = serializeDraft({
    classId: "kelas-8a",
    date: "2026-02-10",
    statuses: { s1: "sakit" },
    notes: { s1: "Demam" },
    absentPending: {},
  })
  const restored = applyDraft(server, parseDraft(raw, "kelas-8a", "2026-02-10"), ["s1"])
  assert.equal(draftDiffersFromServer(server, restored), false)
})

test("posisi kembali hanya berlaku pada kelas dan tanggal yang sama", () => {
  const raw = serializeReturnPosition({ classId: "kelas-8a", date: "2026-02-10", studentId: "s20" })
  assert.deepEqual(parseReturnPosition(raw, "kelas-8a", "2026-02-10"), {
    classId: "kelas-8a",
    date: "2026-02-10",
    studentId: "s20",
  })
  assert.equal(parseReturnPosition(raw, "kelas-8b", "2026-02-10"), null)
  assert.equal(parseReturnPosition(raw, "kelas-8a", "2026-02-12"), null)
  assert.equal(parseReturnPosition(null, "kelas-8a", "2026-02-10"), null)
  assert.equal(parseReturnPosition("{}", "kelas-8a", "2026-02-10"), null)
})

test("id baris siswa stabil dan berbeda antar tampilan", () => {
  assert.equal(studentRowId("s20", "desktop"), "student-s20")
  assert.equal(studentRowId("s20", "mobile"), "student-mobile-s20")
})

test("URL Input Absensi membawa kelas dan tanggal", () => {
  assert.equal(attendanceInputHref("kelas-8a", "2026-02-10"), "/absensi/input?classId=kelas-8a&date=2026-02-10")
  assert.equal(attendanceInputHref("", ""), "/absensi/input")
})

/**
 * Alur lengkap: pilih kelas -> isi sebagian -> klik siswa -> Profil Siswa ->
 * Back. Memakai sessionStorage tiruan supaya urutan simpan/baca/bersihkan yang
 * dipakai halaman benar-benar teruji tanpa perlu merender komponen.
 */
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    size: () => data.size,
  }
}

test("alur pilih kelas -> klik siswa -> back memulihkan kelas, isian, dan posisi", () => {
  const storage = fakeStorage()
  const classId = "kelas-8a"
  const date = "2026-02-10"

  // Server belum punya data absensi hari ini.
  const server = serverState()

  // Pengguna mengisi sebagian, lalu membuka profil siswa nomor 20 (s3).
  const working: AttendanceDraft = {
    classId,
    date,
    statuses: { s1: "sakit", s2: "hadir", s3: "belum" },
    notes: { s1: "Demam", s2: "", s3: "" },
    absentPending: { s3: true },
  }
  storage.setItem("draft", serializeDraft(working))
  storage.setItem("return", serializeReturnPosition({ classId, date, studentId: "s3" }))

  // Kembali dari profil: URL membawa classId sehingga kelas tidak kosong lagi.
  assert.equal(attendanceInputHref(classId, date), "/absensi/input?classId=kelas-8a&date=2026-02-10")

  const restored = applyDraft(server, parseDraft(storage.getItem("draft"), classId, date), [
    "s1",
    "s2",
    "s3",
  ])
  assert.equal(restored.statuses.s1, "sakit")
  assert.equal(restored.notes.s1, "Demam")
  assert.equal(restored.statuses.s2, "hadir")
  // "Tidak Hadir" tanpa alasan tetap pending, bukan status database.
  assert.equal(restored.statuses.s3, "belum")
  assert.deepEqual(restored.absentPending, { s3: true })
  assert.equal(draftDiffersFromServer(server, restored), true)

  // Posisi kembali menunjuk siswa yang tadi diklik, lalu dipakai sekali saja.
  const position = parseReturnPosition(storage.getItem("return"), classId, date)
  assert.equal(position?.studentId, "s3")
  assert.equal(studentRowId(position!.studentId, "desktop"), "student-s3")
  storage.removeItem("return")
  assert.equal(parseReturnPosition(storage.getItem("return"), classId, date), null)

  // Setelah Simpan berhasil draft dibuang; kunjungan berikutnya murni data server.
  storage.removeItem("draft")
  assert.equal(storage.size(), 0)
  assert.deepEqual(applyDraft(server, parseDraft(storage.getItem("draft"), classId, date), ["s1"]), server)
})
