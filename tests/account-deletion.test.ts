/**
 * Perencanaan penghapusan akun.
 *
 * Penghapusan berbeda dari penonaktifan: ia tidak dapat dibatalkan dan memutus
 * atribusi historis. Dua relasi menunjuk ke `User` TANPA `onDelete`, sehingga
 * PostgreSQL memakai RESTRICT dan penghapusan akan gagal di level database:
 *
 *   - `AttendanceDay.submittedById`   — siapa mengirim absensi harian
 *   - `StudentViolationPoint.recordedById` — siapa mencatat poin pelanggaran
 *
 * Keduanya harus ditangani SECARA SADAR. Jalur hapus guru yang ada menangani
 * absensi saja (dialihkan ke admin penghapus) dan melewatkan poin pelanggaran —
 * itulah technical debt TD-009, yang muncul sebagai kegagalan FK mentah ketika
 * guru yang pernah mencatat pelanggaran dihapus.
 *
 * Berkas ini membuat konsekuensinya eksplisit dan dapat diuji sebelum ada baris
 * yang dihapus.
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { planAccountDeletion } from "../lib/account-deletion"

describe("planAccountDeletion", () => {
  it("mengalihkan atribusi absensi ke aktor penghapus", () => {
    const plan = planAccountDeletion({
      actorId: "admin-1",
      targetId: "guru-1",
      attendanceDays: 12,
      violationPoints: 0,
    })

    assert.equal(plan.blocked, false)
    assert.equal(plan.reassignAttendanceTo, "admin-1")
    assert.equal(plan.attendanceDays, 12)
  })

  it("melaporkan poin pelanggaran sebagai penghalang, bukan mengabaikannya", () => {
    // TD-009: tanpa penanganan eksplisit, penghapusan gagal dengan error FK
    // mentah yang tidak dapat ditindaklanjuti pengguna.
    const plan = planAccountDeletion({
      actorId: "admin-1",
      targetId: "guru-1",
      attendanceDays: 0,
      violationPoints: 3,
    })

    assert.equal(plan.blocked, true)
    assert.equal(plan.reason, "violation_points_attributed")
    assert.match(plan.message!, /poin pelanggaran/i)
    assert.match(plan.message!, /3/)
  })

  it("menyebut jumlah sebenarnya agar pengguna tahu skala dampaknya", () => {
    const plan = planAccountDeletion({
      actorId: "admin-1",
      targetId: "guru-1",
      attendanceDays: 0,
      violationPoints: 1,
    })

    assert.match(plan.message!, /1 /)
  })

  it("tidak terhalang ketika tidak ada atribusi apa pun", () => {
    const plan = planAccountDeletion({
      actorId: "admin-1",
      targetId: "guru-1",
      attendanceDays: 0,
      violationPoints: 0,
    })

    assert.equal(plan.blocked, false)
    assert.equal(plan.attendanceDays, 0)
  })

  it("menolak menghapus diri sendiri sebelum memeriksa atribusi", () => {
    // Urutan penting: pesan "Anda tidak dapat menghapus akun sendiri" lebih
    // berguna daripada keluhan tentang poin pelanggaran.
    const plan = planAccountDeletion({
      actorId: "admin-1",
      targetId: "admin-1",
      attendanceDays: 0,
      violationPoints: 9,
    })

    assert.equal(plan.blocked, true)
    assert.equal(plan.reason, "self_delete")
  })

  it("mengalihkan absensi meski jumlahnya besar, tanpa menghalangi", () => {
    // Pengalihan absensi adalah keputusan yang sudah diambil sistem lama dan
    // dipertahankan: riwayat kehadiran tidak boleh hilang hanya karena
    // pengirimnya dihapus.
    const plan = planAccountDeletion({
      actorId: "admin-1",
      targetId: "guru-1",
      attendanceDays: 27000,
      violationPoints: 0,
    })

    assert.equal(plan.blocked, false)
    assert.equal(plan.reassignAttendanceTo, "admin-1")
  })
})
