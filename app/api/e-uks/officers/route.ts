import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksAdmin } from "@/lib/euks-access"
import { OFFICER_NAME_MAX, OFFICER_ROLE_MAX, normalizeLabel } from "@/lib/euks-settings"

const createPayload = z.object({
  // Guru terkait bila ada akunnya; null untuk siswa atau pihak luar.
  userId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(2).max(OFFICER_NAME_MAX),
  role: z.string().trim().min(2).max(OFFICER_ROLE_MAX),
})

const updatePayload = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(OFFICER_NAME_MAX).optional(),
  role: z.string().trim().min(2).max(OFFICER_ROLE_MAX).optional(),
  active: z.boolean().optional(),
  /** Geser satu posisi; urutan ditulis ulang rapat agar tidak ada nomor kembar. */
  move: z.enum(["up", "down"]).optional(),
})

export async function POST(request: Request) {
  try {
    const viewer = await requireEuksAdmin()
    const body = createPayload.parse(await request.json())

    // Nama disalin sebagai teks meski bertaut akun, supaya kartu tetap
    // terbaca bila akun guru dinonaktifkan atau dihapus.
    let name = normalizeLabel(body.name)
    if (body.userId) {
      const user = await prisma.user.findUnique({
        where: { id: body.userId },
        select: { id: true, name: true },
      })
      if (!user) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })
      name = user.name
    }

    const last = await prisma.euksOfficer.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })

    const created = await prisma.$transaction(async (tx) => {
      const officer = await tx.euksOfficer.create({
        data: {
          userId: body.userId ?? null,
          name,
          role: normalizeLabel(body.role),
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true, name: true, role: true, active: true, userId: true, sortOrder: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_OFFICER_CREATED",
          entity: "EuksOfficer",
          entityId: officer.id,
          summary: `Pengurus UKS "${officer.name}" (${officer.role}) ditambahkan`,
          after: { name: officer.name, role: officer.role, userId: officer.userId },
        },
        tx,
      )
      return officer
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: Request) {
  try {
    const viewer = await requireEuksAdmin()
    const body = updatePayload.parse(await request.json())

    const existing = await prisma.euksOfficer.findUnique({
      where: { id: body.id },
      select: { id: true, name: true, role: true, active: true, sortOrder: true },
    })
    if (!existing) return NextResponse.json({ error: "Pengurus tidak ditemukan" }, { status: 404 })

    if (body.move) {
      // Tukar dengan tetangga terdekat pada arah yang diminta. Memakai
      // sortOrder tetangga sebenarnya, bukan index array, supaya benar
      // walaupun nomor urut sempat renggang.
      const neighbour = await prisma.euksOfficer.findFirst({
        where:
          body.move === "up"
            ? { sortOrder: { lt: existing.sortOrder } }
            : { sortOrder: { gt: existing.sortOrder } },
        orderBy: { sortOrder: body.move === "up" ? "desc" : "asc" },
        select: { id: true, sortOrder: true },
      })
      if (!neighbour) return NextResponse.json(existing)

      await prisma.$transaction([
        prisma.euksOfficer.update({
          where: { id: existing.id },
          data: { sortOrder: neighbour.sortOrder },
        }),
        prisma.euksOfficer.update({
          where: { id: neighbour.id },
          data: { sortOrder: existing.sortOrder },
        }),
      ])
      return NextResponse.json({ ...existing, sortOrder: neighbour.sortOrder })
    }

    const data: { name?: string; role?: string; active?: boolean } = {}
    if (body.name !== undefined) data.name = normalizeLabel(body.name)
    if (body.role !== undefined) data.role = normalizeLabel(body.role)
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.$transaction(async (tx) => {
      const officer = await tx.euksOfficer.update({
        where: { id: body.id },
        data,
        select: { id: true, name: true, role: true, active: true, userId: true, sortOrder: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_OFFICER_UPDATED",
          entity: "EuksOfficer",
          entityId: officer.id,
          summary: `Pengurus UKS "${officer.name}" diperbarui`,
          before: { name: existing.name, role: existing.role, active: existing.active },
          after: { name: officer.name, role: officer.role, active: officer.active },
        },
        tx,
      )
      return officer
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
