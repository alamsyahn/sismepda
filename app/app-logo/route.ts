import { NextResponse } from "next/server"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { requirePermission } from "@/lib/rbac-access"
import {
  appLogoUrl,
  DEFAULT_APP_LOGO_URL,
  detectAppLogoType,
} from "@/lib/site-branding"
import { assertDetectedType } from "@/lib/upload-policy"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"
import { resolveMedia } from "@/lib/server-media"
import { storeMedia } from "@/lib/server-media-storage"

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
      select: { appLogoKey: true, appLogoData: true, appLogoMimeType: true, appLogoUpdatedAt: true },
    })
    // Kunci penyimpanan bila ada, byte legacy bila belum dimigrasikan;
    // bila keduanya kosong, perilaku redirect ke aset default tidak berubah.
    const media = setting
      ? await resolveMedia({
          key: setting.appLogoKey,
          mimeType: setting.appLogoMimeType,
          legacyBytes: setting.appLogoData,
        })
      : null
    if (!media) {
      return NextResponse.redirect(new URL(DEFAULT_APP_LOGO_URL, request.url))
    }

    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Disposition": "inline",
        "Last-Modified": setting?.appLogoUpdatedAt?.toUTCString() ?? new Date(0).toUTCString(),
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
    await assertRequestSizeWithinSlot("branding.app.logo", request)

    const formData = await request.formData()
    const logo = formData.get("logo")
    if (!(logo instanceof File) || logo.size === 0) {
      return NextResponse.json({ error: "Pilih file logo terlebih dahulu" }, { status: 400 })
    }
    const policy = await assertUploadAllowedForSlot("branding.app.logo", {
      size: logo.size,
      fileName: logo.name,
    })

    const bytes = new Uint8Array(await logo.arrayBuffer())
    const mimeType = assertDetectedType(policy, detectAppLogoType(bytes))

    // Berkas ditulis dan diverifikasi sebelum database menunjuk kuncinya.
    const stored = await storeMedia("branding/app-logo", bytes, mimeType)

    const updated = await prisma.schoolSetting.upsert({
      where: { id: "default" },
      update: {
        appLogoKey: stored.key,
        appLogoSize: stored.size,
        appLogoMimeType: stored.mimeType,
        appLogoUpdatedAt: new Date(),
        // Byte legacy dikosongkan untuk baris yang sudah pindah.
        appLogoData: null,
      },
      create: {
        appLogoKey: stored.key,
        appLogoSize: stored.size,
        appLogoMimeType: stored.mimeType,
        appLogoUpdatedAt: new Date(),
        // Byte legacy dikosongkan untuk baris yang sudah pindah.
        appLogoData: null,
      },
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
      update: { appLogoKey: null, appLogoSize: null, appLogoData: null, appLogoMimeType: null, appLogoUpdatedAt: null },
      create: { id: "default" },
      select: { id: true },
    })
    return NextResponse.json({ appLogoUrl: DEFAULT_APP_LOGO_URL, hasAppLogo: false })
  } catch (error) {
    return authFailureResponse(error, "Logo gagal dikembalikan ke default")
  }
}
