/**
 * Pencocokan teks untuk pemilih yang dapat diketik (combobox).
 *
 * CLIENT-SAFE dan MURNI: tidak menyentuh DOM, Prisma, maupun sesi, sehingga
 * dapat dipakai komponen klien sekaligus diuji tanpa peramban.
 *
 * Aturan pencocokan sengaja SEDERHANA dan dapat diramalkan: substring, bukan
 * fuzzy. Daftar guru sekolah berisi banyak nama yang mirip, dan pencocokan
 * fuzzy pada pemilih membuat nama yang tidak diketik ikut muncul di urutan atas
 * — pada layar pemetaan jadwal, salah pilih berarti jadwal orang lain.
 */

/**
 * Bentuk baku sebuah teks untuk dibandingkan: huruf kecil, tanpa tanda baca,
 * spasi tunggal.
 *
 * Tanda baca menjadi SPASI, bukan dihapus, supaya "Budi,Siti" tidak menyatu
 * menjadi satu kata. Gelar sengaja tidak ditanggalkan di sini: pengguna yang
 * mengetik "S.Pd" memang sedang mencari gelar itu.
 */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Apakah `text` cocok dengan `query`.
 *
 * Query dipecah menjadi kata dan SELURUH kata harus ditemukan sebagai
 * substring, tanpa memedulikan urutannya. Dengan begitu "alam" menemukan
 * "Muhammad Nur Alamsyah", "nur" menemukan "Muhammad Nur Alamsyah" dan
 * "Nurvita", dan "alamsyah nur" tetap menemukan orang yang sama meski urutan
 * katanya terbalik.
 *
 * Query kosong cocok dengan apa pun — mengosongkan kotak pencarian harus
 * mengembalikan seluruh pilihan, bukan mengosongkan daftar.
 */
export function matchesSearchQuery(text: string, query: string): boolean {
  const needle = normalizeSearchText(query)
  if (needle === "") return true
  const haystack = normalizeSearchText(text)
  if (haystack === "") return false
  return needle.split(" ").every((token) => haystack.includes(token))
}

/** Menyaring daftar pilihan dengan aturan yang sama, urutan asli dipertahankan. */
export function filterBySearchQuery<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
): T[] {
  const needle = normalizeSearchText(query)
  if (needle === "") return [...items]
  return items.filter((item) => matchesSearchQuery(toText(item), query))
}

/**
 * Panjang ketikan minimum sebelum pencarian autocomplete dimulai.
 *
 * Dipakai pemilih guru pada tab "Jadwal Saya". Daftar guru sekolah berisi
 * puluhan nama; membuka seluruhnya begitu kotak disentuh membuat pengguna
 * memindai daftar panjang yang tidak ia minta. Dua huruf pun masih mencocokkan
 * hampir semua orang, sehingga ambangnya tiga.
 */
export const SEARCH_MIN_QUERY_LENGTH = 3

/**
 * Apakah `query` sudah cukup panjang untuk mulai mencari.
 *
 * Dihitung dari teks yang SUDAH dinormalkan, sehingga spasi dan tanda baca
 * tidak dapat memenuhi ambang: mengetik "a. " tetap belum memulai pencarian.
 */
export function hasEnoughSearchQuery(query: string): boolean {
  return normalizeSearchText(query).replace(/ /g, "").length >= SEARCH_MIN_QUERY_LENGTH
}

/**
 * Penyaringan autocomplete: kosong SELAMA ambang belum tercapai.
 *
 * Berbeda dari `filterBySearchQuery`, kueri pendek di sini mengembalikan daftar
 * KOSONG, bukan seluruh pilihan. Pemanggil membedakan "belum mengetik cukup"
 * dari "tidak ada hasil" lewat `hasEnoughSearchQuery`, bukan dengan menebak
 * dari panjang hasil.
 */
export function autocompleteMatches<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
): T[] {
  if (!hasEnoughSearchQuery(query)) return []
  return items.filter((item) => matchesSearchQuery(toText(item), query))
}
