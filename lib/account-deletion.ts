/**
 * Perencanaan penghapusan akun — bagian MURNI.
 *
 * Dua relasi menunjuk `User` tanpa `onDelete`, sehingga PostgreSQL memakai
 * RESTRICT dan `user.delete` gagal di level database:
 *
 *   - `AttendanceDay.submittedById`
 *   - `StudentViolationPoint.recordedById`
 *
 * Kebijakan berbeda untuk keduanya, dan perbedaan itu disengaja:
 *
 * ABSENSI dialihkan ke aktor penghapus. Riwayat kehadiran siswa adalah catatan
 * sekolah yang tidak boleh hilang hanya karena guru pengirimnya dihapus. Ini
 * melanjutkan perilaku jalur hapus guru yang sudah ada.
 *
 * POIN PELANGGARAN MENGHALANGI penghapusan. Mengalihkannya berarti menulis ulang
 * siapa yang menuduh seorang siswa melakukan pelanggaran — pemalsuan catatan
 * disipliner, bukan pembersihan data. Menghapusnya berarti membuang riwayat
 * disipliner siswa, yang bukan milik akun guru tersebut. Karena tidak ada
 * perlakuan otomatis yang benar, operator harus memutuskan sendiri; sistem
 * menolak dengan jumlah yang jelas alih-alih menebak.
 *
 * Tanpa pemeriksaan ini, penghapusan gagal dengan error FK mentah yang tidak
 * dapat ditindaklanjuti pengguna — technical debt TD-009.
 */

export type DeletionBlockReason = "self_delete" | "violation_points_attributed"

export type AccountDeletionPlan = {
  blocked: boolean
  reason?: DeletionBlockReason
  message?: string
  /** Penerima atribusi absensi; selalu aktor penghapus. */
  reassignAttendanceTo: string
  attendanceDays: number
}

export function planAccountDeletion(input: {
  actorId: string
  targetId: string
  attendanceDays: number
  violationPoints: number
}): AccountDeletionPlan {
  const base = {
    reassignAttendanceTo: input.actorId,
    attendanceDays: input.attendanceDays,
  }

  // Diperiksa lebih dulu: pesan tentang menghapus diri sendiri lebih berguna
  // daripada keluhan soal atribusi.
  if (input.actorId === input.targetId) {
    return {
      ...base,
      blocked: true,
      reason: "self_delete",
      message: "Anda tidak dapat menghapus akun Anda sendiri.",
    }
  }

  if (input.violationPoints > 0) {
    return {
      ...base,
      blocked: true,
      reason: "violation_points_attributed",
      message:
        `Akun ini tercatat sebagai pencatat ${input.violationPoints} poin pelanggaran siswa. ` +
        "Atribusi catatan disipliner tidak dapat dialihkan secara otomatis. " +
        "Nonaktifkan akun ini, atau pindahkan catatan tersebut lebih dahulu.",
    }
  }

  return { ...base, blocked: false }
}
