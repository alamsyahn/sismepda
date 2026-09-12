import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { authFailureResponse } from "@/lib/api-errors"
import { requireSarprasPermission } from "@/lib/sarpras-access"
import { normalizeSarprasName, sarprasSlug } from "@/lib/sarpras"

const createPayload = z.object({ name: z.string().trim().min(2).max(80) })

const updatePayload = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(80).optional(),
  active: z.boolean().optional(),
})

const deletePayload = z.object({ id: z.string().min(1) })

/**
 * Create a master item type. Users add these from inside the item form, so
 * case/whitespace variants resolve to the existing type instead of creating a
 * duplicate ("CCTV" and "cctv" must stay one queryable thing).
 */
export async function POST(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.item_types.create")
    const body = createPayload.parse(await request.json())
    const name = normalizeSarprasName(body.name)
    const slug = sarprasSlug(name)

    const existing = await prisma.sarprasItemType.findUnique({
      where: { slug },
      select: { id: true, name: true, active: true },
    })
    if (existing) {
      if (existing.active) return NextResponse.json({ ...existing, reused: true })
      const revived = await prisma.sarprasItemType.update({
        where: { id: existing.id },
        data: { active: true },
        select: { id: true, name: true, active: true },
      })
      return NextResponse.json({ ...revived, reused: true })
    }

    const created = await prisma.$transaction(async (tx) => {
      const itemType = await tx.sarprasItemType.create({
        data: { name, slug },
        select: { id: true, name: true, active: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_ITEM_TYPE_CREATED",
          entity: "SarprasItemType",
          entityId: itemType.id,
          summary: `Jenis barang "${itemType.name}" dibuat`,
          after: { name: itemType.name, active: itemType.active },
        },
        tx,
      )
      return itemType
    })

    return NextResponse.json({ ...created, reused: false }, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}

/** Rename or deactivate a master item type. Requires sarpras.edit. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.item_types.update")
    const body = updatePayload.parse(await request.json())
    if (body.name === undefined && body.active === undefined) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const itemType = await prisma.sarprasItemType.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, active: true },
    })
    if (!itemType) return NextResponse.json({ error: "Jenis barang tidak ditemukan" }, { status: 404 })

    const name = body.name === undefined ? undefined : normalizeSarprasName(body.name)
    if (name !== undefined) {
      const clash = await prisma.sarprasItemType.findUnique({
        where: { slug: sarprasSlug(name) },
        select: { id: true },
      })
      if (clash && clash.id !== itemType.id) {
        return NextResponse.json({ error: "Nama jenis barang sudah digunakan" }, { status: 409 })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sarprasItemType.update({
        where: { id: itemType.id },
        data: {
          ...(name === undefined ? {} : { name, slug: sarprasSlug(name) }),
          ...(body.active === undefined ? {} : { active: body.active }),
        },
        select: { id: true, name: true, active: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_ITEM_TYPE_UPDATED",
          entity: "SarprasItemType",
          entityId: itemType.id,
          summary: `Jenis barang "${itemType.name}" diperbarui`,
          before: { name: itemType.name, active: itemType.active },
          after: { name: result.name, active: result.active },
        },
        tx,
      )
      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}

/**
 * Delete a master item type. Blocked while any location still records it, so
 * historical inventory can never lose the name of what it is describing.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireSarprasPermission("sarpras.item_types.delete")
    const body = deletePayload.parse(await request.json())

    const itemType = await prisma.sarprasItemType.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, active: true, _count: { select: { items: true } } },
    })
    if (!itemType) return NextResponse.json({ error: "Jenis barang tidak ditemukan" }, { status: 404 })

    if (itemType._count.items > 0) {
      return NextResponse.json(
        {
          error: `Jenis barang "${itemType.name}" masih dipakai ${itemType._count.items} data barang. Nonaktifkan saja agar riwayat tetap utuh.`,
          itemCount: itemType._count.items,
        },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.sarprasItemType.delete({ where: { id: itemType.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_ITEM_TYPE_DELETED",
          entity: "SarprasItemType",
          entityId: itemType.id,
          summary: `Jenis barang "${itemType.name}" dihapus`,
          before: { name: itemType.name, active: itemType.active },
        },
        tx,
      )
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}
