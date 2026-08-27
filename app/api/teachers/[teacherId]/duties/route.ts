import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireTeacherManager, teacherErrorResponse } from "@/lib/teacher-access"

const dutyCreate = z.object({
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
})

function strictDate(value?: string) {
  if (!value) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  date.setHours(0, 0, 0, 0)
  return date
}

export async function POST(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    await requireTeacherManager()
    const { teacherId } = await params
    const body = dutyCreate.parse(await request.json())
    const startDate = strictDate(body.startDate || undefined)
    if (startDate === undefined) return NextResponse.json({ error: "Tanggal mulai tugas tidak valid" }, { status: 400 })

    const teacher = await prisma.user.findFirst({ where: { id: teacherId, role: { in: ["ADMIN", "GURU"] } }, select: { id: true } })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    const created = await prisma.additionalDuty.create({
      data: { userId: teacherId, title: body.title, note: body.note || null, startDate },
      select: { id: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = teacherErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    await requireTeacherManager()
    const { teacherId } = await params
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json())
    const deleted = await prisma.additionalDuty.deleteMany({ where: { id, userId: teacherId } })
    if (deleted.count === 0) return NextResponse.json({ error: "Tugas tambahan tidak ditemukan" }, { status: 404 })
    return NextResponse.json({ id })
  } catch (error) {
    const { error: message, status } = teacherErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
