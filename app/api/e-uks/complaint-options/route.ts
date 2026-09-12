import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { COMPLAINT_LABEL_MAX, euksSlug, normalizeLabel } from "@/lib/euks-settings"

const createPayload = z.object({
  label: z.string().trim().min(2).max(COMPLAINT_LABEL_MAX),
})

const updatePayload = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(2).max(COMPLAINT_LABEL_MAX).optional(),
  active: z.boolean().optional(),
})

const SELECT = { id: true, label: true, active: true, sortOrder: true } as const

/**
 * Daftar keluhan aktif untuk form kunjungan.
 *
 * Cukup izin editor: petugas yang mencatat kunjungan perlu membaca daftar ini,
 * dan mengelolanya tetap butuh admin.
 */
export async function GET() {
  try {
    await requireEuksPermission("euks.complaint_options.read")
    const options = await prisma.euksComplaintOption.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: SELECT,
    })
    return NextResponse.json(options)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.complaint_options.create")
    const body = createPayload.parse(await request.json())
    const label = normalizeLabel(body.label)
    const slug = euksSlug(label)

    const existing = await prisma.euksComplaintOption.findUnique({ where: { slug }, select: SELECT })
    if (existing) {
      if (existing.active) return NextResponse.json({ ...existing, reused: true })
      const revived = await prisma.euksComplaintOption.update({
        where: { id: existing.id },
        data: { active: true },
        select: SELECT,
      })
      return NextResponse.json({ ...revived, reused: true })
    }

    const last = await prisma.euksComplaintOption.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })

    const created = await prisma.$transaction(async (tx) => {
      const option = await tx.euksComplaintOption.create({
        data: { label, slug, sortOrder: (last?.sortOrder ?? -1) + 1 },
        select: SELECT,
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_COMPLAINT_OPTION_CREATED",
          entity: "EuksComplaintOption",
          entityId: option.id,
          summary: `Pilihan keluhan "${option.label}" ditambahkan`,
          after: { label: option.label },
        },
        tx,
      )
      return option
    })

    return NextResponse.json({ ...created, reused: false }, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Ubah label atau nonaktifkan pilihan.
 *
 * Pilihan tidak pernah dihapus, dan mengubah label di sini TIDAK menulis ulang
 * keluhan pada kunjungan yang sudah tercatat — riwayat harus tetap menunjukkan
 * apa yang benar-benar dicatat saat itu.
 */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.complaint_options.update")
    const body = updatePayload.parse(await request.json())

    const existing = await prisma.euksComplaintOption.findUnique({
      where: { id: body.id },
      select: SELECT,
    })
    if (!existing) return NextResponse.json({ error: "Pilihan keluhan tidak ditemukan" }, { status: 404 })

    const data: { label?: string; slug?: string; active?: boolean } = {}
    if (body.label !== undefined) {
      const label = normalizeLabel(body.label)
      const slug = euksSlug(label)
      const clash = await prisma.euksComplaintOption.findUnique({
        where: { slug },
        select: { id: true },
      })
      if (clash && clash.id !== existing.id) {
        return NextResponse.json({ error: "Pilihan keluhan itu sudah ada" }, { status: 409 })
      }
      data.label = label
      data.slug = slug
    }
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.$transaction(async (tx) => {
      const option = await tx.euksComplaintOption.update({
        where: { id: body.id },
        data,
        select: SELECT,
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_COMPLAINT_OPTION_UPDATED",
          entity: "EuksComplaintOption",
          entityId: option.id,
          summary: `Pilihan keluhan "${option.label}" diperbarui`,
          before: { label: existing.label, active: existing.active },
          after: { label: option.label, active: option.active },
        },
        tx,
      )
      return option
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
