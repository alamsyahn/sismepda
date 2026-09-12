import { prisma } from "@/lib/prisma"
import {
  buildLocationTree,
  locationPath,
  primaryStatus,
  shortageOf,
  summarizeSarpras,
  surplusOf,
  type FlatLocation,
  type SarprasPriority,
  type SarprasStats,
  type SarprasStatus,
} from "@/lib/sarpras"

export type SarprasItemRow = {
  id: string
  locationId: string
  locationName: string
  /** "Kelas / VIII A" — the full readable path, for the table and detail panel. */
  locationPath: string
  itemTypeId: string
  itemTypeName: string
  targetQuantity: number
  availableQuantity: number
  goodQuantity: number
  moderateQuantity: number
  repairQuantity: number
  /** target - available, never negative. */
  shortage: number
  /** available - target, never negative. */
  surplus: number
  /** The tab this row is filed under. */
  status: SarprasStatus
  acquisitionDate: Date | null
  inventoryCode: string | null
  description: string | null
  priority: SarprasPriority | null
  photos: Array<{ id: string; caption: string | null }>
  updatedAt: Date
}

export type SarprasLocationRow = FlatLocation

export type SarprasItemTypeOption = { id: string; name: string; active: boolean }

/** Re-exported so server code has one import site for Sarpras helpers. */
export { sarprasPhotoUrl } from "@/lib/sarpras-constants"

/**
 * The one read the Sarpras page needs: locations, item types, every item with
 * its derived status, the unit-based dashboard stats, and per-location counts.
 */
export async function readSarprasOverview(includePhotos = true) {
  const [locations, itemTypes, items] = await Promise.all([
    prisma.sarprasLocation.findMany({
      select: { id: true, name: true, parentId: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.sarprasItemType.findMany({
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.sarprasItem.findMany({
      select: {
        id: true,
        locationId: true,
        itemTypeId: true,
        targetQuantity: true,
        availableQuantity: true,
        goodQuantity: true,
        moderateQuantity: true,
        repairQuantity: true,
        acquisitionDate: true,
        inventoryCode: true,
        description: true,
        priority: true,
        updatedAt: true,
        location: { select: { name: true } },
        itemType: { select: { name: true } },
        photos: includePhotos
          ? { select: { id: true, caption: true }, orderBy: { sortOrder: "asc" } }
          : false,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
  ])

  const rows: SarprasItemRow[] = items.map((item) => ({
    id: item.id,
    locationId: item.locationId,
    locationName: item.location.name,
    locationPath: locationPath(locations, item.locationId),
    itemTypeId: item.itemTypeId,
    itemTypeName: item.itemType.name,
    targetQuantity: item.targetQuantity,
    availableQuantity: item.availableQuantity,
    goodQuantity: item.goodQuantity,
    moderateQuantity: item.moderateQuantity,
    repairQuantity: item.repairQuantity,
    shortage: shortageOf(item),
    surplus: surplusOf(item),
    status: primaryStatus(item),
    acquisitionDate: item.acquisitionDate,
    inventoryCode: item.inventoryCode,
    description: item.description,
    priority: item.priority,
    photos: "photos" in item ? item.photos : [],
    updatedAt: item.updatedAt,
  }))

  // Item counts per location, rolled up through the tree by buildLocationTree.
  const itemCounts = new Map<string, number>()
  for (const row of rows) {
    itemCounts.set(row.locationId, (itemCounts.get(row.locationId) ?? 0) + 1)
  }

  const stats: SarprasStats = summarizeSarpras(items)

  return {
    stats,
    locations: locations as SarprasLocationRow[],
    tree: buildLocationTree(locations, itemCounts),
    itemTypes: itemTypes as SarprasItemTypeOption[],
    items: rows,
  }
}

export type SarprasOverview = Awaited<ReturnType<typeof readSarprasOverview>>

/** Condition history for one item, newest first — shown in the detail panel. */
export async function readSarprasHistory(itemId: string, limit = 30) {
  return prisma.sarprasHistory.findMany({
    where: { itemId },
    select: {
      id: true,
      summary: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}

export type SarprasHistoryRow = Awaited<ReturnType<typeof readSarprasHistory>>[number]
