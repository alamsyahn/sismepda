import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { readAttendanceTrend } from "@/lib/server-attendance-trend"

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const params = new URL(request.url).searchParams
    const result = await readAttendanceTrend(user, {
      granularity: params.get("granularity"),
      from: params.get("from"),
      to: params.get("to"),
      classId: params.get("classId"),
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.data)
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Tren ketidakhadiran gagal dimuat" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}
