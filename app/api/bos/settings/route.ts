import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { formatRupiah } from "@/lib/bos"

const payload = z.object({
  // Rupiah, max 14 digits total with 2 decimals in the column.
  initialBudget: z.coerce.number().min(0).max(999_999_999_999),
})

/** Update anggaran awal BOS. Requires bos.edit. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requirePermission("bos.budget.update")
    const body = payload.parse(await request.json())

    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.bosSetting.findUnique({
        where: { id: "default" },
        select: { initialBudget: true },
      })
      const result = await tx.bosSetting.upsert({
        where: { id: "default" },
        update: { initialBudget: body.initialBudget },
        create: { id: "default", initialBudget: body.initialBudget },
        select: { initialBudget: true },
      })
      const previous = before?.initialBudget == null ? null : Number(before.initialBudget.toString())

      await recordAuditLog(
        {
          actorId: viewer.user.id,
          action: "BOS_BUDGET_UPDATED",
          entity: "BosSetting",
          entityId: "default",
          summary: `Anggaran awal BOS diubah menjadi ${formatRupiah(body.initialBudget)}`,
          before: { initialBudget: previous },
          after: { initialBudget: body.initialBudget },
        },
        tx,
      )

      return result
    })

    return NextResponse.json({
      initialBudget: updated.initialBudget == null ? null : Number(updated.initialBudget.toString()),
    })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Anggaran tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Anggaran BOS gagal diperbarui")
  }
}
