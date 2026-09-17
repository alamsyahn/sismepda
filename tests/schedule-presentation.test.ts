/**
 * Regresi untuk aturan TAMPILAN modul Jadwal.
 *
 * Yang diuji hanyalah keputusan presentasi yang bisa salah diam-diam:
 * nada semantic sebuah slot, penanda "sedang berlangsung", dan urutan kelas.
 * Tata letak/kelas Tailwind tidak diuji di sini — yang berharga dijaga adalah
 * aturannya, bukan string kelas yang wajar berubah saat desain disetel.
 */
import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  SLOT_TONE_CLASS,
  isCurrentSlot,
  slotKindLabel,
  slotTone,
  sortClassesForDisplay,
} from "../lib/schedule-presentation"
import type { CurrentSlotResult, TimeSlot } from "../lib/schedule-time"

function slot(overrides: Partial<TimeSlot> = {}): TimeSlot {
  return {
    id: "slot-1",
    position: 1,
    kind: "PELAJARAN",
    name: "Jam ke-1",
    startMinute: 420,
    endMinute: 460,
    ascPeriod: 1,
    ...overrides,
  }
}

// --- A. nada semantic ------------------------------------------------------

test("pelajaran terisi dan jam kosong dibedakan", () => {
  assert.equal(slotTone(slot(), true), "lesson")
  assert.equal(slotTone(slot(), false), "empty")
})

test("istirahat dan kegiatan sekolah punya nada sendiri", () => {
  assert.equal(slotTone(slot({ kind: "ISTIRAHAT" }), false), "break")
  assert.equal(slotTone(slot({ kind: "KEGIATAN" }), false), "activity")
})

test("pelajaran tidak diberi tint agar tetap yang paling menonjol", () => {
  assert.equal(SLOT_TONE_CLASS.lesson, "")
  assert.notEqual(SLOT_TONE_CLASS.break, "")
  assert.notEqual(SLOT_TONE_CLASS.activity, "")
})

test("setiap nada punya label teks, bukan hanya warna", () => {
  // Syarat aksesibilitas: status tidak boleh dibedakan warna saja.
  assert.equal(slotKindLabel(slot({ kind: "ISTIRAHAT", name: "Istirahat 1" })), "Istirahat")
  assert.equal(slotKindLabel(slot({ kind: "KEGIATAN", name: "Upacara Bendera" })), "Upacara Bendera")
  assert.equal(slotKindLabel(slot({ kind: "PELAJARAN" })), "Jam pelajaran")
})

test("kegiatan tanpa nama tetap punya label yang terbaca", () => {
  assert.equal(slotKindLabel(slot({ kind: "KEGIATAN", name: "   " })), "Kegiatan sekolah")
})

// --- B. penanda "Sekarang" -------------------------------------------------

test("slot berjalan hanya ditandai pada hari ini", () => {
  const current: CurrentSlotResult = { state: "lesson", slot: slot({ id: "s-3" }), period: 3 }
  assert.equal(isCurrentSlot(current, { id: "s-3" }, true), true)
  // Bug yang dijaga: membuka jadwal Kamis tidak boleh menyalakan jam Senin.
  assert.equal(isCurrentSlot(current, { id: "s-3" }, false), false)
})

test("di luar jam sekolah tidak ada slot yang ditandai", () => {
  const current: CurrentSlotResult = { state: "outside" }
  assert.equal(isCurrentSlot(current, { id: "s-3" }, true), false)
})

test("saat istirahat, slot istirahat itulah yang ditandai", () => {
  const current: CurrentSlotResult = { state: "break", slot: slot({ id: "s-break", kind: "ISTIRAHAT" }) }
  assert.equal(isCurrentSlot(current, { id: "s-break" }, true), true)
  assert.equal(isCurrentSlot(current, { id: "s-4" }, true), false)
})

// --- C. urutan kelas -------------------------------------------------------

test("kelas diurutkan VII lalu VIII lalu IX, bukan alfabet", () => {
  // Urutan basis data (name asc) menaruh IX A paling depan.
  const input = [
    { name: "IX A", grade: "IX" },
    { name: "VII B", grade: "VII" },
    { name: "VIII A", grade: "VIII" },
    { name: "VII A", grade: "VII" },
    { name: "IX I", grade: "IX" },
  ]
  assert.deepEqual(
    sortClassesForDisplay(input).map((item) => item.name),
    ["VII A", "VII B", "VIII A", "IX A", "IX I"],
  )
})

test("urutan penuh 27 kelas dimulai VII A dan berakhir IX I", () => {
  const grades = ["VII", "VIII", "IX"]
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I"]
  const all = grades.flatMap((grade) => letters.map((letter) => ({ name: `${grade} ${letter}`, grade })))
  // Diacak supaya urutan benar bukan kebetulan urutan masukan.
  const shuffled = [...all].sort((a, b) => a.name.localeCompare(b.name))

  const sorted = sortClassesForDisplay(shuffled)
  assert.equal(sorted.length, 27)
  assert.equal(sorted[0].name, "VII A")
  assert.equal(sorted[26].name, "IX I")
})

test("kelas bertingkat tak dikenal tetap tampil, ditaruh di belakang", () => {
  const input = [
    { name: "Kelas Khusus", grade: "X" },
    { name: "VII A", grade: "VII" },
  ]
  const sorted = sortClassesForDisplay(input)
  // Menyembunyikan data karena namanya tak terduga adalah kegagalan diam-diam.
  assert.equal(sorted.length, 2)
  assert.equal(sorted[0].name, "VII A")
  assert.equal(sorted[1].name, "Kelas Khusus")
})

test("pengurutan tidak mengubah array masukan", () => {
  const input = [
    { name: "IX A", grade: "IX" },
    { name: "VII A", grade: "VII" },
  ]
  sortClassesForDisplay(input)
  assert.equal(input[0].name, "IX A")
})
