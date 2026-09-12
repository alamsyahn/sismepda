import { NextResponse } from "next/server"
import { z } from "zod"
import { requirePermission } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { sortClasses } from "@/lib/class-order"
import { fromPrismaDate, parseSchoolDate, toPrismaDate } from "@/lib/school-date"

/** Ubah YYYY-MM-DD menjadi Date kolom @db.Date, atau null bila dikosongkan. */
function toBirthDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const parsed = parseSchoolDate(value)
  if (!parsed) throw new Error("INVALID_BIRTH_DATE")
  return toPrismaDate(parsed)
}

const optionalNis = z.string().trim().max(30).regex(/^\d+$/).or(z.literal("")).transform((value) => value || null)
const optionalNisn = z.string().trim().regex(/^\d{10}$/).or(z.literal("")).transform((value) => value || null)

// Keduanya opsional dan nullable: siswa lama belum punya data ini.
const optionalBirthDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(""))
  .nullable()
  .transform((value) => value || null)
const optionalGender = z.enum(["LAKI_LAKI", "PEREMPUAN"]).or(z.literal("")).nullable().transform((value) => value || null)

const identifiers = z.object({ nis: optionalNis, nisn: optionalNisn }).refine(
  (value) => value.nis !== null || value.nisn !== null,
  { message: "Minimal salah satu NIS atau NISN wajib diisi" },
)

const student = z.object({
  nis: optionalNis.default(""),
  nisn: optionalNisn.default(""),
  name: z.string().trim().min(1),
  className: z.string().min(1),
  birthDate: optionalBirthDate.optional().default(null),
  gender: optionalGender.optional().default(null),
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
  birthDate?: Date | null
  gender?: "LAKI_LAKI" | "PEREMPUAN" | null
  schoolClass: { name: string }
}) {
  const { schoolClass, birthDate, ...item } = studentData
  return {
    ...item,
    // Kirim sebagai YYYY-MM-DD agar cocok dengan input type="date".
    birthDate: birthDate ? fromPrismaDate(birthDate) : null,
    className: schoolClass.name,
  }
}

export async function GET() {
  try {
    await requirePermission("students.master.read")
    const [classes, students] = await Promise.all([
      prisma.schoolClass.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
      prisma.student.findMany({
        select: { id: true, nis: true, nisn: true, name: true, active: true, birthDate: true, gender: true, schoolClass: { select: { name: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
    ])
    return NextResponse.json({
      classes: sortClasses(classes).map((item) => item.name),
      students: students.map(studentResponse),
    })
  } catch (error) {
    return authFailureResponse(error, "Data siswa gagal dimuat")
  }
}

const studentUpdate = z.object({
  id: z.string().min(1),
  nis: optionalNis.optional(),
  nisn: optionalNisn.optional(),
  name: z.string().trim().min(1).optional(),
  className: z.string().min(1).optional(),
  active: z.boolean().optional(),
  birthDate: optionalBirthDate.optional(),
  gender: optionalGender.optional(),
})

export async function PATCH(request: Request) {
  try {
    await requirePermission("students.master.update")
    const body = studentUpdate.parse(await request.json())
    const existing = await prisma.student.findUnique({ where: { id: body.id }, select: { nis: true, nisn: true } })
    if (!existing) throw new ApiError(404, "Siswa tidak ditemukan")
    identifiers.parse({ nis: body.nis === undefined ? existing.nis ?? "" : body.nis ?? "", nisn: body.nisn === undefined ? existing.nisn ?? "" : body.nisn ?? "" })

    const schoolClass = body.className
      ? await prisma.schoolClass.findUnique({ where: { name: body.className }, select: { id: true } })
      : null
    if (body.className && !schoolClass) throw new ApiError(400, "Kelas tidak ditemukan")

    const updated = await prisma.student.update({
      where: { id: body.id },
      data: {
        ...(body.nis !== undefined ? { nis: body.nis } : {}),
        ...(body.nisn !== undefined ? { nisn: body.nisn } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(schoolClass ? { classId: schoolClass.id } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.birthDate !== undefined ? { birthDate: toBirthDate(body.birthDate) } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
      },
      include: { schoolClass: { select: { name: true } } },
    })
    return NextResponse.json(studentResponse(updated))
  } catch (error) {
    if (isDuplicateError(error)) return NextResponse.json({ error: "NIS atau NISN sudah digunakan siswa lain" }, { status: 409 })
    if (error instanceof Error && error.message === "INVALID_BIRTH_DATE") return NextResponse.json({ error: "Tanggal lahir tidak valid" }, { status: 400 })
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data siswa tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Data siswa gagal disimpan")
  }
}

const studentDelete = z.object({ id: z.string().min(1), confirmationIdentifier: z.string().min(1) })

export async function DELETE(request: Request) {
  try {
    await requirePermission("students.master.delete")
    const body = studentDelete.parse(await request.json())
    const existing = await prisma.student.findUnique({ where: { id: body.id }, select: { nis: true, nisn: true } })
    if (!existing) throw new ApiError(404, "Siswa tidak ditemukan")
    const expectedIdentifier = existing.nis ?? existing.nisn
    if (expectedIdentifier !== body.confirmationIdentifier) {
      throw new ApiError(400, "Konfirmasi identitas siswa tidak sesuai")
    }
    const deletedAttendances = await prisma.$transaction(async (tx) => {
      const result = await tx.attendance.deleteMany({ where: { studentId: body.id } })
      await tx.student.delete({ where: { id: body.id } })
      return result.count
    })
    return NextResponse.json({ id: body.id, deletedAttendances })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data hapus tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Siswa gagal dihapus permanen")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsedImport = csvImport.safeParse(body)
    // Impor massal dan penambahan satuan adalah dua kewenangan berbeda: impor
    // menulis banyak baris sekaligus dan dapat menimpa data yang sudah ada.
    if (parsedImport.success) {
      await requirePermission("students.master.import")
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
                // Kolom kosong pada CSV tidak menimpa data yang sudah ada.
                ...(row.birthDate ? { birthDate: toBirthDate(row.birthDate) } : {}),
                ...(row.gender ? { gender: row.gender } : {}),
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
              data: {
                nis: row.nis,
                nisn: row.nisn,
                name: row.name,
                classId,
                birthDate: toBirthDate(row.birthDate) ?? null,
                gender: row.gender,
              },
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

    await requirePermission("students.master.create")
    const rows = z.array(student).parse(Array.isArray(body) ? body : [body])
    let count = 0
    for (const row of rows) {
      const cls = await prisma.schoolClass.findUnique({ where: { name: row.className } })
      if (!cls) throw new Error("Kelas tidak ditemukan")
      await prisma.student.create({
        data: {
          nis: row.nis,
          nisn: row.nisn,
          name: row.name,
          classId: cls.id,
          birthDate: toBirthDate(row.birthDate) ?? null,
          gender: row.gender,
        },
      })
      count += 1
    }
    return NextResponse.json({ count }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "IDENTIFIER_CONFLICT") {
      return NextResponse.json({ error: "NIS dan NISN mengarah ke dua siswa yang berbeda" }, { status: 409 })
    }
    if (isDuplicateError(error)) return NextResponse.json({ error: "NIS atau NISN sudah terdaftar" }, { status: 409 })
    if (error instanceof Error && error.message === "INVALID_BIRTH_DATE") return NextResponse.json({ error: "Tanggal lahir tidak valid" }, { status: 400 })
    if (error instanceof Error && error.message === "CLASS_NOT_FOUND") return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 400 })
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data siswa tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Data siswa gagal disimpan")
  }
}
