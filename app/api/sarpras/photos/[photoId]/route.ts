import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSarprasViewer, sarprasErrorResponse } from "@/lib/sarpras-access"

/**
 * Stream one Sarpras photo. Requires sarpras.view — inventory photos are not
 * public, so this never serves bytes to an unauthorized caller.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  try {
    await requireSarprasViewer()
    const { photoId } = await params

    const photo = await prisma.sarprasPhoto.findUnique({
      where: { id: photoId },
      select: { data: true, mimeType: true },
    })
    if (!photo) return NextResponse.json({ error: "Foto tidak ditemukan" }, { status: 404 })

    return new Response(photo.data, {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Length": String(photo.data.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const { error: message, status } = sarprasErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
