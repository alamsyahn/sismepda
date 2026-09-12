import { NextResponse } from "next/server"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import {
  appLogoUrl,
  DEFAULT_APP_LOGO_URL,
  detectAppLogoType,
  MAX_APP_LOGO_BYTES,
} from "@/lib/site-branding"

/**
 * Logo aplikasi disajikan dari database (pola yang sama dengan /favicon.ico)
 * sehingga deployment tidak butuh object storage atau filesystem writable.
 * Nama file tidak pernah berasal dari input user, jadi tidak ada permukaan
 * path traversal maupun overwrite file sembarangan.
 */
export async function GET(request: Request) {
  try {
    const setting = await prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { appLogoData: true, appLogoMimeType: true, appLogoUpdatedAt: true },
    })
    if (!setting?.appLogoData || !setting.appLogoMimeType) {
      return NextResponse.redirect(new URL(DEFAULT_APP_LOGO_URL, request.url))
    }

    return new Response(setting.appLogoData, {
      headers: {
        "Content-Type": setting.appLogoMimeType,
        "Content-Length": String(setting.appLogoData.byteLength),
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Disposition": "inline",
        "Last-Modified": setting.appLogoUpdatedAt?.toUTCString() ?? new Date(0).toUTCString(),
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return NextResponse.redirect(new URL(DEFAULT_APP_LOGO_URL, request.url))
  }
}

export async function PUT(request: Request) {
  try {
    await requirePermission("school.branding.update")
    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_APP_LOGO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran logo maksimal 1 MB" }, { status: 413 })
    }

    const formData = await request.formData()
    const logo = formData.get("logo")
    if (!(logo instanceof File) || logo.size === 0) {
      return NextResponse.json({ error: "Pilih file logo terlebih dahulu" }, { status: 400 })
    }
    if (logo.size > MAX_APP_LOGO_BYTES) {
      return NextResponse.json({ error: "Ukuran logo maksimal 1 MB" }, { status: 413 })
    }

    const bytes = new Uint8Array(await logo.arrayBuffer())
    const mimeType = detectAppLogoType(bytes)
    if (!mimeType) {
      return NextResponse.json({ error: "Logo harus berformat PNG, JPG, atau WebP" }, { status: 415 })
    }

    const updated = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: { appLogoData: bytes, appLogoMimeType: mimeType, appLogoUpdatedAt: new Date() },
      create: { appLogoData: bytes, appLogoMimeType: mimeType, appLogoUpdatedAt: new Date() },
      select: { appLogoUpdatedAt: true },
    })
    return NextResponse.json({ appLogoUrl: appLogoUrl(updated.appLogoUpdatedAt), hasAppLogo: true })
  } catch (error) {
    return authFailureResponse(error, "Logo gagal disimpan")
  }
}

/** Hapus logo custom sehingga aplikasi kembali memakai logo default. */
export async function DELETE() {
  try {
    await requirePermission("school.branding.update")
    await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: { appLogoData: null, appLogoMimeType: null, appLogoUpdatedAt: null },
      create: { id: "default" },
      select: { id: true },
    })
    return NextResponse.json({ appLogoUrl: DEFAULT_APP_LOGO_URL, hasAppLogo: false })
  } catch (error) {
    return authFailureResponse(error, "Logo gagal dikembalikan ke default")
  }
}
