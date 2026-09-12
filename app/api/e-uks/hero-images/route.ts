import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { HERO_CAPTION_MAX, normalizeLabel } from "@/lib/euks-settings"

/**
 * Foto hero Halaman Utama E-UKS.
 *
 * Mengikuti pola pengurus dan fasilitas: baris dibuat lebih dulu di sini, lalu
 * byte fotonya diunggah pada permintaan kedua ke sub-rute `photo`. Unggahan
 * yang gagal karena itu hanya menyisakan entri tanpa foto, bukan record
 * setengah tertulis.
 *
 * Tidak ada batas jumlah foto: sekolah yang ingin memasang sepuluh foto tidak
 * dihalangi, dan Halaman Utama memuat slide kedua dan seterusnya secara lazy
 * sehingga jumlah banyak tidak membebani muatan awal.
 */

/** Teks kosong berarti tanpa keterangan, disimpan sebagai null. */
const captionField = z
  .string()
  .trim()
  .max(HERO_CAPTION_MAX)
  .transform((value) => (value === "" ? null : normalizeLabel(value)))
  .nullable()
  .optional()

const createPayload = z.object({ caption: captionField })

const updatePayload = z.object({
  id: z.string().min(1),
  caption: captionField,
  active: z.boolean().optional(),
  /** Geser satu posisi; urutan ditukar dengan tetangga terdekat. */
  move: z.enum(["up", "down"]).optional(),
})

const deletePayload = z.object({ id: z.string().min(1) })

export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.hero_images.create")
    const body = createPayload.parse(await request.json())

    const last = await prisma.euksHeroImage.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })

    const created = await prisma.$transaction(async (tx) => {
      const image = await tx.euksHeroImage.create({
        data: {
          caption: body.caption ?? null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true, caption: true, active: true, sortOrder: true, photoUpdatedAt: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_IMAGE_CREATED",
          entity: "EuksHeroImage",
          entityId: image.id,
          summary: image.caption
            ? `Foto hero UKS "${image.caption}" ditambahkan`
            : "Foto hero UKS ditambahkan",
          after: { caption: image.caption, sortOrder: image.sortOrder },
        },
        tx,
      )
      return image
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.hero_images.update")
    const body = updatePayload.parse(await request.json())

    const existing = await prisma.euksHeroImage.findUnique({
      where: { id: body.id },
      select: { id: true, caption: true, active: true, sortOrder: true },
    })
    if (!existing) return NextResponse.json({ error: "Foto hero tidak ditemukan" }, { status: 404 })

    if (body.move) {
      // Tukar sortOrder dengan tetangga terdekat pada arah yang diminta.
      // Memakai sortOrder tetangga sebenarnya, bukan index array, supaya tetap
      // benar walaupun nomor urut sempat renggang.
      const neighbour = await prisma.euksHeroImage.findFirst({
        where:
          body.move === "up"
            ? { sortOrder: { lt: existing.sortOrder } }
            : { sortOrder: { gt: existing.sortOrder } },
        orderBy: { sortOrder: body.move === "up" ? "desc" : "asc" },
        select: { id: true, sortOrder: true },
      })
      if (!neighbour) return NextResponse.json(existing)

      await prisma.$transaction([
        prisma.euksHeroImage.update({
          where: { id: existing.id },
          data: { sortOrder: neighbour.sortOrder },
        }),
        prisma.euksHeroImage.update({
          where: { id: neighbour.id },
          data: { sortOrder: existing.sortOrder },
        }),
      ])
      return NextResponse.json({ ...existing, sortOrder: neighbour.sortOrder })
    }

    const data: { caption?: string | null; active?: boolean } = {}
    if (body.caption !== undefined) data.caption = body.caption
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.$transaction(async (tx) => {
      const image = await tx.euksHeroImage.update({
        where: { id: body.id },
        data,
        select: { id: true, caption: true, active: true, sortOrder: true, photoUpdatedAt: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_IMAGE_UPDATED",
          entity: "EuksHeroImage",
          entityId: image.id,
          summary: "Foto hero UKS diperbarui",
          before: { caption: existing.caption, active: existing.active },
          after: { caption: image.caption, active: image.active },
        },
        tx,
      )
      return image
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Hapus satu foto hero. Byte-nya ikut terhapus karena tersimpan pada baris
 * yang sama, sehingga tidak ada berkas yatim yang tertinggal.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.hero_images.delete")
    const body = deletePayload.parse(await request.json())

    const existing = await prisma.euksHeroImage.findUnique({
      where: { id: body.id },
      select: { id: true, caption: true, sortOrder: true },
    })
    if (!existing) return NextResponse.json({ error: "Foto hero tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksHeroImage.delete({ where: { id: existing.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_IMAGE_DELETED",
          entity: "EuksHeroImage",
          entityId: existing.id,
          summary: existing.caption
            ? `Foto hero UKS "${existing.caption}" dihapus`
            : "Foto hero UKS dihapus",
          before: { caption: existing.caption, sortOrder: existing.sortOrder },
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
