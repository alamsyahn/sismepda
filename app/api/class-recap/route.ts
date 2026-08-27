import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { readClassPeriodRecap } from "@/lib/server-class-recap"

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const params = new URL(request.url).searchParams
    const classId = params.get("classId")?.trim() ?? ""
    const from = params.get("from")?.trim() ?? ""
    const to = params.get("to")?.trim() ?? ""
    if (!classId) return NextResponse.json({ error: "Pilih kelas terlebih dahulu" }, { status: 400 })
    const result = await readClassPeriodRecap(user, classId, from, to)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.data)
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json({ error: unauthorized ? "Sesi tidak valid" : "Rekap kelas gagal dimuat" }, { status: unauthorized ? 401 : 500 })
  }
}
