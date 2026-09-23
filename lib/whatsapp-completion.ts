/**
 * Aturan pesan otomatis yang dipicu LENGKAPNYA ABSENSI, bukan jam.
 *
 * MENGAPA MODUL INI ADA
 *
 * Dua kartu bawaan absensi sebenarnya membawa DUA pesan yang berbeda sifat:
 *
 *   Kartu                        | Versi jam            | Versi final
 *   -----------------------------|----------------------|--------------------
 *   Kelas belum mengisi absensi  | MISSING_PENDING      | MISSING_COMPLETE
 *   Rekap siswa tidak hadir      | ABSENT_INCOMPLETE    | ABSENT_PRESENT/NONE
 *
 * Versi kiri adalah pengingat: ia hanya berguna selama masih ada kelas yang
 * belum melengkapi absensi, dan karena itu terikat pada jam yang diatur admin.
 * Versi kanan adalah laporan akhir hari: ia baru benar setelah SELURUH kelas
 * lengkap, dan menundanya sampai jam berikutnya berarti mengirim kabar lama —
 * atau, bila kelengkapan terjadi setelah jam terakhir, tidak mengirimnya sama
 * sekali.
 *
 * Karena itu versi final dipisahkan dari jadwal: ia dipicu peristiwa
 * "absensi hari ini pertama kali menjadi lengkap", sekali per tanggal sekolah.
 *
 * MURNI: tanpa Prisma, tanpa jam sistem, tanpa jaringan. Seluruh keadaan masuk
 * sebagai argumen, sehingga setiap kombinasi (belum lengkap di dua slot,
 * lengkap sebelum slot, lengkap di antara slot, lengkap tanpa slot sama
 * sekali, sunting mundur lalu lengkap lagi) dapat diuji tanpa database.
 */
import { messageIdempotencyKey, type WhatsAppMessageIdentity } from "@/lib/whatsapp-message"
import { incompleteClasses } from "@/lib/whatsapp-messages"
import type { WhatsAppReportClass } from "@/lib/whatsapp-report"
import type { WhatsAppMessageType } from "@/lib/whatsapp-schedule"

/**
 * Penanda "occurrence penyelesaian" pada kolom `scheduledSlot`.
 *
 * Sengaja BUKAN `HH:mm`: ia tidak boleh bertabrakan dengan slot mana pun yang
 * dapat diketik admin, dan ia harus terbaca manusia di riwayat pengiriman.
 * Nilainya ikut membentuk kunci idempotensi
 * (`attendance_absent:2026-09-16:LENGKAP`), sehingga satu tanggal hanya punya
 * satu occurrence penyelesaian per kartu — berapa pun kali worker restart,
 * berapa pun tick berjalan, dan berapa pun kali absensi disunting mundur lalu
 * dilengkapi lagi.
 */
export const COMPLETION_SLOT = "LENGKAP"

/** Label untuk layar; jangan dipakai sebagai nilai tersimpan. */
export const COMPLETION_SLOT_LABEL = "Rekap final"

/**
 * Berapa kali kegagalan transport boleh diulang untuk occurrence penyelesaian.
 *
 * Versi final TIDAK BOLEH hilang hanya karena WhatsApp sedang putus satu
 * menit — berbeda dari pengingat berjam, yang memang lebih baik tidak
 * dikirim terlambat. Tetapi percobaan juga tidak boleh tak terbatas: sesi yang
 * mati sepanjang hari akan mengetuk transport setiap menit sampai tengah
 * malam. Lima percobaan cukup untuk melewati putus sambung biasa, dan
 * kegagalan keenam tetap terlihat di riwayat sebagai kegagalan.
 */
export const MAX_COMPLETION_ATTEMPTS = 5

/** Apakah slot ini occurrence penyelesaian, bukan jam? */
export function isCompletionSlot(slot: string | null | undefined): boolean {
  if (!slot) return false
  return slot === COMPLETION_SLOT || slot.startsWith(`${COMPLETION_SLOT}#`)
}

/**
 * Nama occurrence untuk percobaan ke-`attempt` (1 = percobaan pertama).
 *
 * MENGAPA NOMOR PERCOBAAN MASUK KE DALAM IDENTITAS OCCURRENCE
 *
 * `idempotencyKey` adalah UNIQUE, dan klaim yang gagal dikirim ditandai FAILED
 * tanpa dihapus — itu memang yang diinginkan untuk slot berjam, karena
 * pengingat jam 08.00 yang gagal lebih baik hilang daripada datang jam 08.19.
 *
 * Rekap final tidak boleh hilang seperti itu: ia satu-satunya laporan hari itu.
 * Kalau kuncinya tetap, kegagalan pertama mengunci occurrence-nya selamanya dan
 * hari itu berakhir tanpa rekap. Kalau kuncinya dibuang saat gagal, dua worker
 * yang berjalan bersamaan dapat menulis dua klaim baru sekaligus.
 *
 * Nomor percobaan menyelesaikan keduanya: setiap percobaan punya kunci sendiri,
 * tetapi nomor itu DITURUNKAN dari jumlah kegagalan yang tercatat di database —
 * jadi dua proses yang membaca keadaan sama akan menghitung kunci yang sama,
 * dan yang kedua ditolak constraint sebelum transport disentuh.
 */
export function completionOccurrenceSlot(attempt: number): string {
  return attempt <= 1 ? COMPLETION_SLOT : `${COMPLETION_SLOT}#${attempt}`
}

/** Kunci idempotensi occurrence penyelesaian untuk satu kartu dan tanggal. */
export function completionIdempotencyKey(
  message: Pick<WhatsAppMessageIdentity, "id" | "kind" | "builtinType">,
  schoolDate: string,
  attempt: number,
): string {
  return messageIdempotencyKey(message, schoolDate, completionOccurrenceSlot(attempt))
}

/**
 * Jenis bawaan yang punya versi final berbasis kelengkapan.
 *
 * Notifikasi kunjungan UKS tidak termasuk: ia dipicu petugas, bukan absensi.
 */
export function isCompletionDrivenType(
  type: WhatsAppMessageType | null | undefined,
): type is "ATTENDANCE_MISSING" | "ATTENDANCE_ABSENT" {
  return type === "ATTENDANCE_MISSING" || type === "ATTENDANCE_ABSENT"
}

export type AttendanceCompletion = {
  /** Seluruh kelas yang wajib mengisi sudah lengkap pada saat diperiksa. */
  complete: boolean
  totalClasses: number
  incompleteCount: number
}

/**
 * Apakah absensi hari itu sudah lengkap?
 *
 * DEFINISI TIDAK DITULIS ULANG DI SINI. `incompleteClasses()` adalah sumber
 * yang sama dengan halaman rekap, `{{daftar_kelas_belum_rekap}}`, dan
 * pemilihan template — sehingga "lengkap" versi pemicu tidak mungkin berbeda
 * dari "lengkap" versi isi pesan. Sebuah kelas belum lengkap bila envelope
 * hariannya belum ada ATAU masih ada siswa aktif tanpa status; menekan Simpan
 * saja tidak cukup.
 *
 * NOL KELAS BUKAN LENGKAP. Daftar kosong berarti datanya tidak terbaca
 * (kelas belum ada, query gagal disaring, sekolah baru dipasang), dan
 * memperlakukannya sebagai "semua sudah rekap" akan mengirim laporan NIHIL
 * untuk sekolah yang belum punya satu pun kelas.
 */
export function attendanceCompletion(
  classes: readonly WhatsAppReportClass[],
): AttendanceCompletion {
  const incompleteCount = incompleteClasses(classes).length
  return {
    complete: classes.length > 0 && incompleteCount === 0,
    totalClasses: classes.length,
    incompleteCount,
  }
}

export type CompletionGuardReason = "NOT_COMPLETE" | "ALREADY_COMPLETE"

export type CompletionGuard =
  | { blocked: false }
  | {
      blocked: true
      reason: CompletionGuardReason
      detail: string
      /**
       * Apakah pembatalan ini MEMAKAI HABIS occurrence-nya.
       *
       * Untuk slot berjam: ya. Keadaan "sudah lengkap" hanya bergerak satu
       * arah dalam hari normal, dan tanpa klaim, tick berikutnya dalam masa
       * grace 20 menit akan memeriksa ulang lalu mengirim pengingat yang sudah
       * tidak berlaku begitu satu guru menyunting absensi mundur sesaat.
       *
       * Untuk occurrence penyelesaian: TIDAK. "Belum lengkap" adalah keadaan
       * sementara yang justru diharapkan berubah; menuliskannya sebagai klaim
       * akan membuang satu-satunya kesempatan mengirim rekap final hari itu.
       */
      claimsOccurrence: boolean
    }

/**
 * Boleh tidaknya sebuah occurrence terjadwal berangkat, menurut kelengkapan.
 *
 * ATURANNYA SATU KALIMAT: jam mengatur versi "belum", kelengkapan mengatur
 * versi "final".
 *
 *   slot jam       + belum lengkap  → kirim (pengingat / rekap sementara)
 *   slot jam       + sudah lengkap  → lewati, occurrence dipakai habis
 *   slot LENGKAP   + sudah lengkap  → kirim (rekap final)
 *   slot LENGKAP   + belum lengkap  → lewati TANPA klaim, coba lagi nanti
 *
 * Kiriman manual tidak pernah masuk ke sini: admin yang menekan tombol memang
 * meminta keadaan saat itu, apa pun keadaannya.
 */
export function completionGuard(input: {
  slot: string | null
  completion: AttendanceCompletion
}): CompletionGuard {
  if (isCompletionSlot(input.slot)) {
    if (input.completion.complete) return { blocked: false }
    return {
      blocked: true,
      reason: "NOT_COMPLETE",
      detail:
        input.completion.totalClasses === 0
          ? "Belum ada kelas yang dapat dinilai kelengkapannya."
          : `Masih ada ${input.completion.incompleteCount} kelas yang belum melengkapi absensi.`,
      claimsOccurrence: false,
    }
  }

  if (!input.completion.complete) return { blocked: false }
  return {
    blocked: true,
    reason: "ALREADY_COMPLETE",
    detail: "Seluruh kelas sudah melengkapi absensi sebelum jadwal ini berjalan.",
    claimsOccurrence: true,
  }
}

/**
 * Jejak occurrence penyelesaian satu kartu pada satu tanggal.
 *
 * Dibaca dari baris riwayat, bukan dari variabel proses: worker yang restart,
 * dua worker yang tidak sengaja hidup bersamaan, dan polling berulang harus
 * sampai pada jawaban yang sama.
 */
export type CompletionAttempts = {
  sent: boolean
  /** Ada klaim yang belum selesai — proses lain sedang mengirim. */
  processing: boolean
  failed: number
}

export const EMPTY_COMPLETION_ATTEMPTS: CompletionAttempts = {
  sent: false,
  processing: false,
  failed: 0,
}

/**
 * Masih perlukah occurrence penyelesaian dicoba?
 *
 * `processing` menahan percobaan baru: klaim itu dipegang PostgreSQL, dan
 * mencoba menembusnya hanya menghasilkan penolakan unik setiap menit. Baris
 * PROCESSING yang tertinggal karena proses mati di tengah pengiriman memang
 * TIDAK diulang otomatis — pesan pertamanya mungkin sudah sampai, dan rekap
 * ganda ke grup sekolah lebih buruk daripada rekap yang harus dikirim ulang
 * lewat "Kirim sekarang".
 */
export function shouldAttemptCompletion(
  attempts: CompletionAttempts = EMPTY_COMPLETION_ATTEMPTS,
): boolean {
  if (attempts.sent) return false
  if (attempts.processing) return false
  return attempts.failed < MAX_COMPLETION_ATTEMPTS
}
