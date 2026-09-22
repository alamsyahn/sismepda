/**
 * Penjagaan "hari ini memang ada aktivitas absensi".
 *
 * MASALAH YANG DIJAGA
 *
 * Kalender sekolah tidak pernah lengkap. Libur mendadak, kegiatan sekolah, dan
 * hari yang ternyata kosong tidak selalu tercatat sebagai hari libur, sehingga
 * scheduler tetap berjalan dan grup sekolah menerima "seluruh kelas belum
 * mengisi absensi" — pesan yang secara harfiah benar tetapi menyesatkan, dan
 * yang membuat penerima berhenti memercayai pesan otomatis.
 *
 * Indikator yang dipakai adalah ADA TIDAKNYA baris `AttendanceDay` pada tanggal
 * itu: satu kelas saja yang membuka absensi sudah berarti hari itu berjalan.
 * Bukan jumlah siswa hadir, karena hari yang berjalan pun bisa nihil kehadiran.
 *
 * MURNI: verdict masuk sebagai argumen boolean, tidak membaca database, agar
 * urutan penjagaan dapat diuji tanpa Prisma.
 */

export type AttendanceActivityDecision =
  | { blocked: false }
  | { blocked: true; reason: "NO_ATTENDANCE_ACTIVITY"; detail: string }

/**
 * Apakah occurrence ini harus dibatalkan karena hari tanpa aktivitas absensi?
 *
 * TIGA HAL YANG SENGAJA TIDAK MEMBLOKIR:
 *
 * 1. Kiriman manual. Admin yang menekan tombol tahu persis hari apa ini;
 *    memblokirnya membuat tombol tampak rusak.
 * 2. Kartu yang tidak mengaktifkan penjagaan (`required = false`), yaitu
 *    keadaan seluruh kartu tepat setelah migrasi — perilaku instalasi yang
 *    sudah berjalan tidak berubah sampai admin memilih mengubahnya.
 * 3. Hari yang punya aktivitas, sekecil apa pun.
 */
export function attendanceActivityDecision(input: {
  trigger: "SCHEDULED" | "MANUAL"
  required: boolean
  hasActivity: boolean
}): AttendanceActivityDecision {
  if (input.trigger !== "SCHEDULED") return { blocked: false }
  if (!input.required) return { blocked: false }
  if (input.hasActivity) return { blocked: false }
  return {
    blocked: true,
    reason: "NO_ATTENDANCE_ACTIVITY",
    detail: "Belum ada kelas yang mengisi absensi hari ini.",
  }
}

/**
 * MENGAPA PEMBATALAN INI DICATAT SEBAGAI KLAIM OCCURRENCE
 *
 * Penjagaan hari libur cukup `return` tanpa menulis baris: status libur tidak
 * berubah sepanjang hari, jadi tick berikutnya mengambil keputusan yang sama.
 * Aktivitas absensi TIDAK demikian — ia dapat berubah di tengah masa grace 20
 * menit. Occurrence 08.00 yang dibatalkan pada 08.01 akan lolos pada 08.07
 * ketika satu kelas mulai mengisi, sehingga pesan tetap terkirim, hanya telat
 * dan dengan isi yang berbeda dari yang dibatalkan.
 *
 * Karena itu pembatalan ini menulis baris SKIPPED BER-`idempotencyKey`:
 * occurrence-nya terpakai, dan keputusan "hari ini tidak dikirim" berlaku
 * untuk occurrence itu seterusnya, bukan hanya untuk satu tick.
 */
export const ATTENDANCE_ACTIVITY_CLAIMS_OCCURRENCE = true
