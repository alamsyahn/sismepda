import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { bosErrorResponse, requireBosPermission } from "@/lib/bos-access"
import { formatRupiah, normalizeDocumentUrl } from "@/lib/bos"

const documentSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  label: z.string().trim().max(120).optional().transform((value) => value || null),
})

const payload = z.object({
  categoryId: z.string().min(1),
  description: z.string().trim().min(3).max(2000),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().min(0).max(999_999_999_999),
  documents: z.array(documentSchema).max(20).optional(),
})

/** Reject impossible calendar dates (2026-02-31) the regex lets through. */
function strictDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  date.setHours(0, 0, 0, 0)
  return date
}

/** Validate every documentation URL up front; reject the whole entry on a bad one. */
function normalizeDocuments(documents: Array<{ url: string; label: string | null }> | undefined) {
  const list = documents ?? []
  const normalized: Array<{ url: string; label: string | null }> = []
  for (const item of list) {
    const url = normalizeDocumentUrl(item.url)
    if (!url) return null
    normalized.push({ url, label: item.label })
  }
  return normalized
}

/** Create one BOS usage entry. Requires bos.create. */
export async function POST(request: Request) {
  try {
    const viewer = await requireBosPermission("bos.create")
    const body = payload.parse(await request.json())

    const occurredAt = strictDate(body.occurredAt)
    if (!occurredAt) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })

    const documents = normalizeDocuments(body.documents)
    if (!documents) {
      return NextResponse.json({ error: "Link dokumentasi harus berupa URL http/https" }, { status: 400 })
    }

    const category = await prisma.bosCategory.findUnique({
      where: { id: body.categoryId },
      select: { id: true, name: true, active: true },
    })
    if (!category) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 })
    if (!category.active) {
      return NextResponse.json({ error: "Kategori sudah nonaktif" }, { status: 400 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.bosEntry.create({
        data: {
          categoryId: category.id,
          description: body.description,
          occurredAt,
          amount: body.amount,
          createdById: viewer.id,
          updatedById: viewer.id,
          ...(documents.length > 0 ? { documents: { create: documents } } : {}),
        },
        select: { id: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "BOS_ENTRY_CREATED",
          entity: "BosEntry",
          entityId: entry.id,
          summary: `Entry BOS ${formatRupiah(body.amount)} pada kategori ${category.name} dibuat`,
          after: {
            category: category.name,
            description: body.description,
            occurredAt: body.occurredAt,
            amount: body.amount,
            documentCount: documents.length,
          },
        },
        tx,
      )
      return entry
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const { error: message, status } = bosErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
