import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { normalizeLabel } from "@/lib/euks-settings"

/**
 * Logo institusi pada hero Halaman Utama E-UKS.
 *
 * Mengikuti pola foto hero: baris dibuat lebih dulu di sini, berkasnya menyusul
 * pada permintaan kedua ke sub-rute `logo`. Bedanya `name` wajib diisi, karena
 * nama itulah yang menjadi teks alternatif — logo mewakili institusi, jadi
 * tidak boleh berakhir sebagai gambar tanpa makna bagi pembaca layar.
 */

const NAME_MAX = 80

const nameField = z
  .string()
  .trim()
  .min(1, "Nama logo wajib diisi")
  .max(NAME_MAX)
  .transform((value) => normalizeLabel(value))

const createPayload = z.object({ name: nameField })

const updatePayload = z.object({
  id: z.string().min(1),
  name: nameField.optional(),
  active: z.boolean().optional(),
  /** Geser satu posisi; urutan ditukar dengan tetangga terdekat. */
  move: z.enum(["up", "down"]).optional(),
})

const deletePayload = z.object({ id: z.string().min(1) })

const logoSelect = {
  id: true,
  name: true,
  active: true,
  sortOrder: true,
  logoUpdatedAt: true,
} as const

export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.hero_logos.create")
    const body = createPayload.parse(await request.json())

    const last = await prisma.euksHeroLogo.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })

    const created = await prisma.$transaction(async (tx) => {
      const logo = await tx.euksHeroLogo.create({
        data: { name: body.name, sortOrder: (last?.sortOrder ?? -1) + 1 },
        select: logoSelect,
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_LOGO_CREATED",
          entity: "EuksHeroLogo",
          entityId: logo.id,
          summary: `Logo hero UKS "${logo.name}" ditambahkan`,
          after: { name: logo.name, sortOrder: logo.sortOrder },
        },
        tx,
      )
      return logo
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.hero_logos.update")
    const body = updatePayload.parse(await request.json())

    const existing = await prisma.euksHeroLogo.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, active: true, sortOrder: true },
    })
    if (!existing) return NextResponse.json({ error: "Logo tidak ditemukan" }, { status: 404 })

    if (body.move) {
      // Tukar sortOrder dengan tetangga terdekat pada arah yang diminta, memakai
      // sortOrder tetangga sebenarnya dan bukan index array, supaya tetap benar
      // walaupun nomor urut sempat renggang.
      const neighbour = await prisma.euksHeroLogo.findFirst({
        where:
          body.move === "up"
            ? { sortOrder: { lt: existing.sortOrder } }
            : { sortOrder: { gt: existing.sortOrder } },
        orderBy: { sortOrder: body.move === "up" ? "desc" : "asc" },
        select: { id: true, sortOrder: true },
      })
      if (!neighbour) return NextResponse.json(existing)

      await prisma.$transaction([
        prisma.euksHeroLogo.update({
          where: { id: existing.id },
          data: { sortOrder: neighbour.sortOrder },
        }),
        prisma.euksHeroLogo.update({
          where: { id: neighbour.id },
          data: { sortOrder: existing.sortOrder },
        }),
      ])
      return NextResponse.json({ ...existing, sortOrder: neighbour.sortOrder })
    }

    const data: { name?: string; active?: boolean } = {}
    if (body.name !== undefined) data.name = body.name
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.$transaction(async (tx) => {
      const logo = await tx.euksHeroLogo.update({
        where: { id: body.id },
        data,
        select: logoSelect,
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_LOGO_UPDATED",
          entity: "EuksHeroLogo",
          entityId: logo.id,
          summary: `Logo hero UKS "${logo.name}" diperbarui`,
          before: { name: existing.name, active: existing.active },
          after: { name: logo.name, active: logo.active },
        },
        tx,
      )
      return logo
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Hapus satu logo. Byte-nya ikut terhapus karena tersimpan pada baris yang
 * sama, sehingga tidak ada berkas yatim yang tertinggal.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.hero_logos.delete")
    const body = deletePayload.parse(await request.json())

    const existing = await prisma.euksHeroLogo.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, sortOrder: true },
    })
    if (!existing) return NextResponse.json({ error: "Logo tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksHeroLogo.delete({ where: { id: existing.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_LOGO_DELETED",
          entity: "EuksHeroLogo",
          entityId: existing.id,
          summary: `Logo hero UKS "${existing.name}" dihapus`,
          before: { name: existing.name, sortOrder: existing.sortOrder },
        },
        tx,
      )
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
