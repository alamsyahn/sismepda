import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/rbac-access"
import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { recordAuditLog } from "@/lib/audit-log"
import { detectProfilePhotoType } from "@/lib/profile"
import { resolveMedia } from "@/lib/server-media"
import { storeMedia } from "@/lib/server-media-storage"
import { assertDetectedType } from "@/lib/upload-policy"
import { verifySameOrigin } from "@/lib/same-origin"
import { teacherPhotoUrl } from "@/lib/server-teacher-profile"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"

/**
 * Foto guru.
 *
 * Membaca cukup hak direktori guru; mengubahnya butuh hak mengelola profil
 * guru (`teachers.profile.update`) — sama dengan mutasi master data guru
 * lainnya, dan diperiksa ulang di server sehingga menyembunyikan tombol di
 * klien bukan satu-satunya penjaga.
 *
 * Bytes selalu melewati penyimpanan media kanonik (`storeMedia`); kolom
 * `photoData` legacy hanya dibaca sebagai fallback dan dikosongkan untuk baris
 * yang sudah pindah. Berkas lama sengaja tidak dihapus di sini: pembersihan
 * adalah fase terpisah, dan menghapus di jalur permintaan menghilangkan jalur
 * pemulihan bila penggantian ternyata keliru.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    // Foto adalah bagian direktori guru, dijaga permission yang sama.
    await requirePermission("teachers.directory.read")
    const { teacherId } = await params
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, ...teacherPopulationWhere() },
      select: { photoKey: true, photoData: true, photoMimeType: true },
    })
    // Foto guru dibaca lewat resolver yang sama dengan foto profil: kunci baru
    // jika ada, byte legacy bila belum dimigrasikan.
    const media = teacher
      ? await resolveMedia({
          key: teacher.photoKey,
          mimeType: teacher.photoMimeType,
          legacyBytes: teacher.photoData,
        })
      : null
    if (!media) {
      return NextResponse.json({ error: "Foto guru belum tersedia" }, { status: 404 })
    }
    return new Response(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return authFailureResponse(error, "Foto guru gagal dimuat")
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })

    const actor = await requirePermission("teachers.profile.update")
    const { teacherId } = await params
    await assertRequestSizeWithinSlot("teachers.master.photo", request)

    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, ...teacherPopulationWhere() },
      select: { id: true, name: true },
    })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }
    const policy = await assertUploadAllowedForSlot("teachers.master.photo", {
      size: photo.size,
      fileName: photo.name,
    })

    const bytes = new Uint8Array(await photo.arrayBuffer())
    // Tipe ditentukan dari isi berkas, bukan `file.type` kiriman klien.
    const mimeType = assertDetectedType(policy, detectProfilePhotoType(bytes))

    // Berkas ditulis dan diverifikasi DULU; baru database menunjuk kuncinya.
    const stored = await storeMedia("users/avatar", bytes, mimeType)

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: teacher.id },
        data: {
          photoKey: stored.key,
          photoSize: stored.size,
          photoMimeType: stored.mimeType,
          photoUpdatedAt: new Date(),
          // Byte legacy dikosongkan hanya untuk baris yang baru saja pindah.
          photoData: null,
        },
        select: { id: true, photoUpdatedAt: true },
      })
      await recordAuditLog(
        {
          actorId: actor.user.id,
          action: "TEACHER_PHOTO_UPDATED",
          entity: "User",
          entityId: teacher.id,
          targetUserId: teacher.id,
          summary: `Foto guru ${teacher.name} diperbarui.`,
        },
        tx,
      )
      return saved
    })

    return NextResponse.json({ photoUrl: teacherPhotoUrl(updated.id, updated.photoUpdatedAt) })
  } catch (error) {
    return authFailureResponse(error, "Foto guru gagal disimpan")
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })

    const actor = await requirePermission("teachers.profile.update")
    const { teacherId } = await params
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, ...teacherPopulationWhere() },
      select: { id: true, name: true },
    })
    if (!teacher) return NextResponse.json({ error: "Guru tidak ditemukan" }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: teacher.id },
        // Referensi database dibersihkan; berkasnya sengaja dibiarkan sampai
        // fase pembersihan terpisah, sama seperti foto profil sendiri.
        data: {
          photoKey: null,
          photoSize: null,
          photoData: null,
          photoMimeType: null,
          photoUpdatedAt: null,
        },
      })
      await recordAuditLog(
        {
          actorId: actor.user.id,
          action: "TEACHER_PHOTO_UPDATED",
          entity: "User",
          entityId: teacher.id,
          targetUserId: teacher.id,
          summary: `Foto guru ${teacher.name} dihapus.`,
        },
        tx,
      )
    })

    return NextResponse.json({ photoUrl: null })
  } catch (error) {
    return authFailureResponse(error, "Foto guru gagal dihapus")
  }
}
