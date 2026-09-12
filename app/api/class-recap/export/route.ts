import { NextResponse } from "next/server"
import { authFailureResponse } from "@/lib/api-errors"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { classRecapWorkbook, xlsxDownload } from "@/lib/class-recap-xlsx"
import { readClassPeriodRecap } from "@/lib/server-class-recap"

export async function GET(request: Request) {
  try {
    // Ekspor adalah kewenangan tersendiri, dan scope-nya milik operasi export
    // sendiri — bukan pinjaman dari attendance.reports.read.
    const scope = await requireClassScopeFor("attendance", "export")
    const params = new URL(request.url).searchParams
    const classId = params.get("classId")?.trim() ?? ""
    const from = params.get("from")?.trim() ?? ""
    const to = params.get("to")?.trim() ?? ""
    const mode = params.get("mode") === "matrix" ? "matrix" : "cumulative"
    if (!classId) return NextResponse.json({ error: "Pilih kelas terlebih dahulu" }, { status: 400 })
    const result = await readClassPeriodRecap(scope, classId, from, to)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const buffer = await classRecapWorkbook(result.data, mode)
    return xlsxDownload(buffer, `rekap-${mode}-${result.data.schoolClass.name}-${from}-${to}.xlsx`)
  } catch (error) {
    return authFailureResponse(error, "Export Excel gagal")
  }
}
