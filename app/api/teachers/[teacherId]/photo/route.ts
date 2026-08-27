import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"

export async function GET(_request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    await requireUser()
    const { teacherId } = await params
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, role: { in: ["ADMIN", "GURU"] } },
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
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Foto guru gagal dimuat" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}
