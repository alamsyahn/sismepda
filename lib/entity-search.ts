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
