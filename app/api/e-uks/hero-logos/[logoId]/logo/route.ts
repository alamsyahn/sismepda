import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksAdmin, requireEuksViewer } from "@/lib/euks-access"
import {
  EUKS_LOGO_FORMAT_LABEL,
  MAX_EUKS_LOGO_BYTES,
  checkSvgPayload,
  detectEuksLogoType,
  euksHeroLogoUrl,
} from "@/lib/euks-logo"

/**
 * Byte berkas logo hero UKS.
 *
 * Penyimpanan mengikuti pola yang sudah dipakai modul ini: byte menumpang baris
 * `EuksHeroLogo` sendiri, sehingga mengganti logo menimpa byte lama, menghapus
 * entri ikut menghapus berkasnya, dan tidak ada direktori unggahan yang harus
 * dipasang di VPS/Docker.
 */

/** Tampilkan logo. Cukup hak baca E-UKS, sama seperti foto hero. */
export async function GET(_request: Request, { params }: { params: Promise<{ logoId: string }> }) {
  try {
    await requireEuksViewer()
    const { logoId } = await params

    const logo = await prisma.euksHeroLogo.findUnique({
      where: { id: logoId },
      select: { logoData: true, logoMimeType: true },
    })
    if (!logo?.logoData || !logo.logoMimeType) {
      return NextResponse.json({ error: "Logo belum tersedia" }, { status: 404 })
    }

    return new Response(logo.logoData, {
      headers: {
        "Content-Type": logo.logoMimeType,
        "Content-Length": String(logo.logoData.byteLength),
        // URL sudah mengandung `?v=logoUpdatedAt`, jadi cache basi tidak mungkin
        // terpakai. `private` karena rute ini di balik autentikasi.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        // SVG yang disajikan langsung dari domain aplikasi akan mewarisi origin
        // aplikasi bila seseorang membukanya di tab tersendiri. Tiga header
        // berikut menutup jalur itu: unduh alih-alih render, larang skrip, dan
        // pisahkan dari dokumen pembuka. Logo tetap tampil normal lewat <img>,
        // yang memang tidak terpengaruh Content-Disposition.
        "Content-Disposition": "inline; filename=\"logo\"",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Simpan/ganti berkas logo. Hanya ADMIN. */
export async function PUT(request: Request, { params }: { params: Promise<{ logoId: string }> }) {
  try {
    const viewer = await requireEuksAdmin()
    const { logoId } = await params

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_EUKS_LOGO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran logo maksimal 512 KB" }, { status: 413 })
    }

    const logo = await prisma.euksHeroLogo.findUnique({
      where: { id: logoId },
      select: { id: true, name: true },
    })
    if (!logo) return NextResponse.json({ error: "Logo tidak ditemukan" }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get("logo")
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Pilih berkas logo terlebih dahulu" }, { status: 400 })
    }
    if (file.size > MAX_EUKS_LOGO_BYTES) {
      return NextResponse.json({ error: "Ukuran logo maksimal 512 KB" }, { status: 413 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    // Percayai isi berkasnya, bukan content-type dari klien.
    const mimeType = detectEuksLogoType(bytes)
    if (!mimeType) {
      return NextResponse.json(
        { error: `Logo harus berformat ${EUKS_LOGO_FORMAT_LABEL}` },
        { status: 415 },
      )
    }

    // SVG adalah dokumen yang bisa membawa skrip, bukan sekadar piksel. Logo
    // hanya pernah dirender lewat <img src>, yang sudah menonaktifkan skrip,
    // tetapi berkas bermuatan skrip tetap ditolak agar tidak pernah mengendap
    // di basis data sekolah.
    if (mimeType === "image/svg+xml") {
      const check = checkSvgPayload(bytes)
      if (!check.safe) {
        return NextResponse.json(
          { error: `Berkas SVG ditolak karena ${check.reason}` },
          { status: 415 },
        )
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.euksHeroLogo.update({
        where: { id: logo.id },
        data: { logoData: bytes, logoMimeType: mimeType, logoUpdatedAt: new Date() },
        select: { id: true, logoUpdatedAt: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_LOGO_FILE_UPDATED",
          entity: "EuksHeroLogo",
          entityId: logo.id,
          summary: `Berkas logo hero UKS "${logo.name}" diperbarui`,
          after: { mimeType },
        },
        tx,
      )
      return saved
    })

    return NextResponse.json({ logoUrl: euksHeroLogoUrl(updated.id, updated.logoUpdatedAt) })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Hapus berkasnya saja; entri logo tetap ada dan bisa diunggahi ulang. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ logoId: string }> }) {
  try {
    const viewer = await requireEuksAdmin()
    const { logoId } = await params

    const logo = await prisma.euksHeroLogo.findUnique({
      where: { id: logoId },
      select: { id: true, name: true },
    })
    if (!logo) return NextResponse.json({ error: "Logo tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksHeroLogo.update({
        where: { id: logo.id },
        data: { logoData: null, logoMimeType: null, logoUpdatedAt: null },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_LOGO_FILE_UPDATED",
          entity: "EuksHeroLogo",
          entityId: logo.id,
          summary: `Berkas logo hero UKS "${logo.name}" dihapus`,
        },
        tx,
      )
    })

    return NextResponse.json({ logoUrl: null })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
