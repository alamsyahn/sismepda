import { prisma } from "@/lib/prisma"
import { summarizeBos, type BosCategoryOption, type CategoryTotal } from "@/lib/bos"

/** Decimal -> number at the edge, so the rest of the app never sees Decimal. */
function toNumber(value: { toString(): string } | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = Number(value.toString())
  return Number.isFinite(parsed) ? parsed : 0
}

export type BosEntryRow = {
  id: string
  categoryId: string
  categoryName: string
  categoryActive: boolean
  description: string
  occurredAt: Date
  amount: number
  documents: Array<{ id: string; label: string | null; url: string }>
}

/** The one read the BOS page needs: settings, totals, categories, and entries. */
export async function readBosOverview() {
  const [setting, categories, entries, grouped] = await Promise.all([
    prisma.bosSetting.findUnique({ where: { id: "default" }, select: { initialBudget: true } }),
    prisma.bosCategory.findMany({
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.bosEntry.findMany({
      select: {
        id: true,
        categoryId: true,
        description: true,
        occurredAt: true,
        amount: true,
        category: { select: { name: true, active: true } },
        documents: { select: { id: true, label: true, url: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.bosEntry.groupBy({ by: ["categoryId"], _sum: { amount: true } }),
  ])

  const rows: BosEntryRow[] = entries.map((entry) => ({
    id: entry.id,
    categoryId: entry.categoryId,
    categoryName: entry.category.name,
    categoryActive: entry.category.active,
    description: entry.description,
    occurredAt: entry.occurredAt,
    amount: toNumber(entry.amount),
    documents: entry.documents,
  }))

  const nameById = new Map(categories.map((category) => [category.id, category.name]))
  const categoryTotals: CategoryTotal[] = grouped.map((group) => ({
    id: group.categoryId,
    name: nameById.get(group.categoryId) ?? "Tanpa kategori",
    total: toNumber(group._sum.amount),
  }))

  const initialBudget = setting?.initialBudget == null ? null : toNumber(setting.initialBudget)
  const totalRealisasi = categoryTotals.reduce((sum, item) => sum + item.total, 0)

  return {
    summary: summarizeBos(initialBudget, totalRealisasi),
    categories: categories as BosCategoryOption[],
    categoryTotals,
    entries: rows,
  }
}

export type BosOverview = Awaited<ReturnType<typeof readBosOverview>>

/** Current RBAC memberships relevant to the fixed BOS delegation surface. */
export async function readBosAccessScope() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      nip: true,
      active: true,
      position: true,
      rbacRoles: {
        select: { role: { select: { key: true, isProtected: true } } },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  })

  return users.map(({ rbacRoles, ...user }) => ({
    ...user,
    protected: rbacRoles.some(({ role }) => role.isProtected),
    bundleKeys: rbacRoles.map(({ role }) => role.key).filter((key) => key.startsWith("legacy_bos_")),
  }))
}

export type BosAccessRow = Awaited<ReturnType<typeof readBosAccessScope>>[number]
