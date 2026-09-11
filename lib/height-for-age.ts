/**
 * Tinggi badan menurut umur (TB/U) untuk grafik KMS.
 *
 * Sumber L/M/S: WHO Growth reference 5-19 years, Height-for-age
 * (`lib/data/height-for-age-reference.json`). Divalidasi silang terhadap kolom
 * SD terhitung pada berkas WHO yang sama — 2352 titik, selisih maksimum
 * 0,0005 cm; lihat `tests/height-for-age.test.ts`.
 *
 * Permenkes 2/2020 memuat TB/U hanya sampai 60 bulan, sehingga tidak dapat
 * dipakai untuk siswa; karena itu di sini tidak ada ambang kategori Permenkes.
 * Modul ini sengaja TIDAK memberi label status apa pun — hanya memasok pita
 * rujukan untuk digambar. Penilaian stunting adalah kewenangan tenaga
 * kesehatan, bukan aplikasi presensi sekolah.
 */

import reference from "@/lib/data/height-for-age-reference.json"
import { lmsRow, valueFromLms, zScoreFromLms, type Gender } from "@/lib/lms"

export const HEIGHT_REFERENCE_MIN_MONTHS = reference.ageMonths.min
export const HEIGHT_REFERENCE_MAX_MONTHS = reference.ageMonths.max

/** Garis SD yang digambar pada grafik KMS, dari bawah ke atas. */
export const SD_LINES = [-3, -2, -1, 0, 1, 2, 3] as const

export type SdLine = (typeof SD_LINES)[number]

/** Satu titik pada kurva rujukan: tinggi (cm) tiap garis SD pada umur tertentu. */
export type HeightReferencePoint = {
  ageMonths: number
  /** Tinggi dalam cm, berurutan sesuai `SD_LINES`. */
  values: number[]
}

/**
 * Z-score TB/U seorang siswa, atau null bila umur di luar rentang rujukan.
 * Tidak diekstrapolasi di luar 5-19 tahun.
 */
export function heightZScore(heightCm: number, ageMonths: number, gender: Gender): number | null {
  const row = lmsRow(reference, ageMonths, gender)
  if (!row) return null
  return zScoreFromLms(heightCm, row)
}

/**
 * Kurva rujukan untuk rentang umur tertentu, satu titik per bulan.
 *
 * Pita digambar dari L/M/S yang sama dengan yang dipakai `heightZScore`, jadi
 * posisi titik siswa terhadap pita selalu konsisten dengan z-score-nya.
 */
export function heightReferenceCurves(
  gender: Gender,
  fromMonths: number,
  toMonths: number,
): HeightReferencePoint[] {
  const start = Math.max(Math.ceil(fromMonths), HEIGHT_REFERENCE_MIN_MONTHS)
  const end = Math.min(Math.floor(toMonths), HEIGHT_REFERENCE_MAX_MONTHS)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []

  const points: HeightReferencePoint[] = []
  for (let ageMonths = start; ageMonths <= end; ageMonths += 1) {
    const row = lmsRow(reference, ageMonths, gender)
    if (!row) continue
    points.push({ ageMonths, values: SD_LINES.map((z) => valueFromLms(z, row)) })
  }
  return points
}
