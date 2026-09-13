import { compare } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { ownProfileUpdateSchema } from "@/lib/account-schemas"
import { prisma } from "@/lib/prisma"
import { profilePhotoUrl } from "@/lib/profile"
import { requireUser, UnauthorizedError } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"

const profileSelect = {
  id: true,
  name: true,
  nip: true,
  email: true,
  phone: true,
  photoUpdatedAt: true,
  rbacRoles: { select: { role: { select: { name: true } } } },
} as const

function serializeProfile(user: {
  id: string
  name: string
  nip: string | null
  email: string | null
  phone: string | null
  photoUpdatedAt: Date | null
  rbacRoles: readonly { role: { name: string } }[]
}) {
  return {
    id: user.id,
    name: user.name,
    nip: user.nip,
    email: user.email,
    phone: user.phone,
    // Nama role bersifat informatif untuk UI. Otorisasi tidak pernah
    // memeriksa nama tampilan, dan klien tidak dapat mengubahnya lewat sini.
    roleNames: user.rbacRoles.map((entry) => entry.role.name),
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
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    const sessionUser = await requireUser()
    const body = ownProfileUpdateSchema.parse(await request.json())
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
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
    }
    if (error instanceof z.ZodError) {
      // Termasuk penolakan field otorisasi yang disuntikkan: skema `.strict()`
      // menggagalkan seluruh mutasi alih-alih membuang field itu diam-diam.
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
