/**
 * Aturan konten Pengaturan E-UKS: identitas, pengurus, fasilitas, dan daftar
 * keluhan siap-pilih.
 *
 * Murni tanpa akses database supaya dapat diuji langsung dan aman diimpor
 * komponen klien.
 */

/**
 * Kunci penyeragaman: spasi dirapikan, huruf disamakan.
 *
 * Fungsi yang sama dipakai untuk slug fasilitas, slug keluhan, dan
 * pengelompokan tren di `lib/euks-trends.ts` — kalau berbeda, sebuah keluhan
 * bisa lolos sebagai "baru" di form tetapi menyatu di statistik, atau
 * sebaliknya.
 */
export function euksSlug(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Rapikan spasi tanpa mengubah huruf besar-kecil yang diketik operator. */
export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export const OFFICER_NAME_MAX = 80
export const OFFICER_ROLE_MAX = 60
export const FACILITY_NAME_MAX = 80
export const FACILITY_NOTE_MAX = 200
export const COMPLAINT_LABEL_MAX = 80
export const PROFILE_NAME_MAX = 120
export const PROFILE_LOCATION_MAX = 120
export const PROFILE_DESCRIPTION_MAX = 2000

/** Batas jumlah unit fasilitas; menahan salah ketik seperti 99999999. */
export const FACILITY_QUANTITY_MAX = 9999

/**
 * Batas ukuran foto pengaturan E-UKS, sama dengan Sarpras. Form memeriksanya
 * lebih dulu untuk pesan cepat; route handler tetap memeriksa ulang.
 */
export const MAX_EUKS_PHOTO_BYTES = 2 * 1024 * 1024

/** Rasio potret kartu pengurus, dipakai pratinjau, kompresi, dan tampilan. */
export const OFFICER_PHOTO_ASPECT = 9 / 16

/** Rasio lanskap foto fasilitas; cocok untuk foto barang/ruangan. */
export const FACILITY_PHOTO_ASPECT = 4 / 3

/** Sisi terpanjang setelah kompresi klien; cukup untuk kartu dan pratinjau. */
export const EUKS_PHOTO_MAX_EDGE = 1280

/**
 * URL foto pengurus. Query `v` memakai waktu pembaruan sehingga mengganti foto
 * langsung terlihat tanpa menunggu cache browser kedaluwarsa.
 */
export function euksOfficerPhotoUrl(
  id: string,
  updatedAt: Date | string | null | undefined,
): string | null {
  if (!updatedAt) return null
  return `/api/e-uks/officers/${id}/photo?v=${new Date(updatedAt).getTime()}`
}

/** URL foto fasilitas; aturan cache-busting sama dengan pengurus. */
export function euksFacilityPhotoUrl(
  id: string,
  updatedAt: Date | string | null | undefined,
): string | null {
  if (!updatedAt) return null
  return `/api/e-uks/facilities/${id}/photo?v=${new Date(updatedAt).getTime()}`
}

/**
 * Sisipkan satu item ke posisi baru dan hitung ulang sortOrder.
 *
 * Mengembalikan urutan penuh, bukan hanya yang berubah, supaya nomor urut
 * selalu rapat (0,1,2,...) dan tidak ada dua item bernomor sama setelah
 * beberapa kali pemindahan.
 */
export function reorder<T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return items
  const target = index + direction
  if (target < 0 || target >= items.length) return items

  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Nama tampil pengurus: guru tertaut memakai namanya sendiri bila ada. */
export function officerDisplayName(officer: { name: string; user?: { name: string } | null }): string {
  return officer.user?.name ?? officer.name
}
