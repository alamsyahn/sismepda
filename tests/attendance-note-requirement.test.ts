import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ABSENCE_REASONS,
  absenceNoteCopy,
  isNoteMissing,
  primaryStatusOf,
  requiresNote,
  studentsMissingNote,
  type InputStatus,
} from "../lib/attendance-input"
import { planAttendanceWrite } from "../lib/attendance-save"

const roster = [
  { id: "a", name: "Achmad Rizal" },
  { id: "b", name: "Bunga Lestari" },
  { id: "c", name: "Citra Dewi" },
]

test("alasan ketidakhadiran memetakan ke status utama Tidak Hadir", () => {
  for (const reason of ABSENCE_REASONS) {
    assert.equal(primaryStatusOf(reason), "tidakHadir")
  }
})

test("hadir dan belum tetap menjadi status utamanya sendiri", () => {
  assert.equal(primaryStatusOf("hadir"), "hadir")
  assert.equal(primaryStatusOf("belum"), "belum")
})

test("keterangan wajib untuk semua jenis ketidakhadiran", () => {
  for (const reason of ABSENCE_REASONS) {
    assert.equal(requiresNote(reason), true)
    assert.equal(isNoteMissing(reason, ""), true)
    assert.equal(isNoteMissing(reason, "   "), true)
    assert.equal(isNoteMissing(reason, "Demam"), false)
  }
})

test("hadir dan belum tidak memerlukan keterangan", () => {
  assert.equal(requiresNote("hadir"), false)
  assert.equal(requiresNote("belum"), false)
  assert.equal(isNoteMissing("hadir", ""), false)
  assert.equal(isNoteMissing("belum", undefined), false)
})

test("setiap alasan punya label, placeholder, dan pesan error sendiri", () => {
  assert.equal(absenceNoteCopy.sakit.placeholder, "Contoh: Demam")
  assert.equal(absenceNoteCopy.izin.placeholder, "Contoh: Acara Keluarga")
  assert.equal(absenceNoteCopy.alfa.placeholder, "Contoh: Tidak ada surat")
  assert.equal(absenceNoteCopy.dispensasi.placeholder, "Contoh: Mengikuti kompetisi sepakbola")
  assert.deepEqual(
    ABSENCE_REASONS.map((reason) => absenceNoteCopy[reason].error),
    [
      "Masukkan keterangan sakit",
      "Masukkan keterangan izin",
      "Masukkan keterangan alfa",
      "Masukkan keterangan dispensasi",
    ],
  )
  assert.deepEqual(
    ABSENCE_REASONS.map((reason) => absenceNoteCopy[reason].label),
    ["Keterangan sakit", "Keterangan izin", "Keterangan alfa", "Keterangan dispensasi"],
  )
})

test("penyimpanan tertahan selama ada keterangan wajib yang kosong", () => {
  const statuses: Record<string, InputStatus> = { a: "sakit", b: "hadir", c: "alfa" }
  const notes: Record<string, string> = { a: "", b: "", c: "Tanpa kabar" }
  assert.deepEqual(
    studentsMissingNote(roster, statuses, notes).map((s) => s.id),
    ["a"],
  )
})

test("siswa bermasalah dikembalikan sesuai urutan roster", () => {
  const statuses: Record<string, InputStatus> = { a: "izin", b: "belum", c: "dispensasi" }
  assert.deepEqual(
    studentsMissingNote(roster, statuses, {}).map((s) => s.id),
    ["a", "c"],
  )
})

test("tidak ada siswa bermasalah ketika seluruh keterangan terisi", () => {
  const statuses: Record<string, InputStatus> = { a: "sakit", b: "hadir", c: "belum" }
  const notes: Record<string, string> = { a: "Demam" }
  assert.deepEqual(studentsMissingNote(roster, statuses, notes), [])
})

test("Tidak Hadir tanpa alasan tetap terkirim sebagai belum diisi", () => {
  // "Tidak Hadir" hanyalah konsep UI: tanpa alasan, tidak ada status
  // ketidakhadiran yang boleh tersimpan.
  const plan = planAttendanceWrite([{ studentId: "a", status: "BELUM" }])
  assert.deepEqual(plan.upserts, [])
  assert.deepEqual(plan.clears, ["a"])
})

test("alasan yang dipilih tersimpan sebagai status database aslinya", () => {
  const plan = planAttendanceWrite([
    { studentId: "a", status: "SAKIT", note: "Demam" },
    { studentId: "b", status: "IZIN", note: "Acara keluarga" },
    { studentId: "c", status: "ALFA", note: "Tidak ada surat" },
    { studentId: "d", status: "DISPENSASI", note: "Lomba" },
  ])
  assert.deepEqual(
    plan.upserts.map((u) => u.status),
    ["SAKIT", "IZIN", "ALFA", "DISPENSASI"],
  )
})

test("data absensi existing dapat dibuka kembali dengan substatus terpilih", () => {
  // Meniru pemuatan record tersimpan pada form.
  const saved = [
    { studentId: "a", status: "SAKIT", note: "Demam" },
    { studentId: "b", status: "HADIR", note: null },
  ]
  const statuses: Record<string, InputStatus> = {}
  const notes: Record<string, string> = {}
  for (const student of roster) {
    const record = saved.find((item) => item.studentId === student.id)
    statuses[student.id] = (record?.status.toLowerCase() as InputStatus) ?? "belum"
    notes[student.id] = record?.note ?? ""
  }
  assert.equal(primaryStatusOf(statuses.a), "tidakHadir")
  assert.equal(statuses.a, "sakit")
  assert.equal(notes.a, "Demam")
  assert.equal(primaryStatusOf(statuses.b), "hadir")
  assert.equal(primaryStatusOf(statuses.c), "belum")
  assert.deepEqual(studentsMissingNote(roster, statuses, notes), [])
})
