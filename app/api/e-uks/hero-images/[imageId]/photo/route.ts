import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { detectProfilePhotoType } from "@/lib/profile"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { MAX_EUKS_PHOTO_BYTES, euksHeroImageUrl } from "@/lib/euks-settings"

/**
 * Byte foto hero UKS.
 *
 * Sama seperti foto pengurus dan fasilitas, byte-nya menumpang baris
 * `EuksHeroImage` sendiri: mengganti foto menimpa byte lama dan menghapus
 * entri ikut menghapus fotonya, sehingga tidak ada berkas yatim dan tidak ada
 * direktori unggahan yang harus dipasang di VPS/Docker.
 */

/** Tampilkan foto. Cukup hak baca E-UKS; foto hero bukan data kesehatan. */
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    await requireEuksPermission("euks.content.read")
    const { imageId } = await params

    const image = await prisma.euksHeroImage.findUnique({
      where: { id: imageId },
      select: { photoData: true, photoMimeType: true },
    })
    if (!image?.photoData || !image.photoMimeType) {
      return NextResponse.json({ error: "Foto hero belum tersedia" }, { status: 404 })
    }

    return new Response(image.photoData, {
      headers: {
        "Content-Type": image.photoMimeType,
        "Content-Length": String(image.photoData.byteLength),
        // Foto hero adalah aset terbesar di halaman ini dan URL-nya sudah
        // mengandung `?v=photoUpdatedAt`, jadi query-nya berubah setiap foto
        // diganti. Karena itu responsnya boleh disimpan lama: cache basi tidak
        // mungkin terpakai, sementara pengunjung berikutnya tidak perlu
        // mengunduh ulang foto besar yang sama. Tetap `private` karena rute ini
        // di balik autentikasi dan tidak boleh mengendap di proxy bersama.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Simpan/ganti foto. Hanya ADMIN, sama dengan konten pengaturan lainnya. */
export async function PUT(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.hero_images.update")
    const { imageId } = await params

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_EUKS_PHOTO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran foto maksimal 2 MB" }, { status: 413 })
    }

    const image = await prisma.euksHeroImage.findUnique({
      where: { id: imageId },
      select: { id: true, caption: true },
    })
    if (!image) return NextResponse.json({ error: "Foto hero tidak ditemukan" }, { status: 404 })

    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }
    if (photo.size > MAX_EUKS_PHOTO_BYTES) {
      return NextResponse.json({ error: "Ukuran foto maksimal 2 MB" }, { status: 413 })
    }

    const bytes = new Uint8Array(await photo.arrayBuffer())
    // Percayai magic bytes berkasnya, bukan content-type dari klien.
    const mimeType = detectProfilePhotoType(bytes)
    if (!mimeType) {
      return NextResponse.json({ error: "Foto harus berformat JPEG, PNG, atau WebP" }, { status: 415 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.euksHeroImage.update({
        where: { id: image.id },
        data: { photoData: bytes, photoMimeType: mimeType, photoUpdatedAt: new Date() },
        select: { id: true, photoUpdatedAt: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_IMAGE_PHOTO_UPDATED",
          entity: "EuksHeroImage",
          entityId: image.id,
          summary: image.caption
            ? `Foto hero UKS "${image.caption}" diperbarui`
            : "Foto hero UKS diperbarui",
        },
        tx,
      )
      return saved
    })

    return NextResponse.json({ photoUrl: euksHeroImageUrl(updated.id, updated.photoUpdatedAt) })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Hapus foto saja; entri hero tetap ada dan kembali memakai placeholder. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.hero_images.update")
    const { imageId } = await params

    const image = await prisma.euksHeroImage.findUnique({
      where: { id: imageId },
      select: { id: true, caption: true },
    })
    if (!image) return NextResponse.json({ error: "Foto hero tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksHeroImage.update({
        where: { id: image.id },
        data: { photoData: null, photoMimeType: null, photoUpdatedAt: null },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_HERO_IMAGE_PHOTO_UPDATED",
          entity: "EuksHeroImage",
          entityId: image.id,
          summary: image.caption
            ? `Foto hero UKS "${image.caption}" dihapus`
            : "Foto hero UKS dihapus",
        },
        tx,
      )
    })

    return NextResponse.json({ photoUrl: null })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
