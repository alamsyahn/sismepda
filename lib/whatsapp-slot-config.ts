/**
 * Aturan jadwal yang dapat disunting admin.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Jam pengiriman dahulu berupa konstanta di `whatsapp-schedule.ts`, sehingga
 * sekolah yang ingin menggeser 08:00 menjadi 07:30 harus menunggu rilis. Kini
 * jam tersimpan di database, dan berkas inilah yang menjaga bentuknya tetap
 * sah sebelum menyentuh baik layar maupun scheduler.
 *
 * Murni: tanpa Prisma dan tanpa API Node, agar form admin dan validasi server
 * memakai aturan yang sama persis. Dua tempat yang memvalidasi sendiri-sendiri
 * pada akhirnya akan berbeda pendapat, dan yang kalah adalah scheduler.
 */

/** `HH:mm` 24 jam, dengan nol di depan. */
const SLOT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export const MAX_SLOTS_PER_TYPE = 12

export type SlotsError =
  | { code: "INVALID_FORMAT"; slot: string }
  | { code: "DUPLICATE"; slot: string }
  | { code: "TOO_MANY" }

export function isValidSlot(slot: string): boolean {
  return SLOT_PATTERN.test(slot)
}

/**
 * Bersihkan dan urutkan daftar jam, atau jelaskan mengapa ia ditolak.
 *
 * Urutan menaik bukan sekadar kosmetik: kartu status dibaca dari atas ke bawah
 * sepanjang hari, dan jadwal yang tampil acak membuat admin sulit memastikan
 * jam mana yang sudah lewat.
 *
 * Duplikat DITOLAK, bukan diam-diam dibuang. Dua baris 08:00 berarti admin
 * salah ketik; menghapusnya diam-diam menyembunyikan kesalahan itu, dan satu
 * occurrence memang hanya pernah terkirim sekali sehingga baris kedua tidak
 * akan pernah berarti apa pun.
 */
export function normalizeSlots(
  input: readonly string[],
): { ok: true; slots: string[] } | { ok: false; error: SlotsError } {
  const trimmed = input.map((slot) => slot.trim())

  for (const slot of trimmed) {
    if (!isValidSlot(slot)) return { ok: false, error: { code: "INVALID_FORMAT", slot } }
  }

  const seen = new Set<string>()
  for (const slot of trimmed) {
    if (seen.has(slot)) return { ok: false, error: { code: "DUPLICATE", slot } }
    seen.add(slot)
  }

  if (trimmed.length > MAX_SLOTS_PER_TYPE) return { ok: false, error: { code: "TOO_MANY" } }

  // Perbandingan leksikografis sudah benar untuk `HH:mm` bernol depan.
  return { ok: true, slots: [...trimmed].sort() }
}

export function slotsErrorMessage(error: SlotsError): string {
  switch (error.code) {
    case "INVALID_FORMAT":
      return `Waktu "${error.slot}" tidak valid. Gunakan format 24 jam, misalnya 07:30.`
    case "DUPLICATE":
      return `Waktu ${error.slot} tercantum lebih dari sekali.`
    case "TOO_MANY":
      return `Maksimal ${MAX_SLOTS_PER_TYPE} waktu untuk setiap jenis laporan.`
  }
}
