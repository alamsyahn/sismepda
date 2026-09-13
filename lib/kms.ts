/**
 * Logika Kartu Menuju Sehat (KMS): pemilihan kurva rujukan menurut jenis
 * kelamin, dan penyiapan detail tiap titik pengukuran untuk ditampilkan.
 *
 * Modul murni — tanpa Prisma dan tanpa React — supaya dapat diuji langsung dan
 * dipakai baik oleh server component maupun komponen klien.
 *
 * Sengaja TIDAK memberi label status gizi/stunting. Sejalan dengan
 * `lib/height-for-age.ts`, yang disebut di sini hanyalah POSISI titik terhadap
 * pita rujukan WHO, bukan diagnosis. Penilaian pertumbuhan adalah kewenangan
 * tenaga kesehatan, bukan aplikasi presensi sekolah.
 */

import type { HeightPoint } from "@/lib/euks"
import { heightZScore } from "@/lib/height-for-age"
import type { Gender } from "@/lib/lms"

/**
 * Kurva yang dipakai ketika jenis kelamin siswa belum diisi.
 *
 * Nilainya harus selalu diberitahukan ke pengguna lewat `isFallback`; grafik
 * tidak boleh diam-diam tampak seolah memakai data siswa yang sebenarnya.
 */
export const KMS_FALLBACK_GENDER: Gender = "LAKI_LAKI"

export type KmsReference = {
  /** Kurva yang benar-benar digambar. */
  gender: Gender
  /** True bila kurva berasal dari fallback, bukan dari data siswa. */
  isFallback: boolean
}

/**
 * Tentukan kurva rujukan yang dipakai.
 *
 * `override` hanya berlaku saat jenis kelamin siswa kosong: selama datanya ada,
 * data siswa yang menang, sehingga pilihan manual tidak bisa memalsukan
 * tampilan siswa yang jenis kelaminnya sudah terisi.
 */
export function resolveKmsReference(
  studentGender: Gender | null,
  override?: Gender | null,
): KmsReference {
  if (studentGender) return { gender: studentGender, isFallback: false }
  return { gender: override ?? KMS_FALLBACK_GENDER, isFallback: true }
}

/**
 * Subjudul kartu: indikator dan tabel rujukan saja.
 *
 * Jenis kelamin sengaja TIDAK ikut di sini. Kurva laki-laki dan perempuan
 * berbeda nyata, jadi informasi itu terlalu penting untuk diselipkan ke dalam
 * subjudul kecil; kartu menampilkannya sebagai badge tersendiri di header.
 */
export function kmsReferenceLabel(): string {
  return "Tinggi badan menurut umur · WHO 5-19 tahun"
}

/**
 * Posisi sebuah z-score terhadap pita rujukan.
 *
 * Ambangnya adalah garis SD yang memang digambar pada grafik, jadi kalimatnya
 * selalu cocok dengan apa yang dilihat pengguna.
 */
export type SdBand = "di bawah -3 SD" | "-3 s.d. -2 SD" | "-2 s.d. +2 SD" | "+2 s.d. +3 SD" | "di atas +3 SD"

export function sdBandOf(z: number): SdBand {
  if (z < -3) return "di bawah -3 SD"
  if (z < -2) return "-3 s.d. -2 SD"
  if (z <= 2) return "-2 s.d. +2 SD"
  if (z <= 3) return "+2 s.d. +3 SD"
  return "di atas +3 SD"
}

/**
 * Kalimat posisi titik terhadap pita rujukan — deskriptif, bukan diagnosis.
 */
export function sdBandDescription(band: SdBand): string {
  switch (band) {
    case "-2 s.d. +2 SD":
      return "Berada di dalam pita rujukan WHO."
    case "-3 s.d. -2 SD":
      return "Berada di bawah pita rujukan WHO."
    case "di bawah -3 SD":
      return "Jauh di bawah pita rujukan WHO."
    case "+2 s.d. +3 SD":
      return "Berada di atas pita rujukan WHO."
    case "di atas +3 SD":
      return "Jauh di atas pita rujukan WHO."
  }
}

/** Umur yang mudah dibaca, mis. "13 tahun 4 bulan". */
export function formatAgeMonths(ageMonths: number): string {
  const years = Math.floor(ageMonths / 12)
  const months = ageMonths % 12
  if (months === 0) return `${years} tahun`
  return `${years} tahun ${months} bulan`
}

/** Satu titik pengukuran lengkap dengan penilaian posisinya. */
export type KmsPoint = HeightPoint & {
  ageLabel: string
  /** Null bila umur di luar tabel rujukan 5-19 tahun — tidak diekstrapolasi. */
  zScore: number | null
  band: SdBand | null
  description: string | null
}

/**
 * Lengkapi tiap titik dengan z-score dan posisinya terhadap pita.
 *
 * Memakai `heightZScore` yang sama dengan penggambar pita, sehingga angka pada
 * panel detail tidak mungkin bertentangan dengan posisi titik pada grafik.
 */
export function toKmsPoints(points: HeightPoint[], gender: Gender): KmsPoint[] {
  return points.map((point) => {
    const zScore = heightZScore(point.heightCm, point.ageMonths, gender)
    const band = zScore === null ? null : sdBandOf(zScore)
    return {
      ...point,
      ageLabel: formatAgeMonths(point.ageMonths),
      zScore,
      band,
      description: band === null ? null : sdBandDescription(band),
    }
  })
}
