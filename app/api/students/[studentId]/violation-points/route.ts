import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/rbac-access"
import { requireClassScopeFor } from "@/lib/rbac-class-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"

const payload = z.object({
  category: z.string().trim().min(2).max(100),
  points: z.coerce.number().int().min(1).max(100),
  note: z.string().trim().max(500).optional().transform((value) => value || null),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  try {
    // Mencatat pelanggaran adalah operasi create tersendiri; melihat profil
    // siswa saja tidak memberi kewenangan ini.
    const scope = await requireClassScopeFor("students.violations", "create")
    const user = await requireUser()
    const { studentId } = await params
    const input = payload.parse(await request.json())
    const schoolDate = parseSchoolDate(input.occurredAt)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal pelanggaran tidak valid" }, { status: 400 })
    const occurredAt = toPrismaDate(schoolDate)
    // Siswa di luar scope disembunyikan sebagai 404 agar keberadaannya tidak
    // bocor lewat perbedaan status.
    const student = await prisma.student.findFirst({ where: { id: studentId, schoolClass: scope.where }, select: { id: true } })
    if (!student) throw new ApiError(404, "Siswa tidak ditemukan atau tidak dapat diakses")
    const created = await prisma.studentViolationPoint.create({
      data: { studentId, recordedById: user.id, category: input.category, points: input.points, note: input.note, occurredAt },
      select: { id: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data poin pelanggaran tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Poin pelanggaran gagal disimpan")
  }
}