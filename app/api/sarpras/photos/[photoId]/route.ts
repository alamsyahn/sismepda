import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { authFailureResponse } from "@/lib/api-errors"
import { requireSarprasPermission } from "@/lib/sarpras-access"
import { resolveMedia } from "@/lib/server-media"

/**
 * Stream one Sarpras photo. Requires sarpras.view — inventory photos are not
 * public, so this never serves bytes to an unauthorized caller.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  try {
    await requireSarprasPermission("sarpras.photos.read")
    const { photoId } = await params

    const photo = await prisma.sarprasPhoto.findUnique({
      where: { id: photoId },
      select: { mediaKey: true, data: true, mimeType: true },
    })
    // Kunci penyimpanan bila sudah dimigrasikan, byte legacy bila belum.
    const media = photo
      ? await resolveMedia({
          key: photo.mediaKey,
          mimeType: photo.mimeType,
          legacyBytes: photo.data,
        })
      : null
    if (!media) return NextResponse.json({ error: "Foto tidak ditemukan" }, { status: 404 })

    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return authFailureResponse(error, "Data Sarpras tidak valid")
  }
}
