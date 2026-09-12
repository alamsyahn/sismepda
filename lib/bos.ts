/** Pure BOS logic — no Prisma imports so it stays unit-testable. */

/** Concrete BOS operations checked against current database RBAC grants. */
export type BosPermission =
  | "bos.read"
  | "bos.entries.create"
  | "bos.entries.update"
  | "bos.budget.update"
  | "bos.categories.create"
  | "bos.categories.update"
  | "bos.access.manage"

/** No role or legacy flag is authority here; callers pass effective DB grants. */
export function hasBosPermission(grants: ReadonlySet<string>, permission: BosPermission): boolean {
  return grants.has(permission)
}

/** Every independent BOS operation for handing capabilities to the client. */
export function bosCapabilities(grants: ReadonlySet<string>) {
  return {
    canView: hasBosPermission(grants, "bos.read"),
    canCreate: hasBosPermission(grants, "bos.entries.create"),
    canEdit: hasBosPermission(grants, "bos.entries.update"),
    canUpdateBudget: hasBosPermission(grants, "bos.budget.update"),
    canCreateCategories: hasBosPermission(grants, "bos.categories.create"),
    canManageCategories: hasBosPermission(grants, "bos.categories.update"),
    canManageAccess: hasBosPermission(grants, "bos.access.manage"),
  }
}

export type BosCapabilities = ReturnType<typeof bosCapabilities>

/**
 * Normalized key for a category name: trimmed, whitespace-collapsed, lowercased.
 * Keeps "ATK", "atk" and "  ATK " from becoming three separate categories.
 */
export function categorySlug(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Display form of a category name — trimmed and whitespace-collapsed, case kept. */
export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

/** Rupiah, no decimals: 200000000 -> "Rp200.000.000". */
export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

/** Compact rupiah for chart labels: 72000000 -> "Rp72 jt". */
export function formatRupiahCompact(value: number): string {
  const amount = Number.isFinite(value) ? value : 0
  const abs = Math.abs(amount)
  if (abs >= 1_000_000_000) return `Rp${trimZero(amount / 1_000_000_000)} M`
  if (abs >= 1_000_000) return `Rp${trimZero(amount / 1_000_000)} jt`
  if (abs >= 1_000) return `Rp${trimZero(amount / 1_000)} rb`
  return formatRupiah(amount)
}

function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",")
}

export type BosSummary = {
  initialBudget: number | null
  totalRealisasi: number
  /** anggaran - realisasi; negative when overspent. Null while no budget is set. */
  remaining: number | null
  /** realisasi / anggaran * 100; may exceed 100. Null while no budget is set. */
  percentUsed: number | null
  budgetSet: boolean
  overspent: boolean
}

/**
 * Derived summary. "Sisa" and "% terserap" are always computed, never persisted.
 * A zero or missing budget yields a null percentage instead of dividing by zero.
 */
export function summarizeBos(initialBudget: number | null, totalRealisasi: number): BosSummary {
  const realisasi = Number.isFinite(totalRealisasi) ? totalRealisasi : 0
  const budgetSet = initialBudget !== null && Number.isFinite(initialBudget) && initialBudget > 0
  if (!budgetSet) {
    return {
      initialBudget: initialBudget ?? null,
      totalRealisasi: realisasi,
      remaining: null,
      percentUsed: null,
      budgetSet: false,
      overspent: false,
    }
  }
  const budget = initialBudget as number
  const remaining = budget - realisasi
  return {
    initialBudget: budget,
    totalRealisasi: realisasi,
    remaining,
    percentUsed: roundPercent((realisasi / budget) * 100),
    budgetSet: true,
    overspent: remaining < 0,
  }
}

/** Round to at most `digits` decimals without trailing float noise. */
export function roundPercent(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** "67%" — whole numbers stay clean, fractions keep one decimal. */
export function formatPercent(value: number): string {
  const rounded = roundPercent(value, 1)
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

export type CategoryTotal = { id: string; name: string; total: number }
export type BosCategoryOption = { id: string; name: string; active: boolean }
export type BreakdownSlice = { key: string; name: string; total: number; share: number }

/**
 * Top-N categories by realisasi, with everything else folded into "Lainnya".
 * `share` is relative to the largest slice so the longest bar always fills the
 * track — a storage-breakdown look rather than a percentage-of-budget chart.
 */
export function categoryBreakdown(totals: CategoryTotal[], topCount = 5): BreakdownSlice[] {
  const positive = totals.filter((item) => item.total > 0)
  const sorted = [...positive].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "id"))
  const top = sorted.slice(0, topCount)
  const rest = sorted.slice(topCount)
  const slices = top.map((item) => ({ key: item.id, name: item.name, total: item.total, share: 0 }))
  if (rest.length > 0) {
    slices.push({
      key: "lainnya",
      name: "Lainnya",
      total: rest.reduce((sum, item) => sum + item.total, 0),
      share: 0,
    })
  }
  const largest = slices.reduce((max, item) => Math.max(max, item.total), 0)
  return slices.map((item) => ({
    ...item,
    share: largest > 0 ? roundPercent((item.total / largest) * 100) : 0,
  }))
}

/** Only http/https links are accepted; any storage provider is allowed. */
export function normalizeDocumentUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  return parsed.toString()
}

/** "📎 3 file" / "Belum ada" for the compact Dokumentasi cell. */
export function documentLabel(count: number): string {
  return count > 0 ? `${count} file` : "Belum ada"
}
