import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { assertScanOrigin } from "@/lib/server-scan-access"
import { issueScanCards } from "@/lib/server-scan"

const payload = z
  .object({
    entries: z
      .array(
        z
          .object({ studentId: z.string().min(1).max(100), expectedCredentialId: z.string().max(100).nullable() })
          .strict(),
      )
      .min(1)
      .max(200),
    replace: z.boolean().default(false),
    includeExisting: z.boolean().default(false),
  })
  .strict()
export async function POST(request: Request) {
  try {
    assertScanOrigin(request)
    const context = await requirePermission("scan.cards.manage")
    await requirePermission("students.master.read")
    const body = payload.safeParse(await request.json())
    if (!body.success || new Set(body.data.entries.map((e) => e.studentId)).size !== body.data.entries.length)
      throw new ApiError(400, "Daftar kartu tidak valid")
    const cards = await issueScanCards(prisma, context.user.id, body.data.entries, body.data.replace, body.data.includeExisting)
    return NextResponse.json({ cards }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Data tidak valid" }, { status: 400 })
    return authFailureResponse(error)
  }
}
