import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth-guards"
import { getClassAccess } from "@/lib/class-access"
import { prisma } from "@/lib/prisma"

const payload = z.object({
  category: z.string().trim().min(2).max(100),
  points: z.coerce.number().int().min(1).max(100),
  note: z.string().trim().max(500).optional().transform((value) => value || null),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

function strictDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  date.setHours(0, 0, 0, 0)
  return date
}

export async function POST(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  try {
    const user = await requireUser()
    const access = await getClassAccess(user)
    const { studentId } = await params
    const input = payload.parse(await request.json())
    const occurredAt = strictDate(input.occurredAt)
    if (!occurredAt) return NextResponse.json({ error: "Tanggal pelanggaran tidak valid" }, { status: 400 })
    const student = await prisma.student.findFirst({ where: { id: studentId, schoolClass: access.where }, select: { id: true } })
    if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan atau tidak dapat diakses" }, { status: 404 })
    const created = await prisma.studentViolationPoint.create({
      data: { studentId, recordedById: user.id, category: input.category, points: input.points, note: input.note, occurredAt },
      select: { id: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data poin pelanggaran tidak valid" }, { status: 400 })
    return NextResponse.json({ error: "Poin pelanggaran gagal disimpan" }, { status: 500 })
  }
}