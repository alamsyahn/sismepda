/** Pure workbook supervision logic — no Prisma imports so it stays unit-testable. */

export type WorkbookItemStatus = "UNREVIEWED" | "PRESENT" | "MISSING"

/** Completion bucket for one workbook, or for a teacher overall. */
export type CompletionState = "COMPLETE" | "IN_PROGRESS" | "UNREVIEWED"

export type WorkbookProgress = {
  presentCount: number
  missingCount: number
  unreviewedCount: number
  totalCount: number
  /** presentCount / totalCount * 100 */
  percent: number
  state: CompletionState
}

export const statusLabels: Record<WorkbookItemStatus, string> = {
  PRESENT: "Ada/Lengkap",
  MISSING: "Tidak Ada/Belum Lengkap",
  UNREVIEWED: "Belum diperiksa",
}

export const completionLabels: Record<CompletionState, string> = {
  COMPLETE: "Lengkap",
  IN_PROGRESS: "Dalam proses",
  UNREVIEWED: "Belum diperiksa",
}

/** Round to at most `digits` decimals without trailing float noise (66.66666 -> 66.67). */
export function roundPercent(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Progress of a single workbook for one teacher.
 * Only PRESENT counts as complete; MISSING and UNREVIEWED both count as incomplete
 * but stay distinguishable for the UI.
 */
export function summarizeWorkbookProgress(statuses: WorkbookItemStatus[]): WorkbookProgress {
  const totalCount = statuses.length
  let presentCount = 0
  let missingCount = 0
  let unreviewedCount = 0

  for (const status of statuses) {
    if (status === "PRESENT") presentCount += 1
    else if (status === "MISSING") missingCount += 1
    else unreviewedCount += 1
  }

  return {
    presentCount,
    missingCount,
    unreviewedCount,
    totalCount,
    percent: totalCount > 0 ? roundPercent((presentCount / totalCount) * 100) : 0,
    state: completionState({ presentCount, unreviewedCount, totalCount }),
  }
}

/**
 * Lengkap = every item PRESENT.
 * Belum Diperiksa = every item UNREVIEWED.
 * Proses = anything else (including all MISSING).
 */
export function completionState(input: {
  presentCount: number
  unreviewedCount: number
  totalCount: number
}): CompletionState {
  if (input.totalCount === 0) return "UNREVIEWED"
  if (input.presentCount === input.totalCount) return "COMPLETE"
  if (input.unreviewedCount === input.totalCount) return "UNREVIEWED"
  return "IN_PROGRESS"
}

/**
 * Weighted overall score for one teacher.
 * Each workbook contributes its own weight (25% each), NOT its raw item count,
 * so 6/6 + 4/5 + 2/4 + 0/4 = 57.5%, not 12/19 = 63.16%.
 */
export function weightedOverallPercent(
  workbooks: Array<{ percent: number; weight: number }>,
): number {
  const totalWeight = workbooks.reduce((sum, workbook) => sum + workbook.weight, 0)
  if (totalWeight <= 0) return 0
  const weighted = workbooks.reduce((sum, workbook) => sum + workbook.percent * workbook.weight, 0)
  return roundPercent(weighted / totalWeight)
}

/**
 * School-wide aggregate for one workbook:
 * all PRESENT items across teachers / (teacher count x item count).
 */
export function aggregateWorkbookPercent(input: {
  presentCount: number
  teacherCount: number
  itemCount: number
}): number {
  const possible = input.teacherCount * input.itemCount
  if (possible <= 0) return 0
  return roundPercent((input.presentCount / possible) * 100)
}

/** Format a percentage for display: 66.67% but 100% and 0% stay clean. */
export function formatPercent(value: number): string {
  const rounded = roundPercent(value, 1)
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

/**
 * Continuous progress tone: red at 0%, orange at 25%, yellow at 50%,
 * yellow-green at 75%, and green at 100%.
 */
export function progressColor(value: number): string {
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100)
  const hue = roundPercent((clamped / 100) * 120, 2)
  return `hsl(${hue} 78% 45%)`
}

/** Cycle order for the 3-state control: UNREVIEWED -> PRESENT -> MISSING -> UNREVIEWED. */
export function nextItemStatus(current: WorkbookItemStatus): WorkbookItemStatus {
  if (current === "UNREVIEWED") return "PRESENT"
  if (current === "PRESENT") return "MISSING"
  return "UNREVIEWED"
}

/** Only http/https links are accepted; any storage provider is allowed. */
export function normalizeWorkbookUrl(raw: string): string | null | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
  return parsed.toString()
}

/** Supervisors may change checklist status. Admins always qualify. */
export function canSuperviseWorkbooks(user: {
  role: "ADMIN" | "GURU"
  canSuperviseWorkbooks?: boolean
}): boolean {
  return user.role === "ADMIN" || user.canSuperviseWorkbooks === true
}

/** Viewers may open the supervision page read-only; editors implicitly can too. */
export function canViewWorkbookSupervision(user: {
  role: "ADMIN" | "GURU"
  canSuperviseWorkbooks?: boolean
  canViewWorkbookSupervision?: boolean
}): boolean {
  return canSuperviseWorkbooks(user) || user.canViewWorkbookSupervision === true
}
