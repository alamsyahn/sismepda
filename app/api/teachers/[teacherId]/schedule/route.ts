import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireTeacherManager, teacherErrorResponse } from "@/lib/teacher-access"
import { teacherPopulationWhere } from "@/lib/teacher-population"

const scheduleCreate = z.object({
  className: z.string().trim().min(1),
  subjectName: z.string().trim().min(1).max(80),
  day: z.coerce.number().int().min(1).max(6),
  periodStart: z.coerce.number().int().min(1).max(12),
  periodEnd: z.coerce.number().int().min(1).max(12),
})

export async function POST(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    await requireTeacherManager()
    const { teacherId } = await params
    const body = scheduleCreate.parse(await request.json())
    if (body.periodEnd < body.periodStart) {
      return NextResponse.json({ error: "Jam selesai tidak boleh lebih kecil dari jam mulai" }, { status: 400 })
    }

    const [teacher, schoolClass] = await Promise.all([
      prisma.user.findFirst({ where: { id: teacherId, ...teacherPopulationWhere() }, select: { id: true } }),
      prisma.schoolClass.findUnique({ where: { name: body.className }, select: { id: true } }),
    ])
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })
    if (!schoolClass) return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 400 })

    const overlap = await prisma.teachingAssignment.findFirst({
      where: {
        userId: teacherId,
        day: body.day,
        periodStart: { lte: body.periodEnd },
        periodEnd: { gte: body.periodStart },
      },
      select: { id: true },
    })
    if (overlap) return NextResponse.json({ error: "Jadwal bentrok dengan jadwal guru yang sudah ada" }, { status: 409 })

    const subject = await prisma.subject.upsert({
      where: { name: body.subjectName },
      update: {},
      create: { name: body.subjectName },
      select: { id: true },
    })

    const created = await prisma.teachingAssignment.create({
      data: {
        userId: teacherId,
        classId: schoolClass.id,
        subjectId: subject.id,
        day: body.day,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
      },
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
    const deleted = await prisma.teachingAssignment.deleteMany({ where: { id, userId: teacherId } })
    if (deleted.count === 0) return NextResponse.json({ error: "Jadwal tidak ditemukan" }, { status: 404 })
    return NextResponse.json({ id })
  } catch (error) {
    const { error: message, status } = teacherErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
