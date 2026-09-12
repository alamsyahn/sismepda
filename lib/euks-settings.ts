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
export const PROFILE_SERVICE_HOURS_MAX = 120
export const PROFILE_CONTACT_MAX = 120
export const HERO_CAPTION_MAX = 120

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

/** Rasio foto hero; lanskap lebar supaya aman dipakai sebagai latar penuh. */
export const HERO_PHOTO_ASPECT = 16 / 9

/** Sisi terpanjang setelah kompresi klien; cukup untuk kartu dan pratinjau. */
export const EUKS_PHOTO_MAX_EDGE = 1280

/**
 * Sisi terpanjang foto hero. Lebih besar dari foto kartu karena hero
 * ditampilkan selebar layar; 1600 px masih tajam di laptop tanpa membuat
 * byte-nya membengkak melewati batas 2 MB.
 */
export const EUKS_HERO_MAX_EDGE = 1600

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

/** URL foto hero; aturan cache-busting sama dengan pengurus dan fasilitas. */
export function euksHeroImageUrl(
  id: string,
  updatedAt: Date | string | null | undefined,
): string | null {
  if (!updatedAt) return null
  return `/api/e-uks/hero-images/${id}/photo?v=${new Date(updatedAt).getTime()}`
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

/**
 * Inisial untuk placeholder kartu pengurus: maksimal dua huruf dari kata
 * pertama dan terakhir.
 *
 * Gelar dibuang lebih dulu supaya "Budi Santoso, S.Pd" berinisial "BS". Kata
 * bertitik hanya dibuang bila BUKAN kata pertama: singkatan nama depan seperti
 * "Moh.", "Muh.", dan "Abd." lazim di sini dan harus tetap dihitung, sehingga
 * "Moh. Rizki" berinisial "MR", bukan "R".
 */
export function officerInitials(name: string): string {
  const words = name
    .replace(/,.*$/, "")
    .trim()
    .split(/\s+/)
    .filter((word, index) => word.length > 0 && (index === 0 || !word.includes(".")))
  if (words.length === 0) return "?"
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ""
  return (first + last).toUpperCase()
}

/**
 * Warna placeholder pengurus, dipilih deterministik dari namanya.
 *
 * Deterministik dan bukan acak supaya kartu orang yang sama tidak berganti
 * warna setiap halaman dimuat ulang. Nilainya indeks, bukan kelas Tailwind,
 * agar berkas ini tetap bebas dari urusan tampilan.
 */
export function officerPlaceholderTone(name: string, tones: number): number {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100000
  }
  return hash % tones
}
