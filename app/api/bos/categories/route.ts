import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { categorySlug, normalizeCategoryName } from "@/lib/bos"

const createPayload = z.object({ name: z.string().trim().min(2).max(80) })

const updatePayload = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(80).optional(),
  active: z.boolean().optional(),
})

/**
 * Create a category. bos.create is enough — users add categories from inside
 * the entry form. Case/whitespace variants resolve to the existing category
 * instead of creating a duplicate.
 */
export async function POST(request: Request) {
  try {
    const viewer = await requirePermission("bos.categories.create")
    const body = createPayload.parse(await request.json())
    const name = normalizeCategoryName(body.name)
    const slug = categorySlug(name)

    const existing = await prisma.bosCategory.findUnique({
      where: { slug },
      select: { id: true, name: true, active: true },
    })
    // Reuse the existing category; reactivate it if it had been disabled.
    if (existing) {
      if (existing.active) return NextResponse.json({ ...existing, reused: true })
      const revived = await prisma.bosCategory.update({
        where: { id: existing.id },
        data: { active: true },
        select: { id: true, name: true, active: true },
      })
      return NextResponse.json({ ...revived, reused: true })
    }

    const created = await prisma.$transaction(async (tx) => {
      const category = await tx.bosCategory.create({
        data: { name, slug },
        select: { id: true, name: true, active: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.user.id,
          action: "BOS_CATEGORY_CREATED",
          entity: "BosCategory",
          entityId: category.id,
          summary: `Kategori BOS "${category.name}" dibuat`,
          after: { name: category.name, active: category.active },
        },
        tx,
      )
      return category
    })

    return NextResponse.json({ ...created, reused: false }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data kategori tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Kategori BOS gagal diproses")
  }
}

/**
 * Rename or deactivate a category. Requires bos.manage_categories.
 * Categories are never deleted — historical entries keep pointing at them.
 */
export async function PATCH(request: Request) {
  try {
    const viewer = await requirePermission("bos.categories.update")
    const body = updatePayload.parse(await request.json())
    if (body.name === undefined && body.active === undefined) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const category = await prisma.bosCategory.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, active: true },
    })
    if (!category) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 })

    const name = body.name === undefined ? undefined : normalizeCategoryName(body.name)
    if (name !== undefined) {
      const clash = await prisma.bosCategory.findUnique({
        where: { slug: categorySlug(name) },
        select: { id: true },
      })
      if (clash && clash.id !== category.id) {
        return NextResponse.json({ error: "Nama kategori sudah digunakan" }, { status: 409 })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bosCategory.update({
        where: { id: category.id },
        data: {
          ...(name === undefined ? {} : { name, slug: categorySlug(name) }),
          ...(body.active === undefined ? {} : { active: body.active }),
        },
        select: { id: true, name: true, active: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.user.id,
          action: "BOS_CATEGORY_UPDATED",
          entity: "BosCategory",
          entityId: category.id,
          summary: `Kategori BOS "${category.name}" diperbarui`,
          before: { name: category.name, active: category.active },
          after: { name: result.name, active: result.active },
        },
        tx,
      )
      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data kategori tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Kategori BOS gagal diproses")
  }
}
