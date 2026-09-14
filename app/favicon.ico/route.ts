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

export async function GET(request: Request) {
  try {
    const setting = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { faviconData: true, faviconMimeType: true, faviconUpdatedAt: true },
    })
    if (!setting?.faviconData || !setting.faviconMimeType) {
      return NextResponse.redirect(new URL("/icon.svg", request.url))
    }

    const download = new URL(request.url).searchParams.get("download") === "1"
    const extension = setting.faviconMimeType === "image/png" ? "png" : "ico"
    return new Response(setting.faviconData, {
      headers: {
        "Content-Type": setting.faviconMimeType,
        "Content-Length": String(setting.faviconData.byteLength),
        "Cache-Control": download ? "private, no-store" : "public, max-age=0, must-revalidate",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="favicon.${extension}"`,
        "Last-Modified": setting.faviconUpdatedAt?.toUTCString() ?? new Date(0).toUTCString(),
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

    const updated = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: { faviconData: bytes, faviconMimeType: mimeType, faviconUpdatedAt: new Date() },
      create: { faviconData: bytes, faviconMimeType: mimeType, faviconUpdatedAt: new Date() },
      select: { faviconUpdatedAt: true },
    })
    return NextResponse.json({ faviconUrl: faviconUrl(updated.faviconUpdatedAt), hasFavicon: true })
  } catch (error) {
    return authFailureResponse(error, "Favicon gagal disimpan")
  }
}
