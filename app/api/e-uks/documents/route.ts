import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { assertDocumentOrigin, readDocumentFile, readDocumentForm, readDocumentMetadata } from "@/lib/server-euks-documents"

export async function POST(request: Request) {
  try {
    assertDocumentOrigin(request)
    const { user } = await requirePermission("euks.documents.manage")
    await requirePermission("euks.documents.read")
    const form = await readDocumentForm(request)
    const metadata = readDocumentMetadata(form)
    const file = await readDocumentFile(form)
    if (!file) throw new ApiError(400, "Pilih berkas yang akan diunggah.")

    await prisma.$transaction(async tx => {
      const { id } = await tx.euksDocument.create({ data: { ...metadata, ...file }, select: { id: true } })
      await recordAuditLog({
        actorId: user.id,
        action: "EUKS_DOCUMENT_CREATED",
        entity: "EuksDocument",
        entityId: id,
        after: { category: metadata.category, shared: metadata.shared, size: file.size },
      }, tx)
    })

    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Dokumen gagal diunggah.")
  }
}
