import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { bosErrorResponse, requireBosPermission } from "@/lib/bos-access"
import { formatRupiah } from "@/lib/bos"

const payload = z.object({
  // Rupiah, max 14 digits total with 2 decimals in the column.
  initialBudget: z.coerce.number().min(0).max(999_999_999_999),
})

/** Update anggaran awal BOS. Requires bos.edit. */
export async function PATCH(request: Request) {
  try {
    const viewer = await requireBosPermission("bos.edit")
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
          actorId: viewer.id,
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
    const { error: message, status } = bosErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
