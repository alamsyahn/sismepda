import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { detectProfilePhotoType } from "@/lib/profile"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { euksFacilityPhotoUrl } from "@/lib/euks-settings"
import { assertDetectedType } from "@/lib/upload-policy"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"

/**
 * Foto fasilitas UKS — pola identik dengan foto pengurus: bytes menumpang
 * baris `EuksFacility`, sehingga mengganti foto menimpa yang lama dan
 * menghapus fasilitas ikut menghapus fotonya.
 */

/** Tampilkan foto; cukup hak baca E-UKS. */
export async function GET(_request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  try {
    await requireEuksPermission("euks.content.read")
    const { facilityId } = await params

    const facility = await prisma.euksFacility.findUnique({
      where: { id: facilityId },
      select: { photoData: true, photoMimeType: true },
    })
    if (!facility?.photoData || !facility.photoMimeType) {
      return NextResponse.json({ error: "Foto fasilitas belum tersedia" }, { status: 404 })
    }

    return new Response(facility.photoData, {
      headers: {
        "Content-Type": facility.photoMimeType,
        "Content-Length": String(facility.photoData.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Simpan/ganti foto. Hanya ADMIN. */
export async function PUT(request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.facilities.update")
    const { facilityId } = await params

    await assertRequestSizeWithinSlot("euks.facility.photo", request)

    const facility = await prisma.euksFacility.findUnique({
      where: { id: facilityId },
      select: { id: true, name: true },
    })
    if (!facility) return NextResponse.json({ error: "Fasilitas tidak ditemukan" }, { status: 404 })

    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }
    const policy = await assertUploadAllowedForSlot("euks.facility.photo", {
      size: photo.size,
      fileName: photo.name,
    })

    const bytes = new Uint8Array(await photo.arrayBuffer())
    const mimeType = assertDetectedType(policy, detectProfilePhotoType(bytes))

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.euksFacility.update({
        where: { id: facility.id },
        data: { photoData: bytes, photoMimeType: mimeType, photoUpdatedAt: new Date() },
        select: { id: true, photoUpdatedAt: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_FACILITY_PHOTO_UPDATED",
          entity: "EuksFacility",
          entityId: facility.id,
          summary: `Foto fasilitas UKS "${facility.name}" diperbarui`,
        },
        tx,
      )
      return saved
    })

    return NextResponse.json({ photoUrl: euksFacilityPhotoUrl(updated.id, updated.photoUpdatedAt) })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Hapus foto saja; fasilitas tetap ada dan kembali memakai placeholder. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ facilityId: string }> }) {
  try {
    const viewer = await requireEuksPermission("euks.facilities.update")
    const { facilityId } = await params

    const facility = await prisma.euksFacility.findUnique({
      where: { id: facilityId },
      select: { id: true, name: true },
    })
    if (!facility) return NextResponse.json({ error: "Fasilitas tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.euksFacility.update({
        where: { id: facility.id },
        data: { photoData: null, photoMimeType: null, photoUpdatedAt: null },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_FACILITY_PHOTO_UPDATED",
          entity: "EuksFacility",
          entityId: facility.id,
          summary: `Foto fasilitas UKS "${facility.name}" dihapus`,
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
