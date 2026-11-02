import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { assertScanOrigin, scanWriteAccess } from "@/lib/server-scan-access"
import { cancelScanVisit, saveScanVisit } from "@/lib/server-scan"
import { scanVisitInput } from "@/lib/scan"
import { notifyEuksVisit } from "@/lib/server-euks-notification"

export async function POST(request: Request) {
  try {
    assertScanOrigin(request)
    const { context, where } = await scanWriteAccess("uks")
    const parsed = scanVisitInput.safeParse(await request.json())
    if (!parsed.success)
      throw new ApiError(400, "Lengkapi keluhan, tindakan, dan tindak lanjut (maksimal 500 karakter).")
    if (parsed.data.notify) await requirePermission("euks.visits.notify")
    const saved = await saveScanVisit(prisma, { ...context.user, where }, parsed.data)
    // Persistence is already committed; notification failure must return the visit.
    let notification: { status: string; message: string } | null = null
    if (saved.notify && saved.result.visitId) {
      try {
        notification = await notifyEuksVisit({
          visitId: saved.result.visitId,
          actorId: context.user.id,
          eventKey: `scan-visit:${saved.result.visitId}`,
        })
      } catch {
        notification = {
          status: "FAILED",
          message:
            "Kunjungan tersimpan. Status pengiriman belum dapat dipastikan; periksa di Riwayat Kunjungan UKS sebelum mengirim ulang.",
        }
      }
    }
    return NextResponse.json(
      {
        ...saved.result,
        notifyStatus: notification?.status ?? saved.result.notifyStatus,
        notifyError: notification?.status === "SENT" ? null : (notification?.message ?? saved.result.notifyError),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Data tidak valid" }, { status: 400 })
    return authFailureResponse(error)
  }
}
export async function DELETE(request: Request) {
  try {
    assertScanOrigin(request)
    const { context } = await scanWriteAccess("uks")
    const parsed = z
      .object({ eventId: z.string().min(1).max(100) })
      .strict()
      .safeParse(await request.json())
    if (!parsed.success) throw new ApiError(400, "ID scan tidak valid")
    return NextResponse.json(await cancelScanVisit(prisma, context.user.id, parsed.data.eventId), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Data tidak valid" }, { status: 400 })
    return authFailureResponse(error)
  }
}
