import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { teacherPopulationWhere } from "@/lib/teacher-population"

export async function GET(_request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    // Foto adalah bagian direktori guru, dijaga permission yang sama.
    await requirePermission("teachers.directory.read")
    const { teacherId } = await params
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, ...teacherPopulationWhere() },
      select: { photoData: true, photoMimeType: true },
    })
    if (!teacher?.photoData || !teacher.photoMimeType) {
      return NextResponse.json({ error: "Foto guru belum tersedia" }, { status: 404 })
    }
    return new Response(teacher.photoData, {
      headers: {
        "Content-Type": teacher.photoMimeType,
        "Content-Length": String(teacher.photoData.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return authFailureResponse(error, "Foto guru gagal dimuat")
  }
}
