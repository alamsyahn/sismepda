/**
 * Model data Grafik IMT: titik pengukuran siswa beserta status gizinya, dan
 * zona IMT-menurut-umur (IMT/U) yang menjadi latarnya.
 *
 * Modul murni — tanpa Prisma dan tanpa React — sehingga dapat diuji langsung
 * dan dipakai komponen klien.
 *
 * **Satu sumber kebenaran.** Kategori tiap titik berasal dari
 * `nutritionStatus()` (`lib/euks.ts`), dan ambang zona dari
 * `bmiThresholdsAt()` (`lib/bmi-for-age.ts`) — keduanya memakai tabel L/M/S
 * WHO dan ambang Permenkes 2/2020 yang sama. Grafik karena itu tidak mungkin
 * menyebut "Gizi baik" untuk pengukuran yang oleh kartu status disebut
 * "Gizi kurang".
 *
 * **Ambang anak tidak konstan.** Batas -3/-2/+1/+2 SD bergantung pada jenis
 * kelamin dan umur pada tanggal pengukuran, jadi zona digambar sebagai deret
 * waktu, bukan empat garis mendatar. Ambang IMT dewasa (18,5/25/30) tidak
 * dipakai sama sekali.
 *
 * Zona berbentuk **tangga per bulan umur**: klasifikasi Permenkes memakai umur
 * dalam bulan penuh, sehingga ambang memang tetap sepanjang satu bulan umur
 * dan melompat di hari ulang bulan. Menginterpolasinya akan membuat garis
 * terlihat mulus tetapi tidak lagi sama persis dengan ambang yang menilai
 * siswa — tepat kasus yang harus dihindari.
 */

import { BMI_SD_LINES, bmiThresholdsAt, type NutritionCategory } from "@/lib/bmi-for-age"
import {
  ageInMonths,
  nutritionStatus,
  type BmiPoint,
  type NutritionUnknownReason,
} from "@/lib/euks"
import { formatAgeMonths } from "@/lib/kms"
import type { Gender } from "@/lib/lms"
import {
  addSchoolDays,
  differenceInSchoolDays,
  parseSchoolDate,
  toPrismaDate,
  type SchoolDate,
} from "@/lib/school-date"

export { BMI_SD_LINES }

/** Setengah tahun di kiri-kanan ketika seluruh pengukuran jatuh pada satu hari. */
const SINGLE_POINT_PAD_DAYS = 183

/** Satu titik pengukuran siswa, lengkap dengan penilaian status gizinya. */
export type BmiChartPoint = {
  id: string
  measuredAt: SchoolDate
  heightCm: number
  weightKg: number
  note: string | null
  bmi: number
  /** Jarak hari dari tanggal pengukuran pertama — sumbu X grafik. */
  day: number
  /** Null bila tanggal lahir belum diisi. */
  ageMonths: number | null
  ageLabel: string | null
  /** Null bila status gizi belum dapat dinilai; tidak pernah diperkirakan. */
  zScore: number | null
  category: NutritionCategory | null
  /** Alasan spesifik ketika `category` null. */
  unknownReason: NutritionUnknownReason | null
}

/**
 * Satu potongan waktu dengan ambang IMT yang tetap, yaitu satu bulan umur.
 * `values` berurutan sesuai `BMI_SD_LINES`.
 */
export type BmiZoneSegment = {
  startDay: number
  endDay: number
  ageMonths: number
  values: number[]
}

export type BmiChartModel = {
  points: BmiChartPoint[]
  /** Kosong bila zona tidak dapat dihitung. */
  segments: BmiZoneSegment[]
  startDay: number
  endDay: number
  /** Alasan zona tidak digambar; null bila zona tersedia. */
  zonesUnavailable: NutritionUnknownReason | null
}

/** Tanggal saat siswa genap berumur `months` bulan. */
function dateAtAgeMonths(birthDate: SchoolDate, months: number): SchoolDate {
  const birth = toPrismaDate(birthDate)
  const day = birth.getUTCDate()
  const target = new Date(0)
  target.setUTCHours(0, 0, 0, 0)
  target.setUTCFullYear(birth.getUTCFullYear(), birth.getUTCMonth() + months, 1)
  // Bulan pendek: 31 Januari + 1 bulan jatuh pada akhir Februari, bukan Maret.
  const lastDayOfMonth = new Date(0)
  lastDayOfMonth.setUTCHours(0, 0, 0, 0)
  lastDayOfMonth.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  target.setUTCDate(Math.min(day, lastDayOfMonth.getUTCDate()))
  const iso = target.toISOString().slice(0, 10)
  return parseSchoolDate(iso) as SchoolDate
}

const clampDay = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Susun model grafik.
 *
 * Titik tanpa IMT (tinggi/berat tidak masuk akal) dibuang seperti sebelumnya.
 * Zona hanya digambar bila tanggal lahir, jenis kelamin, dan umur di dalam
 * rentang tabel rujukan tersedia — kalau tidak, grafik IMT tetap tampil tanpa
 * zona, dengan alasannya dilaporkan lewat `zonesUnavailable`.
 */
export function buildBmiChart(
  points: BmiPoint[],
  birthDate: string | null,
  gender: Gender | null,
): BmiChartModel {
  const valid = points
    .filter((point): point is BmiPoint & { bmi: number } => point.bmi !== null)
    .map((point) => ({ point, date: parseSchoolDate(point.measuredAt) }))
    .filter((item): item is { point: BmiPoint & { bmi: number }; date: SchoolDate } => item.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (valid.length === 0) {
    return { points: [], segments: [], startDay: 0, endDay: 0, zonesUnavailable: null }
  }

  const base = valid[0].date
  const parsedBirth = birthDate ? parseSchoolDate(birthDate) : null

  const chartPoints: BmiChartPoint[] = valid.map(({ point, date }) => {
    const status = nutritionStatus({
      bmi: point.bmi,
      measuredAt: point.measuredAt,
      birthDate,
      gender,
    })
    const months = parsedBirth ? ageInMonths(parsedBirth, date) : null
    return {
      id: point.id,
      measuredAt: date,
      heightCm: point.heightCm,
      weightKg: point.weightKg,
      note: point.note,
      bmi: point.bmi,
      day: differenceInSchoolDays(base, date),
      ageMonths: months,
      ageLabel: months === null ? null : formatAgeMonths(months),
      zScore: status.kind === "known" ? status.z : null,
      category: status.kind === "known" ? status.category : null,
      unknownReason: status.kind === "known" ? null : status.reason,
    }
  })

  const lastDay = chartPoints[chartPoints.length - 1].day
  const startDay = lastDay === 0 ? -SINGLE_POINT_PAD_DAYS : 0
  const endDay = lastDay === 0 ? SINGLE_POINT_PAD_DAYS : lastDay

  if (!parsedBirth) {
    return { points: chartPoints, segments: [], startDay, endDay, zonesUnavailable: "no_birth_date" }
  }
  if (!gender) {
    return { points: chartPoints, segments: [], startDay, endDay, zonesUnavailable: "no_gender" }
  }

  const startDate = addSchoolDays(base, startDay)
  const endDate = addSchoolDays(base, endDay)
  const startAge = ageInMonths(parsedBirth, startDate)
  const endAge = ageInMonths(parsedBirth, endDate)
  if (startAge === null || endAge === null) {
    return { points: chartPoints, segments: [], startDay, endDay, zonesUnavailable: "no_birth_date" }
  }

  const segments: BmiZoneSegment[] = []
  for (let months = startAge; months <= endAge; months += 1) {
    const values = bmiThresholdsAt(months, gender)
    // Umur di luar tabel 5-19 tahun: dilewati, bukan diekstrapolasi.
    if (!values) continue
    const segmentStart = differenceInSchoolDays(base, dateAtAgeMonths(parsedBirth, months))
    const segmentEnd = differenceInSchoolDays(base, dateAtAgeMonths(parsedBirth, months + 1))
    segments.push({
      ageMonths: months,
      startDay: clampDay(segmentStart, startDay, endDay),
      endDay: clampDay(segmentEnd, startDay, endDay),
      values,
    })
  }

  return {
    points: chartPoints,
    segments,
    startDay,
    endDay,
    zonesUnavailable: segments.length === 0 ? "age_out_of_range" : null,
  }
}

/** Nilai terendah dan tertinggi yang harus muat pada sumbu Y. */
export function bmiChartDomain(model: BmiChartModel): { min: number; max: number } {
  const values = [
    ...model.points.map((point) => point.bmi),
    ...model.segments.flatMap((segment) => segment.values),
  ]
  if (values.length === 0) return { min: 0, max: 1 }
  // Ruang sedikit di bawah -3 SD dan di atas +2 SD supaya zona gizi buruk dan
  // obesitas tidak terpotong menjadi garis tipis di tepi.
  const min = Math.floor(Math.min(...values) - 1.5)
  const max = Math.ceil(Math.max(...values) + 1.5)
  return { min, max: max > min ? max : min + 1 }
}
