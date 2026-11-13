import { z } from "zod"
import { ApiError } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { followUps, scanVisitInput, type ScanResult } from "@/lib/scan"
import { scanWriteAccess } from "@/lib/server-scan-access"
import { cancelScanVisit, executeScan, saveScanVisit } from "@/lib/server-scan"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { portalOptions, portalResponse, verifyPortalWrite } from "@/lib/server-euks-portal"

const command = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("scan"),
    requestId: z.uuid(),
    code: z.string().trim().min(1).max(180),
  }),
  z.strictObject({
    action: z.literal("save"),
    visit: z.unknown(),
  }),
  z.strictObject({
    action: z.literal("cancel"),
    eventId: z.string().min(1).max(100),
  }),
])

function portalResult(result: ScanResult) {
  return {
    eventId: result.id,
    outcome: result.outcome,
    student: result.student && { name: result.student.name, className: result.student.className },
  }
}

export const OPTIONS = portalOptions

export function GET(request: Request) {
  return portalResponse(request, async () => {
    const { context } = await scanWriteAccess("uks")
    const complaints = context.grants.has("euks.complaint_options.read")
      ? await prisma.euksComplaintOption.findMany({
          where: { active: true },
          orderBy: { sortOrder: "asc" },
          select: { label: true },
        })
      : []
    return { followUps, complaints: complaints.map(row => row.label) }
  })
}

export function POST(request: Request) {
  return portalResponse(request, async () => {
    verifyPortalWrite(request)
    const { context, where } = await scanWriteAccess("uks")
    const actor = { ...context.user, where }
    const body = command.safeParse(await request.json().catch(() => null))
    if (!body.success) throw new ApiError(400, "Permintaan scan UKS tidak valid.")
    const input = body.data

    switch (input.action) {
      case "scan": {
        const result = await executeScan(prisma, actor, {
          requestId: input.requestId, code: input.code, mode: "uks", source: "CAMERA",
        }, {
          timeZone: await readSchoolTimeZone(),
          holiday: null, open: "", close: "", autoLock: false,
        })
        return portalResult(result)
      }
      case "save": {
        const visit = scanVisitInput.safeParse({
          ...(typeof input.visit === "object" && input.visit !== null ? input.visit : {}),
          notify: false,
        })
        if (!visit.success) throw new ApiError(400, "Lengkapi keluhan, tindakan, dan tindak lanjut.")
        const { result } = await saveScanVisit(prisma, actor, visit.data)
        return portalResult(result)
      }
      case "cancel":
        return cancelScanVisit(prisma, actor.id, input.eventId)
    }
  })
}
