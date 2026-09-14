import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { resolveMedia } from "@/lib/server-media"

export async function GET(_request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    // Foto adalah bagian direktori guru, dijaga permission yang sama.
    await requirePermission("teachers.directory.read")
    const { teacherId } = await params
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, ...teacherPopulationWhere() },
      select: { photoKey: true, photoData: true, photoMimeType: true },
    })
    // Foto guru dibaca lewat resolver yang sama dengan foto profil: kunci baru
    // jika ada, byte legacy bila belum dimigrasikan.
    const media = teacher
      ? await resolveMedia({
          key: teacher.photoKey,
          mimeType: teacher.photoMimeType,
          legacyBytes: teacher.photoData,
        })
      : null
    if (!media) {
      return NextResponse.json({ error: "Foto guru belum tersedia" }, { status: 404 })
    }
    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return authFailureResponse(error, "Foto guru gagal dimuat")
  }
}
