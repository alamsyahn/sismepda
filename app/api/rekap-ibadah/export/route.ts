import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { xlsxDownload } from "@/lib/class-recap-xlsx"
import { prisma } from "@/lib/prisma"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { todayInSchoolTimeZone } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { parseWorshipExportRange, readWorshipExport } from "@/lib/server-worship-export"
import { worshipWorkbook } from "@/lib/worship-xlsx"

export async function GET(request: Request) {
  try {
    const scope = await requireClassScopeFor("attendance", "export")
    const params = new URL(request.url).searchParams
    const classId = params.get("classId")?.trim()
    if (!classId) throw new ApiError(400, "Pilih kelas terlebih dahulu")
    const timeZone = await readSchoolTimeZone()
    const range = parseWorshipExportRange(params.get("from"), params.get("to"), todayInSchoolTimeZone(undefined, timeZone))
    const data = await readWorshipExport(prisma, scope, classId, range)
    const buffer = await worshipWorkbook(data, timeZone)
    return xlsxDownload(buffer, `rekap-ibadah-${data.className}-${range.from}-${range.to}.xlsx`)
  } catch (error) {
    return authFailureResponse(error, "Ekspor Rekap Ibadah gagal")
  }
}
