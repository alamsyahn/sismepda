/**
 * Rumus LMS WHO, dipakai bersama oleh seluruh indikator antropometri.
 *
 * Satu salinan saja: IMT/U (`lib/bmi-for-age.ts`) dan TB/U (`lib/height-for-age.ts`)
 * memanggil fungsi yang sama, sehingga keduanya tidak mungkin memakai rumus
 * yang berbeda.
 */

export type Gender = "LAKI_LAKI" | "PEREMPUAN"

/** Satu baris tabel rujukan: [L, M, S]. */
export type LmsRow = [number, number, number]

export type LmsReference = {
  ageMonths: { min: number; max: number }
  lms: Record<Gender, Record<string, number[]>>
}

/** Baris rujukan yang tervalidasi, atau null bila umur di luar tabel/data rusak. */
export function lmsRow(
  reference: LmsReference,
  ageMonths: number,
  gender: Gender,
): LmsRow | null {
  if (!Number.isFinite(ageMonths)) return null
  if (ageMonths < reference.ageMonths.min || ageMonths > reference.ageMonths.max) return null

  const row = reference.lms[gender]?.[String(ageMonths)]
  // Baris rujukan selalu [L, M, S]; kalau tidak, datanya rusak — jangan menebak.
  if (!row || row.length !== 3) return null

  const [l, m, s] = row
  if (!Number.isFinite(l) || !Number.isFinite(m) || !Number.isFinite(s)) return null
  if (m <= 0 || s <= 0) return null
  return [l, m, s]
}

/**
 * Z-score dari sebuah nilai ukur:
 *   z = ((X/M)^L - 1) / (L * S),  dan  z = ln(X/M) / S  bila L = 0.
 */
export function zScoreFromLms(value: number, [l, m, s]: LmsRow): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  if (Math.abs(l) < 1e-9) return Math.log(value / m) / s
  return (Math.pow(value / m, l) - 1) / (l * s)
}

/**
 * Kebalikannya: nilai ukur pada suatu z-score. Dipakai menggambar pita SD pada
 * grafik — pita digambar dari rumus yang sama dengan yang menilai siswa,
 * sehingga garis dan kategori tidak mungkin bertentangan.
 */
export function valueFromLms(z: number, [l, m, s]: LmsRow): number {
  if (Math.abs(l) < 1e-9) return m * Math.exp(s * z)
  return m * Math.pow(1 + l * s * z, 1 / l)
}
