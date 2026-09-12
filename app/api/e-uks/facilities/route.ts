import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import {
  FACILITY_NAME_MAX,
  FACILITY_NOTE_MAX,
  FACILITY_QUANTITY_MAX,
  euksSlug,
  normalizeLabel,
} from "@/lib/euks-settings"

const createPayload = z.object({
  name: z.string().trim().min(2).max(FACILITY_NAME_MAX),
  quantity: z.number().int().min(0).max(FACILITY_QUANTITY_MAX).nullable().optional(),
  note: z
    .string()
    .trim()
    .max(FACILITY_NOTE_MAX)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
})

const updatePayload = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(FACILITY_NAME_MAX).optional(),
  quantity: z.number().int().min(0).max(FACILITY_QUANTITY_MAX).nullable().optional(),
  note: z
    .string()
    .trim()
    .max(FACILITY_NOTE_MAX)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
  active: z.boolean().optional(),
})

const deletePayload = z.object({ id: z.string().min(1) })

const SELECT = {
  id: true,
  name: true,
  quantity: true,
  note: true,
  active: true,
  sortOrder: true,
  photoUpdatedAt: true,
} as const

/**
 * Tambah fasilitas. Varian huruf besar-kecil dipulihkan ke entri yang sudah
 * ada, bukan menciptakan duplikat — mengikuti pola kategori BOS.
 */
export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.facilities.create")
    const body = createPayload.parse(await request.json())
    const name = normalizeLabel(body.name)
    const slug = euksSlug(name)

    const existing = await prisma.euksFacility.findUnique({ where: { slug }, select: SELECT })
    if (existing) {
      if (existing.active) return NextResponse.json({ ...existing, reused: true })
      const revived = await prisma.euksFacility.update({
        where: { id: existing.id },
        data: { active: true },
        select: SELECT,
      })
      return NextResponse.json({ ...revived, reused: true })
    }

    const last = await prisma.euksFacility.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })

    const created = await prisma.$transaction(async (tx) => {
      const facility = await tx.euksFacility.create({
        data: {
          name,
          slug,
          quantity: body.quantity ?? null,
          note: body.note ?? null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: SELECT,
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_FACILITY_CREATED",
          entity: "EuksFacility",
          entityId: facility.id,
          summary: `Fasilitas UKS "${facility.name}" ditambahkan`,
          after: { name: facility.name, quantity: facility.quantity },
        },
        tx,
      )
      return facility
    })

    return NextResponse.json({ ...created, reused: false }, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Perbarui isi atau status tampil satu fasilitas. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.facilities.update")
    const body = updatePayload.parse(await request.json())

    const existing = await prisma.euksFacility.findUnique({ where: { id: body.id }, select: SELECT })
    if (!existing) return NextResponse.json({ error: "Fasilitas tidak ditemukan" }, { status: 404 })

    const data: { name?: string; slug?: string; quantity?: number | null; note?: string | null; active?: boolean } = {}
    if (body.name !== undefined) {
      const name = normalizeLabel(body.name)
      const slug = euksSlug(name)
      // Ganti nama tidak boleh menabrak entri lain yang slug-nya sama.
      const clash = await prisma.euksFacility.findUnique({ where: { slug }, select: { id: true } })
      if (clash && clash.id !== existing.id) {
        return NextResponse.json({ error: "Fasilitas dengan nama itu sudah ada" }, { status: 409 })
      }
      data.name = name
      data.slug = slug
    }
    if (body.quantity !== undefined) data.quantity = body.quantity
    if (body.note !== undefined) data.note = body.note
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.$transaction(async (tx) => {
      const facility = await tx.euksFacility.update({ where: { id: body.id }, data, select: SELECT })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_FACILITY_UPDATED",
          entity: "EuksFacility",
          entityId: facility.id,
          summary: `Fasilitas UKS "${facility.name}" diperbarui`,
          before: { name: existing.name, quantity: existing.quantity, active: existing.active },
          after: { name: facility.name, quantity: facility.quantity, active: facility.active },
        },
        tx,
      )
      return facility
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Hapus satu fasilitas beserta fotonya.
 *
 * Berbeda dari toggle: menonaktifkan hanya menyembunyikan entri dari Halaman
 * Utama, sedangkan ini benar-benar melepas slug-nya sehingga nama yang sama
 * dapat dibuat ulang sebagai entri baru. Tidak ada data lain yang mereferensi
 * fasilitas, jadi penghapusan tidak menyentuh kunjungan atau inventaris Sarpras.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.facilities.delete")
    const body = deletePayload.parse(await request.json())

    const existing = await prisma.euksFacility.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, quantity: true, note: true },
    })
    if (!existing) return NextResponse.json({ error: "Fasilitas tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksFacility.delete({ where: { id: existing.id } })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_FACILITY_DELETED",
          entity: "EuksFacility",
          entityId: existing.id,
          summary: `Fasilitas UKS "${existing.name}" dihapus`,
          before: { name: existing.name, quantity: existing.quantity, note: existing.note },
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
