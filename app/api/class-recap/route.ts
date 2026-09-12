import { NextResponse } from "next/server"
import { authFailureResponse } from "@/lib/api-errors"
import { readClassPeriodRecap } from "@/lib/server-class-recap"
import { requireClassScopeFor } from "@/lib/rbac-class-access"

export async function GET(request: Request) {
  try {
    const scope = await requireClassScopeFor("attendance.reports", "read")
    const params = new URL(request.url).searchParams
    const classId = params.get("classId")?.trim() ?? ""
    const from = params.get("from")?.trim() ?? ""
    const to = params.get("to")?.trim() ?? ""
    if (!classId) return NextResponse.json({ error: "Pilih kelas terlebih dahulu" }, { status: 400 })
    const result = await readClassPeriodRecap(scope, classId, from, to)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.data)
  } catch (error) {
    return authFailureResponse(error, "Rekap kelas gagal dimuat")
  }
}
