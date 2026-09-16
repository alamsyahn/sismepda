/**
 * Kebijakan "slot mana yang boleh dikirim sekarang".
 *
 * MURNI: waktu, jadwal, dan status libur semuanya masuk sebagai argumen.
 * Tidak membaca jam sistem, tidak menyentuh database — sehingga perilaku pada
 * batas tengah malam WIB maupun setelah worker mati dapat diuji secara pasti.
 */
import type { WhatsAppMessageType } from "@/lib/whatsapp-schedule"

/**
 * Jadwal yang sedang berlaku, sebagaimana tersimpan di database.
 *
 * Diterima sebagai argumen, tidak dibaca dari konstanta: jam dapat disunting
 * admin, dan modul ini harus menjawab menurut pengaturan yang berlaku saat itu.
 */
export type ConfiguredSchedule = { type: WhatsAppMessageType; slots: readonly string[] }

/**
 * Seberapa lama setelah jamnya sebuah slot masih pantas dikirim.
 *
 * Inilah aturan §V: worker yang mati pukul 07.50 dan hidup pukul 11.30 TIDAK
 * boleh tiba-tiba mengirim pesan slot 08.00. Pesan "kelas belum mengisi
 * absensi pukul 08.00" yang tiba pukul setengah dua belas bukan sekadar telat
 * — isinya menyesatkan, karena keadaannya sudah berubah.
 */
export const SLOT_GRACE_MINUTES = 20

export type SlotDecision =
  | { due: true; type: WhatsAppMessageType; slot: string }
  | { due: false; reason: "NOT_YET" | "EXPIRED" }

/** Ubah `HH:mm` menjadi menit sejak tengah malam. */
export function slotMinutes(slot: string): number {
  const match = slot.match(/^(\d{2}):(\d{2})$/)
  if (!match) throw new Error(`Slot jadwal tidak valid: ${slot}`)
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Apakah satu slot jatuh tempo pada menit tertentu dalam hari sekolah.
 *
 * `nowMinutes` adalah menit-dalam-hari menurut ZONA WAKTU SEKOLAH, bukan
 * menurut jam container. Pemanggil bertanggung jawab memproyeksikannya
 * (`schoolMinutesOfDay`), sehingga modul ini tidak pernah bergantung pada TZ
 * sistem operasi.
 */
export function slotDecision(
  slot: string,
  nowMinutes: number,
  graceMinutes: number = SLOT_GRACE_MINUTES,
): { due: boolean; reason: "DUE" | "NOT_YET" | "EXPIRED" } {
  const target = slotMinutes(slot)
  if (nowMinutes < target) return { due: false, reason: "NOT_YET" }
  if (nowMinutes > target + graceMinutes) return { due: false, reason: "EXPIRED" }
  return { due: true, reason: "DUE" }
}

/**
 * Seluruh slot yang jatuh tempo saat ini, lintas jenis pesan.
 *
 * Hari libur tidak ditangani di sini: pemanggil menentukannya lebih dulu dari
 * kalender sekolah, karena itulah satu-satunya sumber kebenaran hari aktif.
 */
export function dueSlots(
  schedule: readonly ConfiguredSchedule[],
  nowMinutes: number,
  graceMinutes: number = SLOT_GRACE_MINUTES,
): { type: WhatsAppMessageType; slot: string }[] {
  const due: { type: WhatsAppMessageType; slot: string }[] = []
  for (const definition of schedule) {
    for (const slot of definition.slots) {
      if (slotDecision(slot, nowMinutes, graceMinutes).due) {
        due.push({ type: definition.type, slot })
      }
    }
  }
  return due
}

/** Slot yang sudah terlewat hari ini — untuk pemantauan, bukan untuk dikirim. */
export function missedSlots(
  schedule: readonly ConfiguredSchedule[],
  nowMinutes: number,
  graceMinutes: number = SLOT_GRACE_MINUTES,
): { type: WhatsAppMessageType; slot: string }[] {
  const missed: { type: WhatsAppMessageType; slot: string }[] = []
  for (const definition of schedule) {
    for (const slot of definition.slots) {
      if (slotDecision(slot, nowMinutes, graceMinutes).reason === "EXPIRED") {
        missed.push({ type: definition.type, slot })
      }
    }
  }
  return missed
}
