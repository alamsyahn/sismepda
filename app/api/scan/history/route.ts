import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { scanReadAccess } from "@/lib/server-scan-access"
import { parseSchoolDate, toPrismaDate, todayInSchoolTimeZone } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { requirePermission } from "@/lib/rbac-access"
import { scanMode } from "@/lib/scan"

export async function GET(request: Request) {
  try {
    await requirePermission("scan.history.read")
    const params = new URL(request.url).searchParams
    const mode = scanMode.safeParse(params.get("mode"))
    if (!mode.success) throw new ApiError(400, "Tujuan scan tidak valid")
    const { context, where } = await scanReadAccess(mode.data)
    const date = params.has("date")
      ? parseSchoolDate(params.get("date"))
      : todayInSchoolTimeZone(undefined, await readSchoolTimeZone())
    if (!date) throw new ApiError(400, "Tanggal tidak valid")
    const page = Math.min(100000, Math.max(1, Number(params.get("page")) || 1)),
      take = 30
    if (!Number.isInteger(page)) throw new ApiError(400, "Halaman tidak valid")
    const q = (params.get("q") ?? "").trim().slice(0, 100),
      classId = params.get("classId") || undefined
    const filter = {
      mode: mode.data,
      schoolDate: toPrismaDate(date),
      OR: [
        {
          student: {
            schoolClass: where,
            classId,
            ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { nis: q }, { nisn: q }] } : {}),
          },
        },
        ...(!q && !classId ? [{ studentId: null, actorId: context.user.id }] : []),
      ],
    }
    const [rows, count] = await Promise.all([
      prisma.scanEvent.findMany({
        where: filter,
        orderBy: [{ scannedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * take,
        take,
        select: {
          id: true,
          scannedAt: true,
          mode: true,
          source: true,
          outcome: true,
          className: true,
          actorName: true,
          student: { select: { name: true, nis: true } },
          visit: { select: { id: true, notifyStatus: true } },
        },
      }),
      prisma.scanEvent.count({ where: filter }),
    ])
    return NextResponse.json(
      { rows, count, page, pages: Math.max(1, Math.ceil(count / take)) },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error)
  }
}
