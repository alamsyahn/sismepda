import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  diffSchedule,
  findConflicts,
  findConflictsAgainst,
  freeTeacherIds,
  summarizeDiff,
  type ScheduleEntryShape,
} from "../lib/schedule-diff"

function entry(partial: Partial<ScheduleEntryShape> = {}): ScheduleEntryShape {
  return {
    day: 3,
    period: 5,
    classId: "k1",
    subjectId: "m1",
    teacherId: "g1",
    room: null,
    ...partial,
  }
}

test("satu guru tidak boleh mengajar dua rombongan pada slot yang sama", () => {
  const conflicts = findConflicts([entry(), entry({ classId: "k2" })])
  assert.ok(conflicts.some((row) => row.kind === "teacher" && row.entityId === "g1"))
})

test("satu kelas tidak boleh punya dua pelajaran pada slot yang sama", () => {
  const conflicts = findConflicts([entry(), entry({ teacherId: "g2", subjectId: "m2" })])
  assert.ok(conflicts.some((row) => row.kind === "class" && row.entityId === "k1"))
})

test("slot berbeda tidak dianggap bentrok", () => {
  assert.deepEqual(findConflicts([entry(), entry({ period: 6 })]), [])
  assert.deepEqual(findConflicts([entry(), entry({ day: 4 })]), [])
})

test("entri identik pada slot yang sama tetap dilaporkan sebagai bentrok", () => {
  const conflicts = findConflicts([entry(), entry()])
  assert.ok(conflicts.length >= 2, "duplikat selalu berarti data salah")
})

test("menyunting entri tanpa memindahkan slotnya tidak bentrok dengan dirinya sendiri", () => {
  const existing = [entry({ id: "e1" })]
  const candidate = entry({ id: "e1", subjectId: "m2" })
  assert.deepEqual(findConflictsAgainst(existing, candidate), [])
})

test("memindahkan entri ke slot yang sudah terisi ditolak", () => {
  const existing = [entry({ id: "e1" }), entry({ id: "e2", period: 6, teacherId: "g2", classId: "k2" })]
  const candidate = entry({ id: "e2", period: 5, teacherId: "g2", classId: "k1" })

  const conflicts = findConflictsAgainst(existing, candidate)
  assert.ok(conflicts.some((row) => row.kind === "class"))
})

test("menambah entri baru pada slot guru yang sudah mengajar ditolak", () => {
  const existing = [entry({ id: "e1" })]
  const candidate = entry({ classId: "k2" })
  const conflicts = findConflictsAgainst(existing, candidate)
  assert.ok(conflicts.some((row) => row.kind === "teacher"))
})

test("diff memakai (hari, jam, kelas) sebagai identitas kotak jadwal", () => {
  const current = [
    entry({ id: "e1" }),
    entry({ id: "e2", period: 6 }),
    entry({ id: "e3", period: 7 }),
  ]
  const next = [
    entry(), // sama persis
    entry({ period: 6, teacherId: "g9" }), // ganti guru pada kotak yang sama
    entry({ period: 8 }), // kotak baru
  ]

  const diff = diffSchedule(current, next)
  assert.deepEqual(summarizeDiff(diff), { added: 1, changed: 1, removed: 1, unchanged: 1 })

  // Ganti guru muncul sebagai perubahan, bukan sepasang hapus+tambah.
  assert.equal(diff.changed[0].before.teacherId, "g1")
  assert.equal(diff.changed[0].after.teacherId, "g9")
  assert.equal(diff.removed[0].period, 7)
})

test("perubahan ruang dihitung sebagai perubahan isi", () => {
  const diff = diffSchedule([entry()], [entry({ room: "Lab Komputer" })])
  assert.equal(summarizeDiff(diff).changed, 1)
  assert.equal(summarizeDiff(diff).unchanged, 0)
})

test("impor yang identik dengan jadwal aktif tidak menghasilkan perubahan apa pun", () => {
  const rows = [entry({ id: "e1" }), entry({ id: "e2", period: 6 })]
  const diff = diffSchedule(rows, rows.map((row) => ({ ...row, id: undefined })))
  assert.deepEqual(summarizeDiff(diff), { added: 0, changed: 0, removed: 0, unchanged: 2 })
})

test("suntingan manual yang berbeda dari XML terlihat sebagai perubahan sebelum Apply", () => {
  // Admin mengganti pengajar Rabu jam ke-5 secara manual; XML minggu depan
  // masih memuat guru lama. Ini HARUS terlihat, bukan di-merge diam-diam.
  const aktif = [entry({ id: "e1", teacherId: "g-pengganti" })]
  const dariXml = [entry({ teacherId: "g1" })]

  const diff = diffSchedule(aktif, dariXml)
  assert.equal(diff.changed.length, 1)
  assert.equal(diff.changed[0].before.teacherId, "g-pengganti")
  assert.equal(diff.changed[0].after.teacherId, "g1")
})

test("jam kosong dihitung dari populasi guru, bukan dari isi jadwal", () => {
  const populasi = ["g1", "g2", "g3"]
  const entries = [entry({ teacherId: "g1" }), entry({ teacherId: "g2", period: 6, classId: "k2" })]

  // Pada Rabu jam ke-5 hanya g1 yang mengajar.
  assert.deepEqual(freeTeacherIds(populasi, entries, 3, 5), ["g2", "g3"])
  // g3 tidak punya jadwal sama sekali dan tetap harus muncul.
  assert.deepEqual(freeTeacherIds(populasi, entries, 4, 1), ["g1", "g2", "g3"])
})
