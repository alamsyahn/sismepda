import { NextResponse } from "next/server"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import { detectFaviconType, faviconUrl } from "@/lib/site-branding"
import { assertDetectedType } from "@/lib/upload-policy"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"
import { resolveMedia } from "@/lib/server-media"
import { storeMedia } from "@/lib/server-media-storage"

export async function GET(request: Request) {
  try {
    const setting = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { faviconKey: true, faviconData: true, faviconMimeType: true, faviconUpdatedAt: true },
    })
    // Kunci penyimpanan bila ada, byte legacy bila belum dimigrasikan;
    // bila keduanya kosong, perilaku redirect ke aset default tidak berubah.
    const media = setting
      ? await resolveMedia({
          key: setting.faviconKey,
          mimeType: setting.faviconMimeType,
          legacyBytes: setting.faviconData,
        })
      : null
    if (!media) {
      return NextResponse.redirect(new URL("/icon.svg", request.url))
    }

    const download = new URL(request.url).searchParams.get("download") === "1"
    const extension = media.mimeType === "image/png" ? "png" : "ico"
    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": download ? "private, no-store" : "public, max-age=0, must-revalidate",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="favicon.${extension}"`,
        "Last-Modified": setting?.faviconUpdatedAt?.toUTCString() ?? new Date(0).toUTCString(),
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.redirect(new URL("/icon.svg", request.url))
  }
}

export async function PUT(request: Request) {
  try {
    await requirePermission("school.branding.update")
    await assertRequestSizeWithinSlot("branding.favicon", request)

    const formData = await request.formData()
    const favicon = formData.get("favicon")
    if (!(favicon instanceof File) || favicon.size === 0) {
      return NextResponse.json({ error: "Pilih file favicon terlebih dahulu" }, { status: 400 })
    }
    const policy = await assertUploadAllowedForSlot("branding.favicon", {
      size: favicon.size,
      fileName: favicon.name,
    })

    const bytes = new Uint8Array(await favicon.arrayBuffer())
    const mimeType = assertDetectedType(policy, detectFaviconType(bytes))

    // Berkas ditulis dan diverifikasi sebelum database menunjuk kuncinya.
    const stored = await storeMedia("branding/favicon", bytes, mimeType)

    const updated = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: {
        faviconKey: stored.key,
        faviconSize: stored.size,
        faviconMimeType: stored.mimeType,
        faviconUpdatedAt: new Date(),
        // Byte legacy dikosongkan untuk baris yang sudah pindah.
        faviconData: null,
      },
      create: {
        faviconKey: stored.key,
        faviconSize: stored.size,
        faviconMimeType: stored.mimeType,
        faviconUpdatedAt: new Date(),
        // Byte legacy dikosongkan untuk baris yang sudah pindah.
        faviconData: null,
      },
      select: { faviconUpdatedAt: true },
    })
    return NextResponse.json({ faviconUrl: faviconUrl(updated.faviconUpdatedAt), hasFavicon: true })
  } catch (error) {
    return authFailureResponse(error, "Favicon gagal disimpan")
  }
}
