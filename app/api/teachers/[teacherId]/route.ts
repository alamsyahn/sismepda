import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireTeacherManager, teacherErrorResponse } from "@/lib/teacher-access"

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""))

const profileUpdate = z.object({
  employmentStatus: z.enum(["PNS", "PPPK", "HONORER"]).nullable().optional(),
  position: z.string().trim().max(100).optional(),
  teachingSince: optionalDate,
  belajarId: z.string().trim().max(254).optional(),
  subjectNames: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
})

function strictDate(value?: string) {
  if (!value) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  date.setHours(0, 0, 0, 0)
  return date
}

export async function PATCH(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    await requireTeacherManager()
    const { teacherId } = await params
    const body = profileUpdate.parse(await request.json())
    const teacher = await prisma.user.findFirst({ where: { id: teacherId, role: { in: ["ADMIN", "GURU"] } }, select: { id: true } })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    const teachingSince = strictDate(body.teachingSince || undefined)
    if (teachingSince === undefined) return NextResponse.json({ error: "Tanggal TMT tidak valid" }, { status: 400 })

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: teacherId },
        data: {
          ...(body.employmentStatus !== undefined ? { employmentStatus: body.employmentStatus } : {}),
          ...(body.position !== undefined ? { position: body.position || null } : {}),
          ...(body.teachingSince !== undefined ? { teachingSince } : {}),
          ...(body.belajarId !== undefined ? { belajarId: body.belajarId || null } : {}),
        },
      })

      if (body.subjectNames) {
        const names = [...new Set(body.subjectNames.map((name) => name.trim()).filter(Boolean))]
        const subjects = await Promise.all(
          names.map((name) =>
            tx.subject.upsert({ where: { name }, update: {}, create: { name }, select: { id: true } }),
          ),
        )
        await tx.teacherSubject.deleteMany({ where: { userId: teacherId } })
        if (subjects.length > 0) {
          await tx.teacherSubject.createMany({
            data: subjects.map((subject) => ({ userId: teacherId, subjectId: subject.id })),
          })
        }
      }
    })

    return NextResponse.json({ id: teacherId })
  } catch (error) {
    const { error: message, status } = teacherErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
