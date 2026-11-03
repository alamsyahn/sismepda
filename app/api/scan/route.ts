import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { getAuthorizationContext, requireAnyPermission } from "@/lib/rbac-access"
import { getClassScopeFor } from "@/lib/rbac-class-access"
import { SCAN_PAGE_PERMISSIONS, scanInput } from "@/lib/scan"
import { assertScanOrigin, scanWriteAccess } from "@/lib/server-scan-access"
import { executeScan } from "@/lib/server-scan"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { readHolidayFor } from "@/lib/server-holidays"
import { todayInSchoolTimeZone } from "@/lib/school-date"
import { notifyAttendanceCompletion } from "@/lib/server-whatsapp-worker-client"
import { appLogoUrl } from "@/lib/site-branding"

export const dynamic = "force-dynamic"
const scanJson = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "no-store" } })
export async function GET() {
  try {
    await requireAnyPermission(SCAN_PAGE_PERMISSIONS)
    const { grants } = await getAuthorizationContext()
    const attendance = grants.has("scan.attendance.use") && Boolean(await getClassScopeFor("attendance", "write"))
    const uks = grants.has("scan.uks.use") && grants.has("euks.visits.create")
    const history = grants.has("scan.history.read")
    const historyAttendance = history && Boolean(await getClassScopeFor("attendance", "read"))
    const historyUks = history && grants.has("euks.visits.read")
    const cards = grants.has("scan.cards.manage") && grants.has("students.master.read")
    const complaints =
      uks && grants.has("euks.complaint_options.read")
        ? await prisma.euksComplaintOption.findMany({
            where: { active: true },
            orderBy: { sortOrder: "asc" },
            select: { label: true },
          })
        : []
    const school = await prisma.schoolSetting.findUnique({ where: { id: "default" }, select: { schoolName: true, appLogoUpdatedAt: true } })
    return scanJson({
      attendance,
      uks,
      cards,
      schoolName: school?.schoolName ?? "SISMEPDA",
      schoolLogoUrl: appLogoUrl(school?.appLogoUpdatedAt),
      historyAttendance,
      historyUks,
      notify: uks && grants.has("euks.visits.notify"),
      complaints: complaints.map((c) => c.label),
    })
  } catch (error) {
    return authFailureResponse(error)
  }
}
export async function POST(request: Request) {
  try {
    assertScanOrigin(request)
    await requireAnyPermission(["scan.attendance.use", "scan.uks.use"])
    const parsed = scanInput.safeParse(await request.json())
    if (!parsed.success) throw new ApiError(400, "Data scan tidak valid")
    const { context, where } = await scanWriteAccess(parsed.data.mode)
    const timeZone = await readSchoolTimeZone(),
      now = new Date()
    const setting = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { attendanceOpenTime: true, attendanceCloseTime: true, autoLock: true },
    })
    const holiday = await readHolidayFor(todayInSchoolTimeZone(now, timeZone))
    const result = await executeScan(prisma, { ...context.user, where }, parsed.data, {
      timeZone,
      now,
      holiday: holiday?.name ?? null,
      open: setting?.attendanceOpenTime ?? "06:30",
      close: setting?.attendanceCloseTime ?? "08:00",
      autoLock: setting?.autoLock ?? true,
    })
    if (result.outcome === "PRESENT") void notifyAttendanceCompletion()
    return scanJson(result)
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "Data scan tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Scan gagal diproses. Coba lagi dengan permintaan yang sama.")
  }
}
