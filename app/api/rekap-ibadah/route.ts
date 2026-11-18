import { NextResponse } from "next/server"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/rbac-access"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { parseSchoolDate, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { assertScanOrigin } from "@/lib/server-scan-access"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { editWorshipAttendance } from "@/lib/server-worship-attendance"
import { worshipEditInput } from "@/lib/worship-attendance"

export async function POST(request: Request) {
  try {
    assertScanOrigin(request)
    const scope = await requireClassScopeFor("attendance", "write")
    const actor = await requireUser()
    const body = worshipEditInput.safeParse(await request.json().catch(() => null))
    if (!body.success) throw new ApiError(400, "Isian catatan ibadah tidak valid. Isi alasan perubahan.")

    const schoolDate = parseSchoolDate(body.data.date)
    const today = todayInSchoolTimeZone(undefined, await readSchoolTimeZone())
    if (!schoolDate || schoolDate > today) throw new ApiError(400, "Tanggal ibadah tidak valid")

    await editWorshipAttendance(prisma, scope, actor, body.data, toPrismaDate(schoolDate))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Catatan ibadah gagal disimpan")
  }
}
