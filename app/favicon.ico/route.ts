import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { detectFaviconType, MAX_FAVICON_BYTES, faviconUrl } from "@/lib/site-branding"

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
    await requireAdmin()
    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_FAVICON_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran favicon maksimal 512 KB" }, { status: 413 })
    }

    const formData = await request.formData()
    const favicon = formData.get("favicon")
    if (!(favicon instanceof File) || favicon.size === 0) {
      return NextResponse.json({ error: "Pilih file favicon terlebih dahulu" }, { status: 400 })
    }
    if (favicon.size > MAX_FAVICON_BYTES) {
      return NextResponse.json({ error: "Ukuran favicon maksimal 512 KB" }, { status: 413 })
    }

    const bytes = new Uint8Array(await favicon.arrayBuffer())
    const mimeType = detectFaviconType(bytes)
    if (!mimeType) {
      return NextResponse.json({ error: "Favicon harus berformat PNG atau ICO" }, { status: 415 })
    }

    const updated = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: { faviconData: bytes, faviconMimeType: mimeType, faviconUpdatedAt: new Date() },
      create: { faviconData: bytes, faviconMimeType: mimeType, faviconUpdatedAt: new Date() },
      select: { faviconUpdatedAt: true },
    })
    return NextResponse.json({ faviconUrl: faviconUrl(updated.faviconUpdatedAt), hasFavicon: true })
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json(
      { error: unauthorized ? "Tidak diizinkan" : "Favicon gagal disimpan" },
      { status: unauthorized ? 403 : 500 },
    )
  }
}
