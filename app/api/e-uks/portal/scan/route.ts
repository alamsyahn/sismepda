import { z } from "zod"
import { ApiError } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { followUps, scanVisitInput, type ScanResult } from "@/lib/scan"
import { scanWriteAccess } from "@/lib/server-scan-access"
import { cancelScanVisit, executeScan, saveScanVisit, scanStudentMatch } from "@/lib/server-scan"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { portalOptions, portalResponse, verifyPortalWrite } from "@/lib/server-euks-portal"

const command = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("scan"),
    requestId: z.uuid(),
    code: z.string().trim().min(1).max(180),
  }),
  z.strictObject({
    action: z.literal("select"),
    requestId: z.uuid(),
    studentId: z.string().min(1).max(100),
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
    const { context, where } = await scanWriteAccess("uks")
    const params = new URL(request.url).searchParams
    if (params.has("q")) {
      const q = (params.get("q") ?? "").trim().slice(0, 100)
      if (q.length < 2) return { students: [] }
      const students = await prisma.student.findMany({
        where: { active: true, schoolClass: where, ...scanStudentMatch(q) },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 20,
        select: { id: true, name: true, nis: true, schoolClass: { select: { name: true } } },
      })
      return { students: students.map(({ id, name, nis, schoolClass }) => ({ id, name, nis, className: schoolClass.name })) }
    }
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
      case "scan":
      case "select": {
        const scan = input.action === "scan"
          ? { requestId: input.requestId, code: input.code, mode: "uks" as const, source: "CAMERA" as const }
          : { requestId: input.requestId, studentId: input.studentId, mode: "uks" as const, source: "MANUAL" as const }
        const result = await executeScan(prisma, actor, scan, {
          timeZone: await readSchoolTimeZone(),
          holiday: null, open: "", close: "", autoLock: false,
        })
        const profile = result.outcome === "DRAFT" && result.student && context.grants.has("euks.monitoring.read")
          ? { studentId: result.student.id, classId: result.student.classId }
          : null
        return { ...portalResult(result), profile }
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
