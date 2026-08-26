import { hash } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-guards"
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
    await requireAdmin()
    return NextResponse.json(await prisma.user.findMany({
      where: { role: "GURU" },
      select: teacherSelect,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }))
  } catch {
    return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin()
    const body = teacherUpdate.parse(await request.json())
    const existing = await prisma.user.findFirstOrThrow({
      where: { id: body.id, role: "GURU" },
      select: { nip: true, email: true },
    })
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
    return NextResponse.json(
      { error: duplicate ? "NIP atau email sudah digunakan akun lain" : "Data guru tidak valid" },
      { status: duplicate ? 409 : 400 },
    )
  }
}

const teacherDelete = z.object({ id: z.string().min(1), confirmationIdentifier: z.string().trim().min(1) })

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin()
    const body = teacherDelete.parse(await request.json())
    const existing = await prisma.user.findUnique({
      where: { id: body.id },
      select: { nip: true, email: true, role: true },
    })
    if (!existing || existing.role !== "GURU") {
      return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })
    }
    const confirmation = body.confirmationIdentifier.toLowerCase()
    if (confirmation !== existing.nip && confirmation !== existing.email?.toLowerCase()) {
      return NextResponse.json({ error: "Konfirmasi NIP/email tidak sesuai" }, { status: 400 })
    }

    const reassignedSubmissions = await prisma.$transaction(async (tx) => {
      await tx.schoolClass.updateMany({ where: { homeroomUserId: body.id }, data: { homeroomUserId: null } })
      const result = await tx.attendanceDay.updateMany({ where: { submittedById: body.id }, data: { submittedById: admin.id } })
      await tx.user.delete({ where: { id: body.id } })
      return result.count
    })
    return NextResponse.json({ id: body.id, reassignedSubmissions })
  } catch {
    return NextResponse.json({ error: "Guru gagal dihapus permanen" }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const body = await request.json()
    const rows = z.array(teacherCreate).parse(Array.isArray(body) ? body : [body])
    const prepared = await Promise.all(rows.map(async (row) => ({
      nip: row.nip || null,
      email: row.email ? row.email.toLowerCase() : null,
      name: row.name,
      phone: row.phone || null,
      passwordHash: await hash(row.password, 12),
      role: "GURU" as const,
    })))
    await prisma.$transaction(prepared.map((data) => prisma.user.create({ data })))
    return NextResponse.json({ count: prepared.length }, { status: 201 })
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
    return NextResponse.json(
      { error: duplicate ? "NIP atau email sudah terdaftar" : "Data guru tidak valid" },
      { status: duplicate ? 409 : 400 },
    )
  }
}
