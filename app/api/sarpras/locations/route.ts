import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requireSarprasEditor, sarprasErrorResponse } from "@/lib/sarpras-access"
import { canReparent, normalizeSarprasName, sarprasSlug } from "@/lib/sarpras"

const createPayload = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})

const updatePayload = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  // `null` moves the location to the root; omitting it leaves the parent alone.
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})

const deletePayload = z.object({ id: z.string().min(1) })

/** Create a location anywhere in the tree. Requires sarpras.edit. */
export async function POST(request: Request) {
  try {
    const viewer = await requireSarprasEditor()
    const body = createPayload.parse(await request.json())
    const name = normalizeSarprasName(body.name)
    const slug = sarprasSlug(name)
    const parentId = body.parentId ?? null

    if (parentId !== null) {
      const parent = await prisma.sarprasLocation.findUnique({
        where: { id: parentId },
        select: { id: true },
      })
      if (!parent) return NextResponse.json({ error: "Lokasi induk tidak ditemukan" }, { status: 404 })
    }

    const clash = await prisma.sarprasLocation.findFirst({
      where: { parentId, slug },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: "Nama lokasi sudah digunakan pada induk yang sama" },
        { status: 409 },
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      const location = await tx.sarprasLocation.create({
        data: { name, slug, parentId, sortOrder: body.sortOrder ?? 0 },
        select: { id: true, name: true, parentId: true, sortOrder: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_LOCATION_CREATED",
          entity: "SarprasLocation",
          entityId: location.id,
          summary: `Lokasi sarpras "${location.name}" dibuat`,
          after: { name: location.name, parentId: location.parentId },
        },
        tx,
      )
      return location
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = sarprasErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Rename, reorder, or move a location. Requires sarpras.edit. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireSarprasEditor()
    const body = updatePayload.parse(await request.json())
    if (body.name === undefined && body.parentId === undefined && body.sortOrder === undefined) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const location = await prisma.sarprasLocation.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, slug: true, parentId: true, sortOrder: true },
    })
    if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 })

    const name = body.name === undefined ? location.name : normalizeSarprasName(body.name)
    const slug = sarprasSlug(name)
    const parentId = body.parentId === undefined ? location.parentId : body.parentId

    if (parentId !== location.parentId && parentId !== null) {
      const parent = await prisma.sarprasLocation.findUnique({
        where: { id: parentId },
        select: { id: true },
      })
      if (!parent) return NextResponse.json({ error: "Lokasi induk tidak ditemukan" }, { status: 404 })
    }

    // A location may never be moved into its own subtree — that would detach
    // the whole branch from the tree and make it unreachable in the UI.
    if (parentId !== location.parentId) {
      const all = await prisma.sarprasLocation.findMany({
        select: { id: true, name: true, parentId: true, sortOrder: true },
      })
      if (!canReparent(all, location.id, parentId)) {
        return NextResponse.json(
          { error: "Lokasi tidak dapat dipindahkan ke dalam sub-lokasinya sendiri" },
          { status: 400 },
        )
      }
    }

    const clash = await prisma.sarprasLocation.findFirst({
      where: { parentId, slug, id: { not: location.id } },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: "Nama lokasi sudah digunakan pada induk yang sama" },
        { status: 409 },
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sarprasLocation.update({
        where: { id: location.id },
        data: {
          name,
          slug,
          parentId,
          ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        },
        select: { id: true, name: true, parentId: true, sortOrder: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_LOCATION_UPDATED",
          entity: "SarprasLocation",
          entityId: location.id,
          summary: `Lokasi sarpras "${location.name}" diperbarui`,
          before: { name: location.name, parentId: location.parentId, sortOrder: location.sortOrder },
          after: { name: result.name, parentId: result.parentId, sortOrder: result.sortOrder },
        },
        tx,
      )
      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = sarprasErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Delete a location. Blocked while it still holds sub-locations or items —
 * the caller must move or delete the contents first. This is deliberately a
 * refusal rather than a cascade: silently destroying a whole branch of the
 * inventory would be unrecoverable.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireSarprasEditor()
    const body = deletePayload.parse(await request.json())

    const location = await prisma.sarprasLocation.findUnique({
      where: { id: body.id },
      select: {
        id: true,
        name: true,
        parentId: true,
        _count: { select: { children: true, items: true } },
      },
    })
    if (!location) return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 })

    if (location._count.children > 0 || location._count.items > 0) {
      const parts: string[] = []
      if (location._count.children > 0) parts.push(`${location._count.children} sub-lokasi`)
      if (location._count.items > 0) parts.push(`${location._count.items} barang`)
      return NextResponse.json(
        {
          error: `Lokasi "${location.name}" masih berisi ${parts.join(" dan ")}. Pindahkan atau hapus isinya terlebih dahulu.`,
          childCount: location._count.children,
          itemCount: location._count.items,
        },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.sarprasLocation.delete({ where: { id: location.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "SARPRAS_LOCATION_DELETED",
          entity: "SarprasLocation",
          entityId: location.id,
          summary: `Lokasi sarpras "${location.name}" dihapus`,
          before: { name: location.name, parentId: location.parentId },
        },
        tx,
      )
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { error: message, status } = sarprasErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
