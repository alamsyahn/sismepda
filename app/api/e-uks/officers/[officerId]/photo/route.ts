import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { detectProfilePhotoType } from "@/lib/profile"
import { euksErrorResponse, requireEuksAdmin, requireEuksViewer } from "@/lib/euks-access"
import { MAX_EUKS_PHOTO_BYTES, euksOfficerPhotoUrl } from "@/lib/euks-settings"

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
    await requireEuksViewer()
    const { officerId } = await params

    const officer = await prisma.euksOfficer.findUnique({
      where: { id: officerId },
      select: { photoData: true, photoMimeType: true },
    })
    if (!officer?.photoData || !officer.photoMimeType) {
      return NextResponse.json({ error: "Foto pengurus belum tersedia" }, { status: 404 })
    }

    return new Response(officer.photoData, {
      headers: {
        "Content-Type": officer.photoMimeType,
        "Content-Length": String(officer.photoData.byteLength),
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
    const viewer = await requireEuksAdmin()
    const { officerId } = await params

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_EUKS_PHOTO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran foto maksimal 2 MB" }, { status: 413 })
    }

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
      const saved = await tx.euksOfficer.update({
        where: { id: officer.id },
        data: { photoData: bytes, photoMimeType: mimeType, photoUpdatedAt: new Date() },
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
    const viewer = await requireEuksAdmin()
    const { officerId } = await params

    const officer = await prisma.euksOfficer.findUnique({
      where: { id: officerId },
      select: { id: true, name: true, userId: true },
    })
    if (!officer) return NextResponse.json({ error: "Pengurus tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksOfficer.update({
        where: { id: officer.id },
        data: { photoData: null, photoMimeType: null, photoUpdatedAt: null },
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
