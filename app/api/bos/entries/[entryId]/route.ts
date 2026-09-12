import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { normalizeDocumentUrl } from "@/lib/bos"
import { fromPrismaDate, parseSchoolDate, toPrismaDate } from "@/lib/school-date"

const documentSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  label: z.string().trim().max(120).optional().transform((value) => value || null),
})

/** Every field is optional — the table edits one cell at a time. */
const payload = z.object({
  categoryId: z.string().min(1).optional(),
  description: z.string().trim().min(3).max(2000).optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.coerce.number().min(0).max(999_999_999_999).optional(),
  /** When present, replaces the whole documentation list for the entry. */
  documents: z.array(documentSchema).max(20).optional(),
})

function normalizeDocuments(documents: Array<{ url: string; label: string | null }>) {
  const normalized: Array<{ url: string; label: string | null }> = []
  for (const item of documents) {
    const url = normalizeDocumentUrl(item.url)
    if (!url) return null
    normalized.push({ url, label: item.label })
  }
  return normalized
}

/** Edit one BOS entry in place. Requires bos.edit. */
export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const viewer = await requirePermission("bos.entries.update")
    const { entryId } = await params
    const body = payload.parse(await request.json())

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim" }, { status: 400 })
    }

    const entry = await prisma.bosEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        categoryId: true,
        description: true,
        occurredAt: true,
        amount: true,
        category: { select: { name: true } },
        documents: { select: { id: true } },
      },
    })
    if (!entry) return NextResponse.json({ error: "Entry tidak ditemukan" }, { status: 404 })

    let occurredAt: Date | undefined
    if (body.occurredAt !== undefined) {
      const parsed = parseSchoolDate(body.occurredAt)
      if (!parsed) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })
      occurredAt = toPrismaDate(parsed)
    }

    let categoryName = entry.category.name
    if (body.categoryId !== undefined && body.categoryId !== entry.categoryId) {
      const category = await prisma.bosCategory.findUnique({
        where: { id: body.categoryId },
        select: { id: true, name: true, active: true },
      })
      if (!category) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 })
      if (!category.active) {
        return NextResponse.json({ error: "Kategori sudah nonaktif" }, { status: 400 })
      }
      categoryName = category.name
    }

    let documents: Array<{ url: string; label: string | null }> | null = null
    if (body.documents !== undefined) {
      documents = normalizeDocuments(body.documents)
      if (!documents) {
        return NextResponse.json({ error: "Link dokumentasi harus berupa URL http/https" }, { status: 400 })
      }
    }

    const previousAmount = Number(entry.amount.toString())

    await prisma.$transaction(async (tx) => {
      // Documentation is replaced wholesale so the client can send one list.
      if (documents !== null) {
        await tx.bosDocument.deleteMany({ where: { entryId: entry.id } })
        if (documents.length > 0) {
          await tx.bosDocument.createMany({
            data: documents.map((item) => ({ ...item, entryId: entry.id })),
          })
        }
      }

      await tx.bosEntry.update({
        where: { id: entry.id },
        data: {
          ...(body.categoryId === undefined ? {} : { categoryId: body.categoryId }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(occurredAt === undefined ? {} : { occurredAt }),
          ...(body.amount === undefined ? {} : { amount: body.amount }),
          updatedById: viewer.user.id,
        },
      })

      await recordAuditLog(
        {
          actorId: viewer.user.id,
          action: "BOS_ENTRY_UPDATED",
          entity: "BosEntry",
          entityId: entry.id,
          summary: `Entry BOS kategori ${categoryName} diperbarui`,
          before: {
            category: entry.category.name,
            description: entry.description,
            occurredAt: fromPrismaDate(entry.occurredAt),
            amount: previousAmount,
            documentCount: entry.documents.length,
          },
          after: {
            category: categoryName,
            description: body.description ?? entry.description,
            occurredAt: body.occurredAt ?? fromPrismaDate(entry.occurredAt),
            amount: body.amount ?? previousAmount,
            documentCount: documents === null ? entry.documents.length : documents.length,
          },
        },
        tx,
      )
    })

    return NextResponse.json({ id: entry.id })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data BOS tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Entry BOS gagal diperbarui")
  }
}
