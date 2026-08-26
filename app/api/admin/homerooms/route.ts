import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { sortClasses } from "@/lib/class-order"

export async function GET() {
  try {
    await requireAdmin()
    const [classes, teachers] = await Promise.all([
      prisma.schoolClass.findMany({ orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { role: "GURU", active: true }, select: { id: true, nip: true, name: true } }),
    ])
    return NextResponse.json({ classes: sortClasses(classes), teachers })
  } catch { return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 }) }
}

export async function PUT(request: Request) {
  try {
    await requireAdmin()
    const assignments = await request.json() as Record<string, string | null>
    await prisma.$transaction(Object.entries(assignments).map(([id, homeroomUserId]) => prisma.schoolClass.update({ where: { id }, data: { homeroomUserId: homeroomUserId || null } })))
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: "Gagal menyimpan wali kelas" }, { status: 400 }) }
}
