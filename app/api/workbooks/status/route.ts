import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requireWorkbookSupervisor } from "@/lib/workbook-access"
import { authFailureResponse } from "@/lib/api-errors"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { statusLabels } from "@/lib/workbook"

const payload = z.object({
  teacherId: z.string().min(1),
  workbookItemId: z.string().min(1),
  status: z.enum(["UNREVIEWED", "PRESENT", "MISSING"]),
})

/** Only supervisors may change a checklist item. Authorization is server-side. */
export async function PATCH(request: Request) {
  try {
    const supervisor = await requireWorkbookSupervisor()
    const body = payload.parse(await request.json())

    const [teacher, item] = await Promise.all([
      prisma.user.findFirst({
        where: { id: body.teacherId, ...teacherPopulationWhere() },
        select: { id: true, name: true },
      }),
      prisma.workbookItem.findUnique({
        where: { id: body.workbookItemId },
        select: { id: true, name: true, workbook: { select: { name: true } } },
      }),
    ])
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })
    if (!item) return NextResponse.json({ error: "Komponen Buku Kerja tidak ditemukan" }, { status: 404 })

    const existing = await prisma.teacherWorkbookItemStatus.findUnique({
      where: { userId_workbookItemId: { userId: teacher.id, workbookItemId: item.id } },
      select: { status: true },
    })
    const before = existing?.status ?? "UNREVIEWED"
    const reviewedAt = new Date()

    const saved = await prisma.$transaction(async (tx) => {
      const record = await tx.teacherWorkbookItemStatus.upsert({
        where: { userId_workbookItemId: { userId: teacher.id, workbookItemId: item.id } },
        update: { status: body.status, reviewedById: supervisor.id, reviewedAt },
        create: {
          userId: teacher.id,
          workbookItemId: item.id,
          status: body.status,
          reviewedById: supervisor.id,
          reviewedAt,
        },
        select: { id: true, status: true, reviewedAt: true },
      })

      if (before !== body.status) {
        await recordAuditLog(
          {
            actorId: supervisor.id,
            action: "WORKBOOK_ITEM_STATUS_CHANGED",
            entity: "TeacherWorkbookItemStatus",
            entityId: record.id,
            targetUserId: teacher.id,
            summary: `${item.workbook.name} — ${item.name}: ${statusLabels[before]} → ${statusLabels[body.status]}`,
            before: { status: before },
            after: { status: body.status },
          },
          tx,
        )
      }

      return record
    })

    return NextResponse.json({
      workbookItemId: item.id,
      teacherId: teacher.id,
      status: saved.status,
      reviewedAt: saved.reviewedAt?.toISOString() ?? null,
      reviewedBy: supervisor.id,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data status supervisi tidak valid" }, { status: 400 })
    }
    return authFailureResponse(error, "Status supervisi gagal disimpan")
  }
}
