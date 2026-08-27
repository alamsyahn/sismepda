import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { readOwnWorkbookLinks } from "@/lib/server-workbook"
import { normalizeWorkbookUrl } from "@/lib/workbook"

const payload = z.object({
  links: z
    .array(z.object({ workbookId: z.string().min(1), url: z.string().max(2048) }))
    .min(1)
    .max(20),
})

export async function GET() {
  try {
    const sessionUser = await requireUser()
    return NextResponse.json({ links: await readOwnWorkbookLinks(sessionUser.id) })
  } catch {
    return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
  }
}

/**
 * A teacher may only edit their own links: userId always comes from the session,
 * never from the request body.
 */
export async function PUT(request: Request) {
  try {
    const sessionUser = await requireUser()
    const body = payload.parse(await request.json())

    const workbooks = await prisma.workbook.findMany({ select: { id: true, name: true } })
    const workbookById = new Map(workbooks.map((workbook) => [workbook.id, workbook.name]))

    const updates: Array<{ workbookId: string; workbookName: string; url: string | null }> = []
    for (const link of body.links) {
      const workbookName = workbookById.get(link.workbookId)
      if (!workbookName) {
        return NextResponse.json({ error: "Buku Kerja tidak ditemukan" }, { status: 404 })
      }
      const url = normalizeWorkbookUrl(link.url)
      if (url === undefined) {
        return NextResponse.json(
          { error: `Tautan ${workbookName} harus berupa URL http atau https yang valid` },
          { status: 400 },
        )
      }
      updates.push({ workbookId: link.workbookId, workbookName, url })
    }

    const existing = await prisma.teacherWorkbook.findMany({
      where: { userId: sessionUser.id, workbookId: { in: updates.map((item) => item.workbookId) } },
      select: { workbookId: true, url: true },
    })
    const previousUrl = new Map(existing.map((item) => [item.workbookId, item.url]))

    await prisma.$transaction(async (tx) => {
      for (const update of updates) {
        const before = previousUrl.get(update.workbookId) ?? null
        if (before === update.url) continue

        const saved = await tx.teacherWorkbook.upsert({
          where: { userId_workbookId: { userId: sessionUser.id, workbookId: update.workbookId } },
          update: { url: update.url },
          create: { userId: sessionUser.id, workbookId: update.workbookId, url: update.url },
          select: { id: true },
        })

        await recordAuditLog(
          {
            actorId: sessionUser.id,
            action: "WORKBOOK_LINK_UPDATED",
            entity: "TeacherWorkbook",
            entityId: saved.id,
            targetUserId: sessionUser.id,
            summary: `Tautan ${update.workbookName} ${update.url ? "diperbarui" : "dihapus"}`,
            before: { url: before },
            after: { url: update.url },
          },
          tx,
        )
      }
    })

    return NextResponse.json({ links: await readOwnWorkbookLinks(sessionUser.id) })
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data tautan tidak valid" }, { status: 400 })
    }
    return NextResponse.json({ error: "Tautan Buku Kerja gagal disimpan" }, { status: 500 })
  }
}
