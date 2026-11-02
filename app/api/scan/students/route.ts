import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { requireAnyPermission, requirePermission } from "@/lib/rbac-access"
import { SCAN_PAGE_PERMISSIONS } from "@/lib/scan"
import { scanWriteAccess } from "@/lib/server-scan-access"
import { projectScanStudent } from "@/lib/server-scan"
import { sortClasses } from "@/lib/class-order"

export async function GET(request: Request) {
  try {
    await requireAnyPermission(SCAN_PAGE_PERMISSIONS)
    const params = new URL(request.url).searchParams,
      mode = params.get("mode")
    if (!["attendance", "uks", "cards"].includes(mode ?? "")) throw new ApiError(400, "Tujuan scan tidak valid")
    let scope: { homeroomUserId?: string } = {}
    if (mode === "cards") {
      await requirePermission("scan.cards.manage")
      await requirePermission("students.master.read")
    } else scope = (await scanWriteAccess(mode as "attendance" | "uks")).where
    const q = (params.get("q") ?? "").trim().slice(0, 100),
      classId = params.get("classId") || undefined
    const classes = sortClasses(
      await prisma.schoolClass.findMany({ where: scope, select: { id: true, name: true, grade: true } }),
    )
    const students = (mode === "cards" ? Boolean(classId) : q.length >= 2)
      ? await prisma.student.findMany({
          where: {
            active: true,
            classId,
            schoolClass: scope,
            ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { nis: q }, { nisn: q }] } : {}),
          },
          take: mode === "cards" ? 200 : 20,
          orderBy: { name: "asc" },
          include: {
            schoolClass: {
              select: { name: true, homeroomUser: { select: { name: true, phone: true, active: true } } },
            },
            ...(mode === "cards"
              ? { scanCredentials: { where: { revokedAt: null }, select: { id: true }, take: 1 } }
              : {}),
          },
        })
      : []
    return NextResponse.json(
      {
        classes,
        students: students.map((s) => ({
          ...projectScanStudent(s),
          ...(mode === "cards" ? { credentialId: s.scanCredentials?.[0]?.id ?? null } : {}),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error)
  }
}
