import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { sortClasses } from "@/lib/class-order"

const optionalNis = z.string().trim().max(30).regex(/^\d+$/).or(z.literal("")).transform((value) => value || null)
const optionalNisn = z.string().trim().regex(/^\d{10}$/).or(z.literal("")).transform((value) => value || null)

const identifiers = z.object({ nis: optionalNis, nisn: optionalNisn }).refine(
  (value) => value.nis !== null || value.nisn !== null,
  { message: "Minimal salah satu NIS atau NISN wajib diisi" },
)

const student = z.object({
  nis: optionalNis.default(""),
  nisn: optionalNisn.default(""),
  name: z.string().trim().min(1),
  className: z.string().min(1),
}).refine((value) => value.nis !== null || value.nisn !== null, {
  message: "Minimal salah satu NIS atau NISN wajib diisi",
})

const csvImport = z.object({
  behavior: z.enum(["skip", "update"]),
  rows: z.array(student).min(1).max(10000),
})

function isDuplicateError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
}

function studentResponse(studentData: {
  id: string
  nis: string | null
  nisn: string | null
  name: string
  active: boolean
  schoolClass: { name: string }
}) {
  const { schoolClass, ...item } = studentData
  return { ...item, className: schoolClass.name }
}

export async function GET() {
  try {
    await requireAdmin()
    const [classes, students] = await Promise.all([
      prisma.schoolClass.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
      prisma.student.findMany({
        select: { id: true, nis: true, nisn: true, name: true, active: true, schoolClass: { select: { name: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
    ])
    return NextResponse.json({
      classes: sortClasses(classes).map((item) => item.name),
      students: students.map(studentResponse),
    })
  } catch {
    return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
  }
}

const studentUpdate = z.object({
  id: z.string().min(1),
  nis: optionalNis.optional(),
  nisn: optionalNisn.optional(),
  name: z.string().trim().min(1).optional(),
  className: z.string().min(1).optional(),
  active: z.boolean().optional(),
})

export async function PATCH(request: Request) {
  try {
    await requireAdmin()
    const body = studentUpdate.parse(await request.json())
    const existing = await prisma.student.findUnique({ where: { id: body.id }, select: { nis: true, nisn: true } })
    if (!existing) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 })
    identifiers.parse({ nis: body.nis === undefined ? existing.nis ?? "" : body.nis ?? "", nisn: body.nisn === undefined ? existing.nisn ?? "" : body.nisn ?? "" })

    const schoolClass = body.className
      ? await prisma.schoolClass.findUnique({ where: { name: body.className }, select: { id: true } })
      : null
    if (body.className && !schoolClass) return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 400 })

    const updated = await prisma.student.update({
      where: { id: body.id },
      data: {
        ...(body.nis !== undefined ? { nis: body.nis } : {}),
        ...(body.nisn !== undefined ? { nisn: body.nisn } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(schoolClass ? { classId: schoolClass.id } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
      include: { schoolClass: { select: { name: true } } },
    })
    return NextResponse.json(studentResponse(updated))
  } catch (error) {
    const duplicate = isDuplicateError(error)
    return NextResponse.json(
      { error: duplicate ? "NIS atau NISN sudah digunakan siswa lain" : "Data siswa tidak valid" },
      { status: duplicate ? 409 : 400 },
    )
  }
}

const studentDelete = z.object({ id: z.string().min(1), confirmationIdentifier: z.string().min(1) })

export async function DELETE(request: Request) {
  try {
    await requireAdmin()
    const body = studentDelete.parse(await request.json())
    const existing = await prisma.student.findUnique({ where: { id: body.id }, select: { nis: true, nisn: true } })
    if (!existing) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 })
    const expectedIdentifier = existing.nis ?? existing.nisn
    if (expectedIdentifier !== body.confirmationIdentifier) {
      return NextResponse.json({ error: "Konfirmasi identitas siswa tidak sesuai" }, { status: 400 })
    }
    const deletedAttendances = await prisma.$transaction(async (tx) => {
      const result = await tx.attendance.deleteMany({ where: { studentId: body.id } })
      await tx.student.delete({ where: { id: body.id } })
      return result.count
    })
    return NextResponse.json({ id: body.id, deletedAttendances })
  } catch {
    return NextResponse.json({ error: "Siswa gagal dihapus permanen" }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const body = await request.json()
    const parsedImport = csvImport.safeParse(body)
    if (parsedImport.success) {
      const result = await prisma.$transaction(async (tx) => {
        const classNames = [...new Set(parsedImport.data.rows.map((row) => row.className))]
        const [classes, existingStudents] = await Promise.all([
          tx.schoolClass.findMany({ where: { name: { in: classNames } }, select: { id: true, name: true } }),
          tx.student.findMany({ select: { id: true, nis: true, nisn: true, name: true } }),
        ])
        const classByName = new Map(classes.map((item) => [item.name, item.id]))
        if (classes.length !== classNames.length) throw new Error("CLASS_NOT_FOUND")

        const byNis = new Map(existingStudents.filter((item) => item.nis).map((item) => [item.nis as string, item]))
        const byNisn = new Map(existingStudents.filter((item) => item.nisn).map((item) => [item.nisn as string, item]))
        let added = 0
        let updated = 0
        let skipped = 0

        for (const row of parsedImport.data.rows) {
          const nisnMatch = row.nisn ? byNisn.get(row.nisn) : undefined
          const nisMatch = row.nis ? byNis.get(row.nis) : undefined
          if (nisnMatch && nisMatch && nisnMatch.id !== nisMatch.id) {
            throw new Error("IDENTIFIER_CONFLICT")
          }

          const target = nisnMatch ?? nisMatch
          if (target && parsedImport.data.behavior === "skip") {
            skipped += 1
            continue
          }

          const classId = classByName.get(row.className)
          if (!classId) throw new Error("CLASS_NOT_FOUND")
          if (target) {
            const next = await tx.student.update({
              where: { id: target.id },
              data: {
                name: row.name,
                classId,
                ...(row.nis ? { nis: row.nis } : {}),
                ...(row.nisn ? { nisn: row.nisn } : {}),
              },
              select: { id: true, nis: true, nisn: true, name: true },
            })
            if (target.nis && target.nis !== next.nis) byNis.delete(target.nis)
            if (target.nisn && target.nisn !== next.nisn) byNisn.delete(target.nisn)
            if (next.nis) byNis.set(next.nis, next)
            if (next.nisn) byNisn.set(next.nisn, next)
            updated += 1
          } else {
            const created = await tx.student.create({
              data: { nis: row.nis, nisn: row.nisn, name: row.name, classId },
              select: { id: true, nis: true, nisn: true, name: true },
            })
            if (created.nis) byNis.set(created.nis, created)
            if (created.nisn) byNisn.set(created.nisn, created)
            added += 1
          }
        }
        return { added, updated, skipped }
      })
      return NextResponse.json(result, { status: 201 })
    }

    const rows = z.array(student).parse(Array.isArray(body) ? body : [body])
    let count = 0
    for (const row of rows) {
      const cls = await prisma.schoolClass.findUnique({ where: { name: row.className } })
      if (!cls) throw new Error("Kelas tidak ditemukan")
      await prisma.student.create({ data: { nis: row.nis, nisn: row.nisn, name: row.name, classId: cls.id } })
      count += 1
    }
    return NextResponse.json({ count }, { status: 201 })
  } catch (error) {
    const duplicate = isDuplicateError(error)
    const conflict = error instanceof Error && error.message === "IDENTIFIER_CONFLICT"
    return NextResponse.json(
      { error: conflict ? "NIS dan NISN mengarah ke dua siswa yang berbeda" : duplicate ? "NIS atau NISN sudah terdaftar" : "Data siswa tidak valid" },
      { status: duplicate || conflict ? 409 : 400 },
    )
  }
}
