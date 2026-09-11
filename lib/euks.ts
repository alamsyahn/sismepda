/** Pure E-UKS logic — no Prisma imports so it stays unit-testable. */

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
 * Nutritional status categories used by the "Status Gizi" card.
 *
 * The clinically correct classification for school-age children is BMI-for-age
 * against a WHO/Permenkes LMS reference, which this repository does not have
 * (see TD-011), and it additionally needs the student's age and sex, which the
 * Student model does not store. Until that reference exists this returns
 * "unknown" rather than a number dressed up as a diagnosis.
 */
export type NutritionStatus = "unknown"

export function nutritionStatus(): NutritionStatus {
  return "unknown"
}

export function nutritionStatusLabel(status: NutritionStatus): string {
  return status === "unknown" ? "Belum dapat ditentukan" : status
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

/** The most recent measurement drives the three "saat ini" summary cards. */
export function latestMeasurement(measurements: HealthMeasurement[]): HealthMeasurement | null {
  if (measurements.length === 0) return null
  return measurements.reduce((latest, item) => (item.measuredAt > latest.measuredAt ? item : latest))
}
