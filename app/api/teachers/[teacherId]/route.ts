import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireTeacherManager } from "@/lib/teacher-access"
import { authFailureResponse } from "@/lib/api-errors"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"
import { recordAuditLog } from "@/lib/audit-log"
import { teacherProfileUpdateSchema } from "@/lib/teacher-schemas"

const profileUpdate = teacherProfileUpdateSchema

export async function PATCH(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    const actor = await requireTeacherManager()
    const { teacherId } = await params
    const body = profileUpdate.parse(await request.json())
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, ...teacherPopulationWhere() },
      select: {
        id: true,
        name: true,
        employmentStatus: true,
        position: true,
        teachingSince: true,
        belajarId: true,
      },
    })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    const teachingSinceValue = body.teachingSince ? parseSchoolDate(body.teachingSince) : null
    if (body.teachingSince && !teachingSinceValue) return NextResponse.json({ error: "Tanggal TMT tidak valid" }, { status: 400 })

    const teachingSince = teachingSinceValue ? toPrismaDate(teachingSinceValue) : null

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: teacherId },
        data: {
          ...(body.employmentStatus !== undefined ? { employmentStatus: body.employmentStatus } : {}),
          ...(body.position !== undefined ? { position: body.position || null } : {}),
          ...(body.teachingSince !== undefined ? { teachingSince } : {}),
          ...(body.belajarId !== undefined ? { belajarId: body.belajarId || null } : {}),
        },
        select: { employmentStatus: true, position: true, teachingSince: true, belajarId: true },
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

      // Mutasi master data guru dicatat pada trail yang sama dengan perubahan
      // identitas akun, sehingga riwayat satu guru tidak terbelah dua sistem.
      await recordAuditLog(
        {
          actorId: actor.id,
          action: "TEACHER_PROFILE_UPDATED",
          entity: "User",
          entityId: teacherId,
          targetUserId: teacherId,
          before: {
            employmentStatus: teacher.employmentStatus,
            position: teacher.position,
            teachingSince: teacher.teachingSince ? teacher.teachingSince.toISOString().slice(0, 10) : null,
            belajarId: teacher.belajarId,
          },
          after: {
            employmentStatus: updated.employmentStatus,
            position: updated.position,
            teachingSince: updated.teachingSince ? updated.teachingSince.toISOString().slice(0, 10) : null,
            belajarId: updated.belajarId,
          },
          summary: `Data kepegawaian guru ${teacher.name} diperbarui.`,
        },
        tx,
      )
    })

    return NextResponse.json({ id: teacherId })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data guru tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Data kepegawaian gagal disimpan")
  }
}
