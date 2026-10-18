import { prisma } from "@/lib/prisma"
import { kesiswaanViewer, activityScope } from "@/lib/kesiswaan-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { mediaStorage } from "@/lib/server-media-storage"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await kesiswaanViewer(),
      { id } = await params
    const row = await prisma.ksEvidence.findFirst({
      where: { id, ...(viewer.all ? {} : { achievement: { activity: activityScope(viewer) } }) },
    })
    if (!row) throw new ApiError(404, "Bukti tidak ditemukan")
    const bytes = await mediaStorage().get(row.mediaKey)
    if (!bytes) throw new ApiError(404, "Berkas tidak tersedia")
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return authFailureResponse(error)
  }
}
