import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { listRevisions, rollbackToRevision } from "@/lib/server-schedule"

const rollbackPayload = z.object({ revisionId: z.string().min(1) })

/** Riwayat versi jadwal, terbaru dulu. */
export async function GET() {
  try {
    await requireSchedulePermission("schedule.revisions.read")
    const revisions = await listRevisions()
    return NextResponse.json({ revisions })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat riwayat jadwal")
  }
}

/**
 * Rollback: menjadikan salinan versi lama sebagai jadwal aktif baru.
 *
 * Atomik, tercatat audit, dan tidak pernah menghapus riwayat — versi lama tetap
 * ada dan nomor versi tidak pernah mundur.
 */
export async function POST(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.revisions.rollback")
    const body = rollbackPayload.parse(await request.json())
    const revision = await rollbackToRevision(body.revisionId, viewer.id)
    return NextResponse.json({ revision }, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Gagal mengembalikan versi jadwal")
  }
}
