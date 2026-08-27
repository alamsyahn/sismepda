import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { classRecapWorkbook, xlsxDownload } from "@/lib/class-recap-xlsx"
import { readClassPeriodRecap } from "@/lib/server-class-recap"

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const params = new URL(request.url).searchParams
    const classId = params.get("classId")?.trim() ?? ""
    const from = params.get("from")?.trim() ?? ""
    const to = params.get("to")?.trim() ?? ""
    const mode = params.get("mode") === "matrix" ? "matrix" : "cumulative"
    if (!classId) return NextResponse.json({ error: "Pilih kelas terlebih dahulu" }, { status: 400 })
    const result = await readClassPeriodRecap(user, classId, from, to)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const buffer = await classRecapWorkbook(result.data, mode)
    return xlsxDownload(buffer, `rekap-${mode}-${result.data.schoolClass.name}-${from}-${to}.xlsx`)
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json({ error: unauthorized ? "Sesi tidak valid" : "Export Excel gagal" }, { status: unauthorized ? 401 : 500 })
  }
}
