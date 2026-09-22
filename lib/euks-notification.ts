/**
 * Aturan notifikasi kunjungan UKS ke wali kelas — MURNI dan CLIENT-SAFE.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Tiga pertanyaan di sini dijawab di lebih dari satu tempat: apakah sebuah
 * kunjungan sudah pernah dinotifikasi (tabel + tombol), bagaimana bunyi status
 * di layar (tabel + toast), dan nilai placeholder apa yang masuk ke template
 * (service + preview). Menjawabnya di masing-masing tempat menghasilkan layar
 * yang menyatakan "Terkirim" untuk baris yang sebenarnya gagal.
 *
 * MURNI: tanpa Prisma, tanpa jaringan, tanpa jam sistem — sehingga komponen
 * klien boleh mengimpornya sebagai value.
 */
import type { TemplateContext } from "@/lib/whatsapp-template"

/** Cerminan enum Prisma `EuksNotifyStatus`, tanpa mengimpor klien Prisma. */
export type EuksNotifyStatus = "SENT" | "FAILED" | "SKIPPED"

export const EUKS_NOTIFY_STATUS_LABELS: Record<EuksNotifyStatus, string> = {
  SENT: "Terkirim",
  FAILED: "Gagal",
  SKIPPED: "Tidak dikirim",
}

/** Label kolom status untuk kunjungan yang belum pernah dinotifikasi. */
export const EUKS_NOTIFY_NEVER_LABEL = "Belum dikirim"

export function notifyStatusLabel(status: EuksNotifyStatus | null): string {
  return status === null ? EUKS_NOTIFY_NEVER_LABEL : EUKS_NOTIFY_STATUS_LABELS[status]
}

/**
 * Bunyi tombol pengiriman untuk satu baris.
 *
 * "Kirim Ulang" hanya muncul setelah ada pesan yang BENAR-BENAR terkirim.
 * Percobaan yang gagal atau dilewati tidak menghasilkan pesan di ponsel wali
 * kelas, sehingga menyebutnya "ulang" akan membuat petugas mengira wali kelas
 * sudah menerima sesuatu.
 */
export function notifyActionLabel(status: EuksNotifyStatus | null): "Kirim" | "Kirim Ulang" {
  return status === "SENT" ? "Kirim Ulang" : "Kirim"
}

/**
 * Apakah pengiriman ini perlu konfirmasi eksplisit lebih dulu?
 *
 * Ya, dan hanya, ketika pesan pertama sudah sampai: pesan kedua ke nomor wali
 * kelas tidak dapat ditarik kembali, dan klik yang tidak disengaja pada baris
 * yang sudah terkirim adalah kesalahan yang paling mudah terjadi.
 */
export function requiresResendConfirmation(status: EuksNotifyStatus | null): boolean {
  return status === "SENT"
}

export function resendConfirmationMessage(input: {
  studentName: string
  recipientName: string | null
}): string {
  const recipient = input.recipientName?.trim() || "wali kelas"
  return (
    `Notifikasi kunjungan ${input.studentName} sudah pernah terkirim ke ${recipient}. ` +
    "Kirim pesan sekali lagi?"
  )
}

/** Placeholder kosong ditampilkan sebagai tanda hubung, sama seperti rekap. */
const EMPTY = "-"

export type EuksVisitNotificationInput = {
  /** Tanggal kunjungan yang sudah diformat untuk dibaca manusia. */
  dateLabel: string
  schoolName: string
  studentName: string
  className: string
  homeroomName: string
  complaint: string
  treatment: string
  followUp: string | null
  recordedByName: string | null
}

/**
 * Nilai placeholder untuk template `EUKS_VISIT`.
 *
 * Tidak ada koleksi: notifikasi ini berbicara tentang satu siswa, dan
 * menyediakan daftar yang selalu berisi satu baris hanya akan mengundang
 * template yang tidak pernah terpakai.
 */
export function buildEuksVisitContext(input: EuksVisitNotificationInput): TemplateContext {
  return {
    scalars: {
      tanggal: input.dateLabel,
      nama_sekolah: input.schoolName,
      nama_siswa: input.studentName,
      nama_kelas: input.className,
      wali_kelas: input.homeroomName,
      keluhan: input.complaint.trim() || EMPTY,
      tindakan: input.treatment.trim() || EMPTY,
      tindak_lanjut: input.followUp?.trim() || EMPTY,
      petugas: input.recordedByName?.trim() || EMPTY,
    },
    collections: {},
  }
}

/**
 * Mengapa sebuah notifikasi tidak dapat dikirim.
 *
 * Alasannya dipisahkan sehalus ini karena tindakan pemulihannya berbeda:
 * nomor kosong diperbaiki di Data Master Guru, kelas tanpa wali diperbaiki di
 * pengaturan kelas, dan kartu yang belum punya template adalah urusan admin
 * WhatsApp. Satu pesan "gagal" untuk ketiganya membuat petugas UKS tidak tahu
 * harus menghubungi siapa.
 */
export type NotifyBlockReason =
  | "NO_HOMEROOM"
  | "NO_PHONE"
  | "INVALID_PHONE"
  | "NOT_CONNECTED"

export const NOTIFY_BLOCK_MESSAGES: Record<NotifyBlockReason, string> = {
  NO_HOMEROOM:
    "Kelas siswa ini belum punya wali kelas, sehingga notifikasi tidak dapat dikirim.",
  NO_PHONE:
    "Wali kelas belum memiliki nomor WhatsApp. Lengkapi nomornya di Data Master Guru lalu kirim ulang.",
  INVALID_PHONE:
    "Nomor WhatsApp wali kelas tidak valid. Perbaiki nomornya di Data Master Guru lalu kirim ulang.",
  NOT_CONNECTED:
    "WhatsApp sekolah sedang tidak terhubung. Hubungkan kembali lalu kirim ulang notifikasi ini.",
}

/**
 * Pesan blokir, disebutkan bersama kelas yang bersangkutan bila diketahui.
 *
 * Nama kelas dimasukkan karena petugas UKS mencatat banyak siswa berturut-turut
 * dan pesan tanpa kelas memaksa mereka menebak baris mana yang harus dibenahi.
 * Alasan koneksi sengaja TIDAK diberi nama kelas: penyebabnya ada pada sambungan
 * sekolah, dan menyebut satu kelas di situ mengarahkan orang memperbaiki data
 * yang sebenarnya sudah benar.
 */
export function notifyBlockMessage(
  reason: NotifyBlockReason,
  className?: string | null,
): string {
  const base = NOTIFY_BLOCK_MESSAGES[reason]
  const name = className?.trim()
  if (!name || reason === "NOT_CONNECTED") return base
  if (reason === "NO_HOMEROOM") {
    return `Kelas ${name} belum memiliki wali kelas, sehingga notifikasi tidak dapat dikirim.`
  }
  // Kalimat dasar sudah berawalan "Wali kelas"; nama kelas disisipkan ke dalam
  // frasa itu, bukan ditempel di depannya, supaya tidak terbaca ganda seperti
  // "Wali kelas 8A: wali kelas belum memiliki nomor".
  return base.replace(/^Wali kelas /, `Wali kelas ${name} `)
}
