import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { authFailureResponse } from "@/lib/api-errors"
import { requireSarprasPermission } from "@/lib/sarpras-access"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"
import { quantityError, type SarprasQuantities } from "@/lib/sarpras"

const quantityFields = z.object({
  targetQuantity: z.number().int().min(0).max(100000),
  availableQuantity: z.number().int().min(0).max(100000),
  goodQuantity: z.number().int().min(0).max(100000),
  moderateQuantity: z.number().int().min(0).max(100000),
  repairQuantity: z.number().int().min(0).max(100000),
})

const optionalFields = z.object({
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  inventoryCode: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
})

const createPayload = quantityFields.extend({
  locationId: z.string().min(1),
  itemTypeId: z.string().min(1),
}).and(optionalFields)

const updatePayload = quantityFields.partial().extend({
  id: z.string().min(1),
  locationId: z.string().min(1).optional(),
  itemTypeId: z.string().min(1).optional(),
}).and(optionalFields)

const deletePayload = z.object({ id: z.string().min(1) })

/** The quantity snapshot stored in history entries. */
function snapshot(item: SarprasQuantities) {
  return {
    targetQuantity: item.targetQuantity,
    availableQuantity: item.availableQuantity,
    goodQuantity: item.goodQuantity,
    moderateQuantity: item.moderateQuantity,
    repairQuantity: item.repairQuantity,
  }
}

function nullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** Create one item (a need for a type of goods at a location). Requires sarpras.edit. */
export async function POST(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.items.create")
    const body = createPayload.parse(await request.json())
    const acquisitionDateValue = body.acquisitionDate ? parseSchoolDate(body.acquisitionDate) : null
    if (body.acquisitionDate && !acquisitionDateValue) return NextResponse.json({ error: "Tanggal perolehan tidak valid" }, { status: 400 })

    // The accounting identity is enforced on the server, not just in the form.
    const invalid = quantityError(body)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const [location, itemType] = await Promise.all([
      prisma.sarprasLocation.findUnique({ where: { id: body.locationId }, select: { id: true, name: true } }),
      prisma.sarprasItemType.findUnique({ where: { id: body.itemTypeId }, select: { id: true, name: true } }),
    ])
    if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 })
    if (!itemType) return NextResponse.json({ error: "Jenis barang tidak ditemukan" }, { status: 404 })

    const duplicate = await prisma.sarprasItem.findUnique({
      where: { locationId_itemTypeId: { locationId: location.id, itemTypeId: itemType.id } },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json(
        { error: `"${itemType.name}" sudah terdaftar di ${location.name}. Ubah data yang ada saja.` },
        { status: 409 },
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.sarprasItem.create({
        data: {
          locationId: location.id,
          itemTypeId: itemType.id,
          targetQuantity: body.targetQuantity,
          availableQuantity: body.availableQuantity,
          goodQuantity: body.goodQuantity,
          moderateQuantity: body.moderateQuantity,
          repairQuantity: body.repairQuantity,
          acquisitionDate: acquisitionDateValue ? toPrismaDate(acquisitionDateValue) : null,
          inventoryCode: nullableText(body.inventoryCode) ?? null,
          description: nullableText(body.description) ?? null,
          priority: body.priority ?? null,
          createdById: viewer.id,
          updatedById: viewer.id,
        },
        select: { id: true },
      })

      await tx.sarprasHistory.create({
        data: {
          itemId: item.id,
          actorId: viewer.id,
          summary: `${itemType.name} di ${location.name} ditambahkan`,
          after: snapshot(body),
        },
      })

      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_ITEM_CREATED",
          entity: "SarprasItem",
          entityId: item.id,
          summary: `Barang "${itemType.name}" di ${location.name} ditambahkan`,
          after: snapshot(body),
        },
        tx,
      )
      return item
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}

/** Update an item — quantities, details, or its location. Requires sarpras.edit. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.items.update")
    const body = updatePayload.parse(await request.json())
    const acquisitionDateValue = body.acquisitionDate ? parseSchoolDate(body.acquisitionDate) : null
    if (body.acquisitionDate && !acquisitionDateValue) return NextResponse.json({ error: "Tanggal perolehan tidak valid" }, { status: 400 })

    const item = await prisma.sarprasItem.findUnique({
      where: { id: body.id },
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
        location: { select: { name: true } },
        itemType: { select: { name: true } },
      },
    })
    if (!item) return NextResponse.json({ error: "Barang tidak ditemukan" }, { status: 404 })

    // Merge the patch over current values, then validate the RESULT — a partial
    // update must never be able to leave the row violating the identity.
    const next: SarprasQuantities = {
      targetQuantity: body.targetQuantity ?? item.targetQuantity,
      availableQuantity: body.availableQuantity ?? item.availableQuantity,
      goodQuantity: body.goodQuantity ?? item.goodQuantity,
      moderateQuantity: body.moderateQuantity ?? item.moderateQuantity,
      repairQuantity: body.repairQuantity ?? item.repairQuantity,
    }
    const invalid = quantityError(next)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const locationId = body.locationId ?? item.locationId
    const itemTypeId = body.itemTypeId ?? item.itemTypeId

    if (locationId !== item.locationId || itemTypeId !== item.itemTypeId) {
      const [location, itemType] = await Promise.all([
        prisma.sarprasLocation.findUnique({ where: { id: locationId }, select: { id: true } }),
        prisma.sarprasItemType.findUnique({ where: { id: itemTypeId }, select: { id: true } }),
      ])
      if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 })
      if (!itemType) return NextResponse.json({ error: "Jenis barang tidak ditemukan" }, { status: 404 })

      const duplicate = await prisma.sarprasItem.findUnique({
        where: { locationId_itemTypeId: { locationId, itemTypeId } },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== item.id) {
        return NextResponse.json(
          { error: "Jenis barang tersebut sudah terdaftar di lokasi tujuan" },
          { status: 409 },
        )
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sarprasItem.update({
        where: { id: item.id },
        data: {
          locationId,
          itemTypeId,
          ...next,
          ...(body.acquisitionDate === undefined
            ? {}
            : { acquisitionDate: acquisitionDateValue ? toPrismaDate(acquisitionDateValue) : null }),
          ...(body.inventoryCode === undefined ? {} : { inventoryCode: nullableText(body.inventoryCode) }),
          ...(body.description === undefined ? {} : { description: nullableText(body.description) }),
          ...(body.priority === undefined ? {} : { priority: body.priority }),
          updatedById: viewer.id,
        },
        select: {
          id: true,
          location: { select: { name: true } },
          itemType: { select: { name: true } },
        },
      })

      const before = snapshot(item)
      const after = snapshot(next)
      const quantitiesChanged = (Object.keys(after) as Array<keyof typeof after>).some(
        (key) => before[key] !== after[key],
      )
      const moved = locationId !== item.locationId

      // History is for condition/quantity movement and relocation; cosmetic
      // edits (typo in the note) do not deserve a row in the item's timeline.
      if (quantitiesChanged || moved) {
        await tx.sarprasHistory.create({
          data: {
            itemId: item.id,
            actorId: viewer.id,
            summary: moved
              ? `${result.itemType.name} dipindahkan ke ${result.location.name}`
              : `Kondisi ${result.itemType.name} di ${result.location.name} diperbarui`,
            before: before as Prisma.InputJsonValue,
            after: after as Prisma.InputJsonValue,
          },
        })
      }

      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_ITEM_UPDATED",
          entity: "SarprasItem",
          entityId: item.id,
          summary: `Barang "${result.itemType.name}" di ${result.location.name} diperbarui`,
          before,
          after,
        },
        tx,
      )
      return result
    })

    return NextResponse.json({ id: updated.id })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}

/** Delete one item. Its photos and history cascade with it. Requires sarpras.edit. */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.items.delete")
    const body = deletePayload.parse(await request.json())

    const item = await prisma.sarprasItem.findUnique({
      where: { id: body.id },
      select: {
        id: true,
        targetQuantity: true,
        availableQuantity: true,
        goodQuantity: true,
        moderateQuantity: true,
        repairQuantity: true,
        location: { select: { name: true } },
        itemType: { select: { name: true } },
      },
    })
    if (!item) return NextResponse.json({ error: "Barang tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.sarprasItem.delete({ where: { id: item.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_ITEM_DELETED",
          entity: "SarprasItem",
          entityId: item.id,
          summary: `Barang "${item.itemType.name}" di ${item.location.name} dihapus`,
          before: snapshot(item),
        },
        tx,
      )
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}
