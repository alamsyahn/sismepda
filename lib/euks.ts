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
