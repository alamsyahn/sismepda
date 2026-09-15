/**
 * Penyusun teks pesan WhatsApp otomatis.
 *
 * MURNI: tanpa Prisma, tanpa jaringan, tanpa jam sistem. Semua masukan
 * diberikan pemanggil, sehingga seluruh aturan bisnis di sini dapat diuji
 * tanpa database maupun koneksi WhatsApp.
 *
 * SUMBER DATA: tipe `WhatsAppReportClass` adalah bentuk yang sama yang dipakai
 * halaman `/laporan-whatsapp` (`lib/server-whatsapp-report.ts`). Modul ini
 * sengaja TIDAK membuat query sendiri — bila ia punya definisi "sudah mengisi
 * absensi" versi sendiri, angka yang dikirim ke grup akan menyimpang dari
 * angka yang dilihat admin di layar.
 */
import { reportClassName, type WhatsAppReportClass } from "@/lib/whatsapp-report"

/** Status ketidakhadiran, dalam urutan tetap untuk tampilan. */
const ABSENCE_ORDER = ["SAKIT", "IZIN", "ALFA", "DISPENSASI"] as const
type AbsenceStatus = (typeof ABSENCE_ORDER)[number]

const ABSENCE_LABELS: Record<AbsenceStatus, string> = {
  SAKIT: "SAKIT",
  IZIN: "IZIN",
  ALFA: "ALFA",
  DISPENSASI: "DISPENSASI",
}

/**
 * Kelas dianggap BELUM lengkap bila envelope harian belum ada, atau masih ada
 * siswa aktif tanpa status.
 *
 * Definisi ini mengikuti `buildClassesNotSubmittedReport` yang sudah dipakai
 * laporan existing: "submitted" saja tidak cukup, karena simpan sebagian juga
 * membuat `AttendanceDay` ada sementara sebagian siswa masih kosong.
 */
export function isClassIncomplete(schoolClass: WhatsAppReportClass): boolean {
  if (!schoolClass.submitted) return true
  return schoolClass.students.some((student) => student.status === null)
}

export function incompleteClasses(
  classes: readonly WhatsAppReportClass[],
): WhatsAppReportClass[] {
  return classes.filter(isClassIncomplete)
}

/** Header dua baris yang dipakai kedua jenis pesan. */
function header(title: string, dateLabel: string, slotLabel: string): string {
  return `*${title}*\n${dateLabel} • ${slotLabel} WIB`
}

/** "08:00" → "08.00"; WhatsApp Indonesia lazim memakai titik. */
export function slotLabel(slot: string): string {
  return slot.replace(":", ".")
}

/**
 * TYPE 1 — kelas yang belum mengisi absensi.
 *
 * Saat semua kelas sudah lengkap, pesan TETAP dikirim sebagai konfirmasi
 * NIHIL. Diam pada kondisi baik tidak dapat dibedakan dari worker yang mati.
 */
export function buildMissingAttendanceMessage(
  dateLabel: string,
  slot: string,
  classes: readonly WhatsAppReportClass[],
): string {
  const incomplete = incompleteClasses(classes)
  const top = header("REKAP ABSENSI", dateLabel, slotLabel(slot))

  if (incomplete.length === 0) {
    return `${top}\n\nSeluruh kelas telah mengisi absensi.\n\nNIHIL kelas yang belum melakukan rekap.`
  }

  const rows = incomplete.map((schoolClass, index) => {
    const unfilled = schoolClass.students.filter((student) => student.status === null).length
    // Membedakan "belum menyentuh sama sekali" dari "tersimpan sebagian":
    // keduanya menuntut tindakan berbeda dari wali kelas.
    const detail = schoolClass.submitted ? ` (kurang ${unfilled} siswa)` : ""
    return `${index + 1}. ${reportClassName(schoolClass.name)}${detail}`
  })

  return `${top}\n\nKelas yang belum mengisi absensi:\n\n${rows.join("\n")}\n\nTotal: ${incomplete.length} kelas.`
}

export type AbsentStudentLine = {
  className: string
  studentName: string
}

/**
 * TYPE 2 — rekap siswa tidak hadir.
 *
 * `BELUM` (status null) TIDAK pernah dihitung sebagai tidak hadir; ia berarti
 * datanya belum ada. Karena itu pesan NIHIL hanya boleh berbunyi "seluruh
 * siswa hadir" bila semua kelas sudah lengkap — bila tidak, pesan menyebut
 * jumlah kelas yang belum merekap, supaya pembaca tidak menyimpulkan sekolah
 * nihil ketidakhadiran padahal datanya memang belum masuk.
 */
export function buildAbsentStudentsMessage(
  dateLabel: string,
  slot: string,
  classes: readonly WhatsAppReportClass[],
): string {
  const top = header("REKAP SISWA TIDAK HADIR", dateLabel, slotLabel(slot))
  const pendingClasses = incompleteClasses(classes).length

  const byStatus = new Map<AbsenceStatus, AbsentStudentLine[]>()
  for (const schoolClass of classes) {
    // Deduplikasi per siswa: satu baris per siswa, bukan per baris data.
    const seen = new Set<string>()
    for (const student of schoolClass.students) {
      if (student.status === null) continue
      if (seen.has(student.id)) continue
      seen.add(student.id)
      const status = student.status as AbsenceStatus
      const lines = byStatus.get(status) ?? []
      lines.push({ className: reportClassName(schoolClass.name), studentName: student.name })
      byStatus.set(status, lines)
    }
  }

  const total = [...byStatus.values()].reduce((sum, lines) => sum + lines.length, 0)

  if (total === 0) {
    const note =
      pendingClasses > 0
        ? `\n\nTidak ditemukan siswa tidak hadir dari kelas yang telah melakukan rekap.\n\nCatatan: ${pendingClasses} kelas belum mengisi absensi sehingga data belum lengkap.`
        : "\n\nNIHIL\n\nSeluruh siswa yang telah direkap tercatat hadir."
    return `${top}${note}`
  }

  const sections = ABSENCE_ORDER.flatMap((status) => {
    const lines = byStatus.get(status)
    if (!lines || lines.length === 0) return []
    const body = lines
      .map((line) => `• ${line.className} — ${line.studentName}`)
      .join("\n")
    return [`*${ABSENCE_LABELS[status]} — ${lines.length}*\n${body}`]
  })

  const footer =
    pendingClasses > 0
      ? `\n\nTotal siswa tidak hadir: ${total}\n\nCatatan: ${pendingClasses} kelas belum mengisi absensi sehingga data belum lengkap.`
      : `\n\nTotal siswa tidak hadir: ${total}`

  return `${top}\n\n${sections.join("\n\n")}${footer}`
}
