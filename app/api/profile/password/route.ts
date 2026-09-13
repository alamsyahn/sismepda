import { compare, hash } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { passwordUpdateSchema } from "@/lib/account-schemas"
import { prisma } from "@/lib/prisma"
import { requireUser, UnauthorizedError } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"

export async function PATCH(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    const sessionUser = await requireUser()
    const body = passwordUpdateSchema.parse(await request.json())
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      select: { passwordHash: true },
    })
    if (!(await compare(body.currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Password saat ini tidak sesuai" }, { status: 400 })
    }
    if (await compare(body.newPassword, user.passwordHash)) {
      return NextResponse.json({ error: "Password baru harus berbeda dari password saat ini" }, { status: 400 })
    }
    await prisma.user.update({
      where: { id: sessionUser.id },
      data: { passwordHash: await hash(body.newPassword, 12) },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Password baru minimal 8 karakter" }, { status: 400 })
    }
    return NextResponse.json({ error: "Password gagal diperbarui" }, { status: 500 })
  }
}
