import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { createEntry, deleteEntry, updateEntry } from "@/lib/server-schedule"
import { MAX_ASC_PERIOD } from "@/lib/schedule-time"

/**
 * Editor manual: satu penempatan jadwal.
 *
 * Jalur ini setara dengan impor aSc dan bukan pelengkapnya — perubahan kecil
 * ("Rabu jam ke-5 ganti guru") tidak perlu membuka aSc dan mengekspor ulang.
 * Bentrok kelas/guru ditolak di server dengan 409, tidak pernah ditimpa diam-diam.
 */
const entryPayload = z.object({
  day: z.number().int().min(1).max(6),
  period: z.number().int().min(1).max(MAX_ASC_PERIOD),
  classId: z.string().min(1),
  subjectId: z.string().min(1),
  teacherId: z.string().min(1).nullable(),
  room: z.string().trim().max(60).nullable(),
})

const updatePayload = entryPayload.extend({ id: z.string().min(1) })
const deletePayload = z.object({ id: z.string().min(1) })

export async function POST(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.entries.create")
    const body = entryPayload.parse(await request.json())
    const created = await createEntry(body, viewer.id)
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Data jadwal tidak valid")
  }
}

export async function PATCH(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.entries.update")
    const { id, ...rest } = updatePayload.parse(await request.json())
    const updated = await updateEntry(id, rest, viewer.id)
    return NextResponse.json(updated)
  } catch (error) {
    return authFailureResponse(error, "Data jadwal tidak valid")
  }
}

export async function DELETE(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.entries.delete")
    const body = deletePayload.parse(await request.json())
    await deleteEntry(body.id, viewer.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Data jadwal tidak valid")
  }
}
