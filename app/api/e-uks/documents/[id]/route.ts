import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { EUKS_DOCUMENT_READ_PERMISSIONS } from "@/lib/euks-documents"
import { prisma } from "@/lib/prisma"
import { requireAnyPermission, requirePermission } from "@/lib/rbac-access"
import {
  assertDocumentOrigin,
  documentId,
  documentVersion,
  readDocumentFile,
  readDocumentForm,
  readDocumentMetadata,
} from "@/lib/server-euks-documents"

type Context = { params: Promise<{ id: string }> }

async function readId(context: Context) {
  const parsed = documentId.safeParse((await context.params).id)
  if (!parsed.success) throw new ApiError(404, "Dokumen tidak ditemukan.")
  return parsed.data
}

function readVersion(value: unknown) {
  const parsed = documentVersion.safeParse(value)
  if (!parsed.success) throw new ApiError(400, "Versi dokumen tidak valid.")
  return parsed.data
}

export async function GET(_request: Request, context: Context) {
  try {
    const { grants } = await requireAnyPermission(EUKS_DOCUMENT_READ_PERMISSIONS)
    const id = await readId(context)
    const doc = await prisma.euksDocument.findUnique({
      where: { id, ...(grants.has("euks.documents.read") ? {} : { shared: true }) },
      select: { fileName: true, size: true, content: true },
    })
    if (!doc) throw new ApiError(404, "Dokumen tidak ditemukan.")

    const name = encodeURIComponent(doc.fileName).replace(/['()*]/g, char =>
      "%" + char.charCodeAt(0).toString(16).toUpperCase(),
    )
    return new Response(doc.content, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(doc.size),
        "Content-Disposition": "attachment; filename*=UTF-8''" + name,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    const response = authFailureResponse(error, "Dokumen gagal diunduh.")
    response.headers.set("Cache-Control", "private, no-store")
    return response
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertDocumentOrigin(request)
    const { user } = await requirePermission("euks.documents.manage")
    await requirePermission("euks.documents.read")
    const id = await readId(context)
    const form = await readDocumentForm(request)
    const version = readVersion(form.get("version"))
    const metadata = readDocumentMetadata(form)
    const file = await readDocumentFile(form)

    await prisma.$transaction(async tx => {
      const { count } = await tx.euksDocument.updateMany({
        where: { id, version },
        data: { ...metadata, ...file, version: { increment: 1 } },
      })
      if (!count) throw new ApiError(409, "Dokumen sudah berubah atau dihapus. Muat ulang halaman.")
      await recordAuditLog({
        actorId: user.id,
        action: "EUKS_DOCUMENT_UPDATED",
        entity: "EuksDocument",
        entityId: id,
        after: { category: metadata.category, shared: metadata.shared, fileReplaced: Boolean(file), version: version + 1 },
      }, tx)
    })
    return Response.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Dokumen gagal diperbarui.")
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertDocumentOrigin(request)
    const { user } = await requirePermission("euks.documents.manage")
    await requirePermission("euks.documents.read")
    const id = await readId(context)
    const version = readVersion(new URL(request.url).searchParams.get("version"))

    await prisma.$transaction(async tx => {
      const { count } = await tx.euksDocument.deleteMany({ where: { id, version } })
      if (!count) throw new ApiError(409, "Dokumen sudah berubah atau dihapus. Muat ulang halaman.")
      await recordAuditLog({
        actorId: user.id,
        action: "EUKS_DOCUMENT_DELETED",
        entity: "EuksDocument",
        entityId: id,
        before: { version },
      }, tx)
    })
    return Response.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Dokumen gagal dihapus.")
  }
}
