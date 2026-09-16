import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { applyImport, buildPreview, cancelImport } from "@/lib/server-schedule-import"

const actionPayload = z.object({ action: z.enum(["apply", "cancel"]) })

/** Pratinjau sebuah impor terhadap jadwal aktif. Murni baca. */
export async function GET(_request: Request, context: { params: Promise<{ importId: string }> }) {
  try {
    await requireSchedulePermission("schedule.import")
    const { importId } = await context.params
    return NextResponse.json(await buildPreview(importId))
  } catch (error) {
    return authFailureResponse(error, "Gagal menyusun pratinjau impor")
  }
}

/** Terapkan atau batalkan satu pratinjau. */
export async function POST(request: Request, context: { params: Promise<{ importId: string }> }) {
  try {
    const { importId } = await context.params
    const body = actionPayload.parse(await request.json())

    if (body.action === "cancel") {
      const viewer = await requireSchedulePermission("schedule.import")
      await cancelImport(importId, viewer.id)
      return NextResponse.json({ ok: true })
    }

    // Menerapkan adalah kewenangan tersendiri: mengunggah dan memetakan boleh
    // dikerjakan operator, mengganti jadwal sekolah tidak.
    const viewer = await requireSchedulePermission("schedule.import")
    const result = await applyImport(importId, viewer.id)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Gagal memproses impor")
  }
}
