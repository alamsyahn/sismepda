/** Pure E-UKS logic — no Prisma imports so it stays unit-testable. */

import {
  bmiZScore,
  categorizeZScore,
  nutritionCategoryLabels,
  type NutritionCategory,
} from "@/lib/bmi-for-age"

/** The two E-UKS rights. Each maps to one boolean column on User. */
export type EuksPermission = "euks.view" | "euks.edit"

export type EuksRights = {
  role: "ADMIN" | "GURU"
  canViewEuks?: boolean | null
  canEditEuks?: boolean | null
}

export type EuksCapabilities = {
  canView: boolean
  canEdit: boolean
}

/**
 * ADMIN always passes. Otherwise the matching column decides, and the right to
 * record visits implies the right to read them — an editor who could not open
 * the module would be unable to use the right at all.
 */
export function hasEuksPermission(user: EuksRights, permission: EuksPermission): boolean {
  if (user.role === "ADMIN") return true
  const canEdit = user.canEditEuks === true
  if (permission === "euks.edit") return canEdit
  return canEdit || user.canViewEuks === true
}

export function canViewEuks(user: EuksRights): boolean {
  return hasEuksPermission(user, "euks.view")
}

export function euksCapabilities(user: EuksRights): EuksCapabilities {
  return {
    canView: hasEuksPermission(user, "euks.view"),
    canEdit: hasEuksPermission(user, "euks.edit"),
  }
}

/** One student option for the visit form, already carrying its class name. */
export type EuksStudentOption = {
  id: string
  name: string
  className: string
}

/**
 * Normalize a free-text complaint/treatment for grouping. Trend aggregation
 * must not treat "Pusing", "pusing" and "Pusing " as three different things.
 */
export function normalizeVisitTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Display form of a grouped term: the normalized text with a leading capital. */
export function visitTermLabel(value: string): string {
  const normalized = normalizeVisitTerm(value)
  if (!normalized) return ""
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export type VisitTermCount = {
  term: string
  count: number
}

/**
 * Count occurrences of one free-text field across visits, most frequent first.
 * Ties are broken alphabetically so the order is stable between renders.
 */
export function countVisitTerms(values: string[]): VisitTermCount[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = normalizeVisitTerm(value)
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term: visitTermLabel(term), count }))
    .sort((a, b) => (b.count - a.count) || a.term.localeCompare(b.term, "id"))
}

/** One height/weight measurement, already converted to plain numbers. */
export type HealthMeasurement = {
  id: string
  measuredAt: string
  heightCm: number
  weightKg: number
  note: string | null
}

/**
 * BMI = kg / m². Always derived, never stored, so a corrected height or weight
 * can never leave a stale IMT behind. Returns null when either input is
 * non-positive, which would make the ratio meaningless.
 */
export function calculateBmi(heightCm: number, weightKg: number): number | null {
  if (!(heightCm > 0) || !(weightKg > 0)) return null
  const heightM = heightCm / 100
  return weightKg / (heightM * heightM)
}

/** IMT is conventionally shown with one decimal. */
export function formatBmi(bmi: number | null): string {
  return bmi === null ? "-" : bmi.toFixed(1)
}

/**
 * Umur dalam bulan penuh pada tanggal pengukuran — satuan yang dipakai tabel
 * IMT-menurut-umur. Mengembalikan null bila tanggal lahir belum diisi atau
 * pengukuran terjadi sebelum kelahiran (data tidak konsisten).
 */
export function ageInMonths(birthDate: string, measuredAt: string): number | null {
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const measured = new Date(`${measuredAt}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(measured.getTime())) return null
  if (measured < birth) return null

  let months =
    (measured.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    (measured.getUTCMonth() - birth.getUTCMonth())
  // Bulan belum genap bila tanggalnya belum terlewati.
  if (measured.getUTCDate() < birth.getUTCDate()) months -= 1
  return Math.max(0, months)
}

/** Umur dalam tahun penuh, untuk ditampilkan. */
export function ageInYears(birthDate: string, measuredAt: string): number | null {
  const months = ageInMonths(birthDate, measuredAt)
  return months === null ? null : Math.floor(months / 12)
}

/**
 * Alasan status gizi tidak dapat ditentukan. Dibedakan agar antarmuka dapat
 * memberi tahu operator persis data apa yang kurang, bukan sekadar "-".
 */
export type NutritionUnknownReason =
  | "no_measurement"
  | "no_birth_date"
  | "no_gender"
  | "age_out_of_range"

/**
 * Hasil penilaian status gizi: entah terklasifikasi, atau tidak — dengan
 * alasan yang eksplisit. Bentuk union ini membuat pemanggil tidak bisa
 * lupa menangani kasus "belum bisa dinilai".
 */
export type NutritionStatus =
  | { kind: "known"; category: NutritionCategory; z: number; ageMonths: number }
  | { kind: "unknown"; reason: NutritionUnknownReason }

export type NutritionInput = {
  bmi: number | null
  measuredAt: string | null
  birthDate: string | null
  gender: "LAKI_LAKI" | "PEREMPUAN" | null
}

/**
 * Klasifikasi status gizi anak usia sekolah memakai IMT-menurut-umur, yang
 * menuntut umur DAN jenis kelamin DAN tabel rujukan LMS (WHO/Permenkes).
 * Ambang IMT dewasa (18.5/25/30) tidak sahih untuk anak sehingga tidak dipakai.
 *
 * Mengembalikan discriminated union: pemanggil tidak bisa lupa menangani kasus
 * "belum bisa ditentukan", dan alasannya spesifik supaya kartu dapat menyebut
 * data mana yang kurang alih-alih menampilkan tanda strip.
 */
export function nutritionStatus(input: NutritionInput): NutritionStatus {
  if (input.bmi === null || !input.measuredAt) return { kind: "unknown", reason: "no_measurement" }
  if (!input.birthDate) return { kind: "unknown", reason: "no_birth_date" }
  if (!input.gender) return { kind: "unknown", reason: "no_gender" }

  const ageMonths = ageInMonths(input.birthDate, input.measuredAt)
  if (ageMonths === null) return { kind: "unknown", reason: "no_birth_date" }

  const z = bmiZScore(input.bmi, ageMonths, input.gender)
  // Di luar 5-19 tahun tabel rujukan tidak berlaku; ekstrapolasi tidak sahih.
  if (z === null) return { kind: "unknown", reason: "age_out_of_range" }

  return { kind: "known", category: categorizeZScore(z), z, ageMonths }
}

const unknownReasonLabels: Record<NutritionUnknownReason, string> = {
  no_measurement: "Belum ada pengukuran",
  no_birth_date: "Tanggal lahir belum diisi",
  no_gender: "Jenis kelamin belum diisi",
  age_out_of_range: "Umur di luar rentang rujukan (5-19 tahun)",
}

export function nutritionStatusLabel(status: NutritionStatus): string {
  return status.kind === "known"
    ? nutritionCategoryLabels[status.category]
    : unknownReasonLabels[status.reason]
}

/** Z-score untuk ditampilkan, mis. "+1,3 SD" — satu desimal, koma Indonesia. */
export function formatZScore(z: number): string {
  const rounded = z.toFixed(1).replace(".", ",")
  return `${z >= 0 ? "+" : ""}${rounded} SD`
}

/** A measurement plus its derived IMT, newest first, for chart and table. */
export type BmiPoint = {
  id: string
  measuredAt: string
  heightCm: number
  weightKg: number
  bmi: number | null
  note: string | null
}

export function toBmiSeries(measurements: HealthMeasurement[]): BmiPoint[] {
  return measurements
    .map((item) => ({ ...item, bmi: calculateBmi(item.heightCm, item.weightKg) }))
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
}

/**
 * Titik siswa pada grafik KMS: tinggi badan terhadap umur dalam bulan.
 *
 * Pengukuran tanpa tanggal lahir, atau yang jatuh di luar rentang tabel
 * rujukan, sengaja dibuang — bukan digeser ke tepi tabel, karena itu akan
 * menempatkan siswa pada pita yang salah.
 */
export type HeightPoint = {
  id: string
  measuredAt: string
  ageMonths: number
  heightCm: number
}

export function toHeightSeries(
  measurements: HealthMeasurement[],
  birthDate: string | null,
): HeightPoint[] {
  if (!birthDate) return []
  return measurements
    .map((item) => {
      const ageMonths = ageInMonths(birthDate, item.measuredAt)
      if (ageMonths === null || !(item.heightCm > 0)) return null
      return { id: item.id, measuredAt: item.measuredAt, ageMonths, heightCm: item.heightCm }
    })
    .filter((point): point is HeightPoint => point !== null)
    .sort((a, b) => a.ageMonths - b.ageMonths)
}

/** The most recent measurement drives the three "saat ini" summary cards. */
export function latestMeasurement(measurements: HealthMeasurement[]): HealthMeasurement | null {
  if (measurements.length === 0) return null
  return measurements.reduce((latest, item) => (item.measuredAt > latest.measuredAt ? item : latest))
}
