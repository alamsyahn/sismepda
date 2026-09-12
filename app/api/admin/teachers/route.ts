import { hash } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requirePermission, requireUser } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { assertTargetNotPrivileged, teacherPopulationWhere } from "@/lib/teacher-population"
import { prisma } from "@/lib/prisma"

const optionalNip = z.string().trim().max(30).refine((value) => !value || /^\d+$/.test(value), "NIP hanya boleh berisi angka")
const optionalEmail = z.string().trim().max(254).refine(
  (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  "Format email tidak valid",
)
const optionalPhone = z.string().trim().max(20).refine(
  (value) => !value || /^\+?\d{7,15}$/.test(value),
  "Format nomor telepon tidak valid",
)

const teacherCreate = z.object({
  nip: optionalNip.optional().default(""),
  email: optionalEmail.optional().default(""),
  name: z.string().trim().min(1).max(100),
  phone: optionalPhone.optional().default(""),
  password: z.string().min(8).max(128),
}).refine((value) => Boolean(value.nip || value.email), {
  message: "NIP atau email wajib diisi",
  path: ["nip"],
})

const teacherUpdate = z.object({
  id: z.string().min(1),
  nip: optionalNip.optional(),
  email: optionalEmail.optional(),
  name: z.string().trim().min(1).max(100).optional(),
  phone: optionalPhone.optional(),
  password: z.string().min(8).max(128).optional(),
  active: z.boolean().optional(),
})

const teacherSelect = {
  id: true,
  nip: true,
  email: true,
  name: true,
  phone: true,
  active: true,
  homeroomClass: { select: { name: true } },
} as const

export async function GET() {
  try {
    await requirePermission("teachers.accounts.read")
    return NextResponse.json(await prisma.user.findMany({
      // Populasi guru berasal dari isTeacher, bukan lagi role === "GURU".
      where: teacherPopulationWhere(),
      select: teacherSelect,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }))
  } catch (error) {
    return authFailureResponse(error, "Data guru gagal dimuat")
  }
}

export async function PATCH(request: Request) {
  try {
    const body = teacherUpdate.parse(await request.json())

    // Kewenangan dipecah per jenis perubahan: menyunting data akun tidak
    // otomatis memberi hak mereset sandi/e-mail atau mengaktifkan akun.
    await requirePermission("teachers.accounts.update")
    if (body.password !== undefined || body.email !== undefined) {
      await requirePermission("accounts.credentials.manage")
    }
    if (body.active !== undefined) {
      await requirePermission("accounts.status.manage")
    }
    await assertTargetNotPrivileged(body.id)

    const existing = await prisma.user.findFirst({
      where: { id: body.id, ...teacherPopulationWhere() },
      select: { nip: true, email: true },
    })
    if (!existing) throw new ApiError(404, "Guru tidak ditemukan")
    const nip = body.nip === undefined ? existing.nip : body.nip || null
    const email = body.email === undefined ? existing.email : body.email ? body.email.toLowerCase() : null
    if (!nip && !email) {
      return NextResponse.json({ error: "Minimal salah satu NIP atau email wajib diisi" }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: body.id },
      data: {
        ...(body.nip !== undefined ? { nip } : {}),
        ...(body.email !== undefined ? { email } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.password !== undefined ? { passwordHash: await hash(body.password, 12) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
      select: teacherSelect,
    })
    return NextResponse.json(updated)
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
    if (duplicate) return NextResponse.json({ error: "NIP atau email sudah digunakan akun lain" }, { status: 409 })
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data guru tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Data guru gagal disimpan")
  }
}

const teacherDelete = z.object({ id: z.string().min(1), confirmationIdentifier: z.string().trim().min(1) })

export async function DELETE(request: Request) {
  try {
    await requirePermission("teachers.accounts.delete")
    const admin = await requireUser()
    const body = teacherDelete.parse(await request.json())
    await assertTargetNotPrivileged(body.id)

    const existing = await prisma.user.findFirst({
      where: { id: body.id, ...teacherPopulationWhere() },
      select: { nip: true, email: true },
    })
    if (!existing) throw new ApiError(404, "Guru tidak ditemukan")
    const confirmation = body.confirmationIdentifier.toLowerCase()
    if (confirmation !== existing.nip && confirmation !== existing.email?.toLowerCase()) {
      throw new ApiError(400, "Konfirmasi NIP/email tidak sesuai")
    }

    const reassignedSubmissions = await prisma.$transaction(async (tx) => {
      await tx.schoolClass.updateMany({ where: { homeroomUserId: body.id }, data: { homeroomUserId: null } })
      const result = await tx.attendanceDay.updateMany({ where: { submittedById: body.id }, data: { submittedById: admin.id } })
      await tx.user.delete({ where: { id: body.id } })
      return result.count
    })
    return NextResponse.json({ id: body.id, reassignedSubmissions })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data hapus tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Guru gagal dihapus permanen")
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("teachers.accounts.create")
    // Membuat akun berarti menetapkan kredensial awal.
    await requirePermission("accounts.credentials.manage")
    const body = await request.json()
    const rows = z.array(teacherCreate).parse(Array.isArray(body) ? body : [body])
    const prepared = await Promise.all(rows.map(async (row) => ({
      nip: row.nip || null,
      email: row.email ? row.email.toLowerCase() : null,
      name: row.name,
      phone: row.phone || null,
      passwordHash: await hash(row.password, 12),
      role: "GURU" as const,
      // Identitas bisnis baru: akun guru yang dibuat lewat layar ini memang
      // record guru. Kolom legacy tetap diisi sampai fase kontraksi.
      isTeacher: true,
    })))
    await prisma.$transaction(prepared.map((data) => prisma.user.create({ data })))
    return NextResponse.json({ count: prepared.length }, { status: 201 })
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
    if (duplicate) return NextResponse.json({ error: "NIP atau email sudah terdaftar" }, { status: 409 })
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data guru tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Guru gagal dibuat")
  }
}
