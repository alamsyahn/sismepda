import { NextResponse } from "next/server"
import { z } from "zod"
import { requirePermission } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"
import { authFailureResponse } from "@/lib/api-errors"
import { StudentAccountError } from "@/lib/student-account-service"
import { createStudentAccount, readStudentAccountRoster } from "@/lib/student-account-server"

function failure(error: unknown) {
  if (error instanceof StudentAccountError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Permintaan tidak valid. Isi siswa, email valid, dan sandi 8–128 karakter." }, { status: 400 })
  return authFailureResponse(error, "Akun siswa gagal diproses")
}

export async function GET() {
  try {
    await requirePermission("students.accounts.manage")
    return NextResponse.json(await readStudentAccountRoster(), { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })
    await requirePermission("students.accounts.manage")
    return NextResponse.json(await createStudentAccount(await request.json()), { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) { return failure(error) }
}
