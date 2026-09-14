import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { detectProfilePhotoType } from "@/lib/profile"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { euksOfficerPhotoUrl } from "@/lib/euks-settings"
import { assertDetectedType } from "@/lib/upload-policy"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"
import { resolveMedia } from "@/lib/server-media"
import { storeMedia } from "@/lib/server-media-storage"

/**
 * Foto pengurus UKS.
 *
 * Bytes disimpan pada baris `EuksOfficer` sendiri, bukan pada akun guru:
 * mengganti foto pengurus tidak boleh mengubah foto profil guru tersebut.
 * Karena foto menumpang baris yang sama, mengganti foto menimpa byte lama dan
 * menghapus pengurus ikut menghapus fotonya — tidak ada berkas yatim, dan
 * tidak ada direktori unggahan yang harus dipasang di VPS/Docker.
 */

/** Tampilkan foto. Cukup hak baca E-UKS; foto pengurus bukan data kesehatan. */
export async function GET(_request: Request, { params }: { params: Promise<{ officerId: string }> }) {
  try {
    await requireEuksPermission("euks.content.read")
    const { officerId } = await params

    const officer = await prisma.euksOfficer.findUnique({
      where: { id: officerId },
      select: { photoKey: true, photoData: true, photoMimeType: true },
    })
    // Kunci penyimpanan bila sudah dimigrasikan, byte legacy bila belum.
    const media = officer
      ? await resolveMedia({
          key: officer.photoKey,
          mimeType: officer.photoMimeType,
          legacyBytes: officer.photoData,
        })
      : null
    if (!media) {
      return NextResponse.json({ error: "Foto pengurus belum tersedia" }, { status: 404 })
    }

    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Simpan/ganti foto. Hanya ADMIN, sama dengan konten pengaturan lainnya. */
export async function PUT(request: Request, { params }: { params: Promise<{ officerId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.officers.update")
    const { officerId } = await params

    await assertRequestSizeWithinSlot("euks.officer.photo", request)

    const officer = await prisma.euksOfficer.findUnique({
      where: { id: officerId },
      select: { id: true, name: true, userId: true },
    })
    if (!officer) return NextResponse.json({ error: "Pengurus tidak ditemukan" }, { status: 404 })

    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }
    const policy = await assertUploadAllowedForSlot("euks.officer.photo", {
      size: photo.size,
      fileName: photo.name,
    })

    const bytes = new Uint8Array(await photo.arrayBuffer())
    // Percayai magic bytes berkasnya, bukan content-type dari klien.
    const mimeType = assertDetectedType(policy, detectProfilePhotoType(bytes))

    // Berkas ditulis dan diverifikasi sebelum transaksi database dibuka.
    // Kegagalan menulis berarti database sama sekali tidak berubah.
    const stored = await storeMedia("euks/officer", bytes, mimeType)

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.euksOfficer.update({
        where: { id: officer.id },
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
          action: "EUKS_OFFICER_PHOTO_UPDATED",
          entity: "EuksOfficer",
          entityId: officer.id,
          targetUserId: officer.userId,
          summary: `Foto pengurus UKS "${officer.name}" diperbarui`,
        },
        tx,
      )
      return saved
    })

    return NextResponse.json({ photoUrl: euksOfficerPhotoUrl(updated.id, updated.photoUpdatedAt) })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Hapus foto saja; entri pengurus tetap ada dan kembali memakai placeholder. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ officerId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.officers.update")
    const { officerId } = await params

    const officer = await prisma.euksOfficer.findUnique({
      where: { id: officerId },
      select: { id: true, name: true, userId: true },
    })
    if (!officer) return NextResponse.json({ error: "Pengurus tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksOfficer.update({
        where: { id: officer.id },
        data: { photoKey: null, photoSize: null, photoData: null, photoMimeType: null, photoUpdatedAt: null },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_OFFICER_PHOTO_UPDATED",
          entity: "EuksOfficer",
          entityId: officer.id,
          targetUserId: officer.userId,
          summary: `Foto pengurus UKS "${officer.name}" dihapus`,
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
