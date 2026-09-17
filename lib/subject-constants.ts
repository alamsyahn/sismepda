/**
 * Aturan nama mata pelajaran yang dipakai BERSAMA oleh server dan klien.
 *
 * Diletakkan terpisah dari `lib/server-subjects.ts` karena berkas itu
 * mengimpor Prisma; komponen klien yang mengimpor nilai dari sana akan
 * menyeret `pg` ke dalam bundle dan mematahkan `next build`.
 */

/** Batas panjang nama; sekadar penjaga kewarasan masukan, bukan aturan kurikulum. */
export const SUBJECT_NAME_MAX_LENGTH = 100

/**
 * Merapikan nama sebelum disimpan maupun dibandingkan.
 *
 * Spasi ganda dan spasi tepi dihilangkan supaya "Bahasa  Indonesia " dan
 * "Bahasa Indonesia" tidak menjadi dua baris berbeda di Data Master.
 */
export function normalizeSubjectName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Mengembalikan alasan penolakan, atau `null` bila nama sah.
 *
 * Mengembalikan pesan alih-alih boolean supaya server dan layar memakai
 * kalimat yang sama persis.
 */
export function subjectNameProblem(value: string): string | null {
  const clean = normalizeSubjectName(value)
  if (clean === "") return "Nama mata pelajaran wajib diisi"
  if (clean.length > SUBJECT_NAME_MAX_LENGTH) {
    return `Nama mata pelajaran maksimal ${SUBJECT_NAME_MAX_LENGTH} karakter`
  }
  return null
}
