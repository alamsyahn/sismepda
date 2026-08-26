import { compare } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { profilePhotoUrl } from "@/lib/profile"

const profileUpdate = z.object({
  name: z.string().trim().min(1).max(100),
  nip: z.union([z.literal(""), z.string().trim().max(30).regex(/^\d+$/)]),
  email: z.union([z.literal(""), z.string().trim().max(254).email()]),
  phone: z.union([z.literal(""), z.string().trim().max(20).regex(/^\+?\d{7,15}$/)]),
  currentPassword: z.string().max(128).optional(),
})

const profileSelect = {
  id: true,
  name: true,
  nip: true,
  email: true,
  phone: true,
  role: true,
  photoUpdatedAt: true,
} as const

function serializeProfile(user: {
  id: string
  name: string
  nip: string | null
  email: string | null
  phone: string | null
  role: "ADMIN" | "GURU"
  photoUpdatedAt: Date | null
}) {
  return {
    id: user.id,
    name: user.name,
    nip: user.nip,
    email: user.email,
    phone: user.phone,
    role: user.role,
    photoUrl: profilePhotoUrl(user.photoUpdatedAt),
  }
}

export async function GET() {
  try {
    const sessionUser = await requireUser()
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id }, select: profileSelect })
    return NextResponse.json(serializeProfile(user))
  } catch {
    return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
  }
}

export async function PATCH(request: Request) {
  try {
    const sessionUser = await requireUser()
    const body = profileUpdate.parse(await request.json())
    const existing = await prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      select: { ...profileSelect, passwordHash: true },
    })

    const email = body.email ? body.email.toLowerCase() : null
    const nip = body.nip || null
    const phone = body.phone || null

    const identifierChanged = email !== existing.email?.toLowerCase() || nip !== existing.nip
    if (!email && !nip) {
      return NextResponse.json(
        { error: "Minimal salah satu NIP atau email wajib diisi", code: "IDENTIFIER_REQUIRED" },
        { status: 400 },
      )
    }
    if (identifierChanged) {
      if (!body.currentPassword) {
        return NextResponse.json(
          { error: "Masukkan password saat ini untuk mengubah email atau NIP", code: "CURRENT_PASSWORD_REQUIRED" },
          { status: 400 },
        )
      }
      if (!(await compare(body.currentPassword, existing.passwordHash))) {
        return NextResponse.json({ error: "Password saat ini tidak sesuai", code: "CURRENT_PASSWORD_INVALID" }, { status: 400 })
      }
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { name: body.name.replace(/\s+/g, " "), email, nip, phone },
      select: profileSelect,
    })
    return NextResponse.json(serializeProfile(updated))
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data profil tidak valid", code: "INVALID_DATA" }, { status: 400 })
    }
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
    if (duplicate) {
      return NextResponse.json(
        { error: "Email atau NIP sudah digunakan akun lain", code: "IDENTIFIER_TAKEN" },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: "Profil gagal diperbarui" }, { status: 500 })
  }
}
