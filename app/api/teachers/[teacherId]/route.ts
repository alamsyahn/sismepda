import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireTeacherManager } from "@/lib/teacher-access"
import { authFailureResponse } from "@/lib/api-errors"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""))

const profileUpdate = z.object({
  employmentStatus: z.enum(["PNS", "PPPK", "HONORER"]).nullable().optional(),
  position: z.string().trim().max(100).optional(),
  teachingSince: optionalDate,
  belajarId: z.string().trim().max(254).optional(),
  subjectNames: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    await requireTeacherManager()
    const { teacherId } = await params
    const body = profileUpdate.parse(await request.json())
    const teacher = await prisma.user.findFirst({ where: { id: teacherId, ...teacherPopulationWhere() }, select: { id: true } })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    const teachingSinceValue = body.teachingSince ? parseSchoolDate(body.teachingSince) : null
    if (body.teachingSince && !teachingSinceValue) return NextResponse.json({ error: "Tanggal TMT tidak valid" }, { status: 400 })

    const teachingSince = teachingSinceValue ? toPrismaDate(teachingSinceValue) : null

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
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data guru tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Data kepegawaian gagal disimpan")
  }
}
