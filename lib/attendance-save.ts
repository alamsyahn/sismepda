/**
 * Logika murni untuk penyimpanan absensi (dipakai POST /api/attendance).
 *
 * SISMEPDA merepresentasikan "belum diisi" sebagai TIDAK ADANYA baris
 * `Attendance` untuk pasangan (attendanceDay, student) — bukan sebagai nilai
 * enum tersendiri. Enum `AttendanceStatus` di database sengaja hanya memuat
 * lima status nyata, dan seluruh pembaca (rekap, dashboard, laporan WA, tren)
 * sudah menafsirkan record yang hilang sebagai "belum diisi".
 *
 * Karena itu payload dari form memakai sentinel "BELUM" pada level wire saja,
 * lalu diterjemahkan di sini menjadi penghapusan baris.
 */

export const FILLED_WIRE_STATUSES = ["HADIR", "SAKIT", "IZIN", "ALFA", "DISPENSASI"] as const
export type FilledWireStatus = (typeof FILLED_WIRE_STATUSES)[number]

/** Sentinel "belum diisi" pada payload; tidak pernah disimpan ke database. */
export const UNFILLED_WIRE_STATUS = "BELUM"
export type WireStatus = FilledWireStatus | typeof UNFILLED_WIRE_STATUS

export type WireRecord = { studentId: string; status: WireStatus; note?: string }

export type AttendancePlan = {
  /** Siswa yang punya status nyata: baris di-upsert. */
  upserts: Array<{ studentId: string; status: FilledWireStatus; note: string | null }>
  /** Siswa yang dikosongkan: barisnya dihapus agar kembali "belum diisi". */
  clears: string[]
}

export function isFilledWireStatus(status: WireStatus): status is FilledWireStatus {
  return status !== UNFILLED_WIRE_STATUS
}

/**
 * Pisahkan payload menjadi baris yang ditulis dan baris yang dikosongkan.
 *
 * Catatan penting soal update parsial: form Input Absensi selalu mengirim
 * SELURUH roster kelas, dengan status yang sudah dimuat dari server untuk
 * siswa yang tidak disentuh. Jadi siswa yang tidak diubah tetap ikut sebagai
 * upsert dengan nilai lamanya dan tidak akan berubah. "clears" hanya berisi
 * siswa yang memang sedang bernilai "belum diisi" di layar — inilah yang
 * membuat "Kosongkan Semua" tetap bekerja seperti sebelumnya.
 */
export function planAttendanceWrite(records: WireRecord[]): AttendancePlan {
  const upserts: AttendancePlan["upserts"] = []
  const clears: string[] = []

  for (const record of records) {
    if (isFilledWireStatus(record.status)) {
      const note = record.note?.trim()
      upserts.push({ studentId: record.studentId, status: record.status, note: note ? note : null })
    } else {
      clears.push(record.studentId)
    }
  }

  return { upserts, clears }
}

/**
 * Sebuah kelas dianggap SELESAI DIREKAP hanya jika setiap siswa aktif yang
 * wajib diabsen sudah memiliki status. Menyimpan data parsial diperbolehkan,
 * tetapi tidak menjadikan kelas tersebut lengkap.
 */
export function isClassRecapComplete(input: { totalStudents: number; recorded: number }): boolean {
  return input.totalStudents > 0 && input.recorded >= input.totalStudents
}
