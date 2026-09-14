import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { detectProfilePhotoType } from "@/lib/profile"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { euksHeroImageUrl } from "@/lib/euks-settings"
import { assertDetectedType } from "@/lib/upload-policy"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"
import { resolveMedia } from "@/lib/server-media"
import { storeMedia } from "@/lib/server-media-storage"

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
      select: { photoKey: true, photoData: true, photoMimeType: true },
    })
    // Kunci penyimpanan bila sudah dimigrasikan, byte legacy bila belum.
    const media = image
      ? await resolveMedia({
          key: image.photoKey,
          mimeType: image.photoMimeType,
          legacyBytes: image.photoData,
        })
      : null
    if (!media) {
      return NextResponse.json({ error: "Foto hero belum tersedia" }, { status: 404 })
    }

    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
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

    await assertRequestSizeWithinSlot("euks.hero.image", request)

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
    const policy = await assertUploadAllowedForSlot("euks.hero.image", {
      size: photo.size,
      fileName: photo.name,
    })

    const bytes = new Uint8Array(await photo.arrayBuffer())
    // Percayai magic bytes berkasnya, bukan content-type dari klien.
    const mimeType = assertDetectedType(policy, detectProfilePhotoType(bytes))

    // Berkas ditulis dan diverifikasi sebelum transaksi database dibuka.
    // Kegagalan menulis berarti database sama sekali tidak berubah.
    const stored = await storeMedia("euks/hero", bytes, mimeType)

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.euksHeroImage.update({
        where: { id: image.id },
        data: {
          photoKey: stored.key,
          photoSize: stored.size,
          photoMimeType: stored.mimeType,
          photoUpdatedAt: new Date(),
          // Byte legacy dikosongkan untuk baris yang sudah pindah.
          photoData: null,
        },
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
        data: { photoKey: null, photoSize: null, photoData: null, photoMimeType: null, photoUpdatedAt: null },
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
