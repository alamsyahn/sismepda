/**
 * Klasifikasi status gizi anak usia sekolah: IMT-menurut-umur (IMT/U).
 *
 * Dua sumber resmi, keduanya tersimpan di `lib/data/bmi-for-age-reference.json`:
 *
 * - **Nilai L/M/S** — WHO Growth reference 5-19 years, BMI-for-age. Dipakai
 *   menghitung z-score lewat rumus LMS.
 * - **Ambang kategori** — Permenkes RI No. 2 Tahun 2020 tentang Standar
 *   Antropometri Anak (Tabel 15 laki-laki, Tabel 16 perempuan), yang merupakan
 *   dasar hukum di Indonesia.
 *
 * Keduanya sudah divalidasi silang: 336 baris tabel Permenkes dihitung ulang
 * dari L/M/S WHO dan cocok seluruhnya (selisih < 0,15 IMT). Lihat
 * `tests/bmi-for-age.test.ts`, yang menguji ulang setiap baris terhadap
 * `tests/fixtures/permenkes-imt-u.json` yang diekstrak langsung dari PDF
 * Permenkes.
 *
 * Ambang IMT dewasa (18,5/25/30) TIDAK dipakai — untuk anak, ambang itu salah
 * secara klinis.
 */

import reference from "@/lib/data/bmi-for-age-reference.json"

export type Gender = "LAKI_LAKI" | "PEREMPUAN"

/** Kategori Permenkes 2/2020 untuk IMT/U anak 5-18 tahun. */
export type NutritionCategory = "gizi_buruk" | "gizi_kurang" | "gizi_baik" | "gizi_lebih" | "obesitas"

export const nutritionCategoryLabels: Record<NutritionCategory, string> = {
  gizi_buruk: "Gizi buruk",
  gizi_kurang: "Gizi kurang",
  gizi_baik: "Gizi baik",
  gizi_lebih: "Gizi lebih",
  obesitas: "Obesitas",
}

/**
 * Nada visual tiap kategori. Dipetakan di sini, bukan di komponen, agar tabel
 * dan kartu ringkasan tidak bisa memberi warna berbeda untuk kategori sama.
 */
export const nutritionCategoryTone: Record<NutritionCategory, "danger" | "warning" | "ok"> = {
  gizi_buruk: "danger",
  gizi_kurang: "warning",
  gizi_baik: "ok",
  gizi_lebih: "warning",
  obesitas: "danger",
}

const REFERENCE_MIN_MONTHS = reference.ageMonths.min
const REFERENCE_MAX_MONTHS = reference.ageMonths.max

/**
 * Z-score IMT/U memakai rumus LMS WHO:
 *   z = ((IMT/M)^L - 1) / (L * S),  dan  z = ln(IMT/M) / S  bila L = 0.
 *
 * Mengembalikan null bila umur di luar rentang rujukan (5-19 tahun) — lebih
 * baik tidak memberi kategori daripada mengekstrapolasi di luar tabel.
 */
export function bmiZScore(bmi: number, ageMonths: number, gender: Gender): number | null {
  if (!Number.isFinite(bmi) || bmi <= 0) return null
  if (ageMonths < REFERENCE_MIN_MONTHS || ageMonths > REFERENCE_MAX_MONTHS) return null

  const table: Record<string, number[]> = reference.lms[gender]
  const row = table[String(ageMonths)]
  // Baris rujukan selalu [L, M, S]; kalau tidak, datanya rusak — jangan menebak.
  if (!row || row.length !== 3) return null

  const [l, m, s] = row
  if (!Number.isFinite(l) || !Number.isFinite(m) || !Number.isFinite(s) || m <= 0 || s <= 0) return null
  if (Math.abs(l) < 1e-9) return Math.log(bmi / m) / s
  return (Math.pow(bmi / m, l) - 1) / (l * s)
}

/**
 * Ambang Permenkes 2/2020 untuk IMT/U anak 5-18 tahun:
 *   < -3 SD            gizi buruk (severely thinness)
 *   -3 SD s.d. < -2 SD gizi kurang (thinness)
 *   -2 SD s.d. +1 SD   gizi baik (normal)
 *   > +1 SD s.d. +2 SD gizi lebih (overweight)
 *   > +2 SD            obesitas (obese)
 */
export function categorizeZScore(z: number): NutritionCategory {
  if (z < -3) return "gizi_buruk"
  if (z < -2) return "gizi_kurang"
  if (z <= 1) return "gizi_baik"
  if (z <= 2) return "gizi_lebih"
  return "obesitas"
}
