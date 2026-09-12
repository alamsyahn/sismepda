import { NextResponse } from "next/server"
import { authFailureResponse } from "@/lib/api-errors"
import { readAttendanceTrend } from "@/lib/server-attendance-trend"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"

export async function GET(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const params = new URL(request.url).searchParams
    const result = await readAttendanceTrend({
      granularity: params.get("granularity"),
      from: params.get("from"),
      to: params.get("to"),
      classId: params.get("classId"),
    }, timeZone)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.data)
  } catch (error) {
    return authFailureResponse(error, "Tren ketidakhadiran gagal dimuat")
  }
}
