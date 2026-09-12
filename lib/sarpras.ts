/** Pure Sarpras logic — no Prisma imports so it stays unit-testable. */

/** The two Sarpras rights. Each maps to one boolean column on User. */
export type SarprasPermission = "sarpras.view" | "sarpras.edit"

export type SarprasUserRights = {
  role: "ADMIN" | "GURU"
  canViewSarpras?: boolean
  canEditSarpras?: boolean
}

/** Permission -> the User column that grants it. */
export const sarprasPermissionColumns = {
  "sarpras.view": "canViewSarpras",
  "sarpras.edit": "canEditSarpras",
} as const satisfies Record<SarprasPermission, keyof SarprasUserRights>

export const sarprasPermissionLabels: Record<SarprasPermission, string> = {
  "sarpras.view": "Lihat Sarpras",
  "sarpras.edit": "Kelola Sarpras",
}

/**
 * Single source of truth for Sarpras authorization. ADMIN always passes.
 * sarpras.edit implies sarpras.view — an editor must be able to open the
 * module, so the two rights can never drift out of sync.
 */
export function hasSarprasPermission(
  user: SarprasUserRights,
  permission: SarprasPermission,
): boolean {
  if (user.role === "ADMIN") return true
  if (user[sarprasPermissionColumns[permission]] === true) return true
  if (permission !== "sarpras.view") return false
  return user.canEditSarpras === true
}

/** Convenience wrapper used by the nav filter and the page guards. */
export function canViewSarpras(user: SarprasUserRights): boolean {
  return hasSarprasPermission(user, "sarpras.view")
}

/** Every right the viewer holds, for handing capabilities down to the client. */
export function sarprasCapabilities(user: SarprasUserRights) {
  return {
    canView: hasSarprasPermission(user, "sarpras.view"),
    canEdit: hasSarprasPermission(user, "sarpras.edit"),
  }
}

export type SarprasCapabilities = ReturnType<typeof sarprasCapabilities>

/* -------------------------------------------------------------------------- */
/* Naming helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Normalized key for a location/item-type name: trimmed, whitespace-collapsed,
 * lowercased. Keeps "VII A", "vii a" and "  VII  A " from becoming three rows.
 */
export function sarprasSlug(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Display form of a name — trimmed and whitespace-collapsed, case kept. */
export function normalizeSarprasName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

/* -------------------------------------------------------------------------- */
/* Condition model                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The four statuses shown in the UI. Only three of them are physical
 * conditions: `MISSING` is derived from availability, never stored.
 */
export type SarprasStatus = "MISSING" | "REPAIR" | "MODERATE" | "GOOD"

export const sarprasStatusOrder: SarprasStatus[] = ["MISSING", "REPAIR", "MODERATE", "GOOD"]

export const sarprasStatusLabels: Record<SarprasStatus, string> = {
  MISSING: "Tidak Ada",
  REPAIR: "Perlu Perbaikan",
  MODERATE: "Sedang",
  GOOD: "Baik",
}

/** Chart/badge colors, intuitive and consistent across the module. */
export const sarprasStatusColors: Record<SarprasStatus, string> = {
  MISSING: "var(--sarpras-missing)",
  REPAIR: "var(--sarpras-repair)",
  MODERATE: "var(--sarpras-moderate)",
  GOOD: "var(--sarpras-good)",
}

export type SarprasPriority = "HIGH" | "MEDIUM" | "LOW"

export const sarprasPriorityLabels: Record<SarprasPriority, string> = {
  HIGH: "Tinggi",
  MEDIUM: "Sedang",
  LOW: "Rendah",
}

/** The quantity shape every calculation works from. */
export type SarprasQuantities = {
  targetQuantity: number
  availableQuantity: number
  goodQuantity: number
  moderateQuantity: number
  repairQuantity: number
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type QuantityIssue =
  | "target-negative"
  | "available-negative"
  | "condition-negative"
  | "condition-sum-mismatch"

export const quantityIssueMessages: Record<QuantityIssue, string> = {
  "target-negative": "Jumlah kebutuhan tidak boleh negatif",
  "available-negative": "Jumlah tersedia tidak boleh negatif",
  "condition-negative": "Jumlah kondisi tidak boleh negatif",
  "condition-sum-mismatch": "Baik + Sedang + Perlu Perbaikan harus sama dengan jumlah tersedia",
}

/**
 * Validates a quantity set.
 *
 * `baik + sedang + perluPerbaikan = jumlahTersedia` is enforced strictly — it is
 * an accounting identity, not a preference. `jumlahTersedia > jumlahKebutuhan`
 * is deliberately ALLOWED: schools really do receive more units than they
 * planned for, and rejecting that would make the surplus unrecordable. Surplus
 * is reported by `isSurplus` instead so the UI can flag it.
 */
export function validateQuantities(input: SarprasQuantities): QuantityIssue[] {
  const issues: QuantityIssue[] = []
  if (!Number.isFinite(input.targetQuantity) || input.targetQuantity < 0) {
    issues.push("target-negative")
  }
  if (!Number.isFinite(input.availableQuantity) || input.availableQuantity < 0) {
    issues.push("available-negative")
  }
  const conditions = [input.goodQuantity, input.moderateQuantity, input.repairQuantity]
  if (conditions.some((value) => !Number.isFinite(value) || value < 0)) {
    issues.push("condition-negative")
  }
  if (issues.length === 0) {
    const sum = input.goodQuantity + input.moderateQuantity + input.repairQuantity
    if (sum !== input.availableQuantity) issues.push("condition-sum-mismatch")
  }
  return issues
}

/** First human-readable validation error, or null when the set is valid. */
export function quantityError(input: SarprasQuantities): string | null {
  const [issue] = validateQuantities(input)
  return issue ? quantityIssueMessages[issue] : null
}

/* -------------------------------------------------------------------------- */
/* Per-item derivation                                                        */
/* -------------------------------------------------------------------------- */

/** Units still missing against the defined need. Never negative. */
export function shortageOf(input: SarprasQuantities): number {
  return Math.max(input.targetQuantity - input.availableQuantity, 0)
}

/** Units beyond the defined need. Never negative. */
export function surplusOf(input: SarprasQuantities): number {
  return Math.max(input.availableQuantity - input.targetQuantity, 0)
}

/**
 * The single status an item is filed under in the priority tabs.
 *
 * Worst-first: an item with nothing available at all is `MISSING`; otherwise
 * the worst physical condition present wins, so a row with 2 broken chairs is
 * surfaced under "Perlu Perbaikan" rather than hidden under "Baik".
 * An item with a defined need but zero available is `MISSING` even when the
 * target is 0 — that case simply has no units to describe.
 */
export function primaryStatus(input: SarprasQuantities): SarprasStatus {
  if (input.availableQuantity <= 0) return "MISSING"
  if (input.repairQuantity > 0) return "REPAIR"
  if (input.moderateQuantity > 0) return "MODERATE"
  if (input.goodQuantity > 0) return "GOOD"
  return "MISSING"
}

/** "0/1", "2/32", "32/32" — availability against the defined need. */
export function availabilityLabel(input: SarprasQuantities): string {
  return `${input.availableQuantity}/${input.targetQuantity}`
}

/** "Ada" / "Tidak Ada" — the availability axis, independent of condition. */
export function availabilityText(input: SarprasQuantities): string {
  return input.availableQuantity > 0 ? "Ada" : "Tidak Ada"
}

/* -------------------------------------------------------------------------- */
/* Dashboard statistics                                                       */
/* -------------------------------------------------------------------------- */

export type SarprasStats = {
  missing: number
  repair: number
  moderate: number
  good: number
  /** missing + repair + moderate + good — total units against school need. */
  total: number
}

export const emptyStats: SarprasStats = {
  missing: 0,
  repair: 0,
  moderate: 0,
  good: 0,
  total: 0,
}

/**
 * Unit-based statistics for the donut chart.
 *
 * Every number counts UNITS, never records. `missing` is the SHORTAGE against
 * the defined need (target - available), not a count of rows with zero stock —
 * so a location needing 4 fans but holding 2 contributes 2 missing units while
 * its 2 present fans still land in their real condition buckets.
 */
export function summarizeSarpras(items: SarprasQuantities[]): SarprasStats {
  const stats = { ...emptyStats }
  for (const item of items) {
    stats.missing += shortageOf(item)
    stats.repair += item.repairQuantity
    stats.moderate += item.moderateQuantity
    stats.good += item.goodQuantity
  }
  stats.total = stats.missing + stats.repair + stats.moderate + stats.good
  return stats
}

/** Unit count for one status, straight off a stats object. */
export function statusCount(stats: SarprasStats, status: SarprasStatus): number {
  if (status === "MISSING") return stats.missing
  if (status === "REPAIR") return stats.repair
  if (status === "MODERATE") return stats.moderate
  return stats.good
}

/** Whole-number percentage share of one status. */
export function statusShare(stats: SarprasStats, status: SarprasStatus): number {
  if (stats.total <= 0) return 0
  return Math.round((statusCount(stats, status) / stats.total) * 100)
}

/* -------------------------------------------------------------------------- */
/* Location tree                                                              */
/* -------------------------------------------------------------------------- */

export type FlatLocation = {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
}

export type LocationNode<T extends FlatLocation = FlatLocation> = T & {
  children: LocationNode<T>[]
  /** Items attached directly to this node. */
  directItemCount: number
  /** directItemCount plus every descendant's — what the tree row displays. */
  totalItemCount: number
  /** Depth from the root, 0-based. */
  depth: number
}

/**
 * Builds the location forest from a flat list.
 *
 * A node may hold child locations AND items at the same time — "Kelas" can own
 * both a corridor CCTV and the VII A..IX I rooms. Rows whose parent is missing
 * (or that sit in a parent cycle) are surfaced as roots rather than silently
 * dropped, so no location can ever disappear from the UI.
 */
export function buildLocationTree<T extends FlatLocation>(
  locations: T[],
  itemCounts: Map<string, number> = new Map(),
): LocationNode<T>[] {
  const byId = new Map<string, LocationNode<T>>()
  for (const location of locations) {
    byId.set(location.id, {
      ...location,
      children: [],
      directItemCount: itemCounts.get(location.id) ?? 0,
      totalItemCount: 0,
      depth: 0,
    })
  }

  const roots: LocationNode<T>[] = []
  for (const node of byId.values()) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId)
    if (parent && parent.id !== node.id && !isDescendant(byId, parent, node.id)) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (nodes: LocationNode<T>[], depth: number) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "id"))
    for (const node of nodes) {
      node.depth = depth
      sortNodes(node.children, depth + 1)
      node.totalItemCount =
        node.directItemCount + node.children.reduce((sum, child) => sum + child.totalItemCount, 0)
    }
  }
  sortNodes(roots, 0)

  return roots
}

/** True when `candidateId` sits anywhere above `node` in the parent chain. */
function isDescendant<T extends FlatLocation>(
  byId: Map<string, LocationNode<T>>,
  node: LocationNode<T>,
  candidateId: string,
): boolean {
  const seen = new Set<string>()
  let current: LocationNode<T> | undefined = node
  while (current) {
    if (current.id === candidateId) return true
    if (seen.has(current.id)) return true
    seen.add(current.id)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return false
}

/** Flattens the forest depth-first, parents before their children. */
export function flattenLocationTree<T extends FlatLocation>(
  nodes: LocationNode<T>[],
): LocationNode<T>[] {
  return nodes.flatMap((node) => [node, ...flattenLocationTree(node.children)])
}

/**
 * Every id in the subtree rooted at `id`, including `id` itself. Used to guard
 * a move: a location may never be reparented into its own descendant.
 */
export function subtreeIds(locations: FlatLocation[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const location of locations) {
    if (location.parentId === null) continue
    const list = childrenOf.get(location.parentId)
    if (list) list.push(location.id)
    else childrenOf.set(location.parentId, [location.id])
  }
  const result = new Set<string>([id])
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const child of childrenOf.get(current) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      queue.push(child)
    }
  }
  return result
}

/**
 * Whether `parentId` is a legal new parent for `id`.
 * Rejects self-parenting and any descendant, which would orphan a whole branch.
 */
export function canReparent(
  locations: FlatLocation[],
  id: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true
  if (parentId === id) return false
  return !subtreeIds(locations, id).has(parentId)
}

/** A supplied parent must be root (`null`) or an existing location. */
export function isValidLocationParent(
  parentId: string | null,
  knownLocationIds: ReadonlySet<string>,
): boolean {
  return parentId === null || knownLocationIds.has(parentId)
}

/** "Kelas / VIII A" — the readable full path of a location. */
export function locationPath(locations: FlatLocation[], id: string): string {
  const byId = new Map(locations.map((location) => [location.id, location]))
  const parts: string[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return parts.join(" / ")
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** "3 barang" / "Belum ada barang" for tree rows. */
export function itemCountLabel(count: number): string {
  return count > 0 ? `${count} barang` : "Belum ada barang"
}
