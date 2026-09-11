import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"

const payload = z
  .object({
    note: z.string().trim().max(500).optional(),
    followUp: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.note !== undefined || value.followUp !== undefined, {
    message: "Tidak ada perubahan",
  })

/**
 * Sunting catatan dan tindak lanjut satu baris ketidakhadiran langsung dari
 * Pantauan Kesehatan, tanpa membuka halaman Input Absensi.
 *
 * Hanya kedua kolom teks itu yang dapat diubah di sini. Status kehadiran,
 * tanggal, dan kelas sengaja tidak dapat disentuh: mengubahnya menggeser
 * rekap absensi, dan tempatnya adalah halaman Input Absensi yang memiliki
 * pemeriksaan hari libur, tanggal masa depan, dan cakupan kelas.
 *
 * Hak akses memakai euks.edit, bukan kepemilikan kelas, karena petugas UKS
 * yang bukan wali kelas tetap perlu mencatat tindak lanjut.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ attendanceId: string }> },
) {
  try {
    const viewer = await requireEuksPermission("euks.edit")
    const { attendanceId } = await params
    const body = payload.parse(await request.json())

    const existing = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      select: {
        id: true,
        status: true,
        note: true,
        followUp: true,
        student: { select: { id: true, name: true } },
        attendanceDay: { select: { date: true } },
      },
    })
    if (!existing) {
      return NextResponse.json({ error: "Data absensi tidak ditemukan" }, { status: 404 })
    }
    // Tabel ini hanya menampilkan ketidakhadiran karena sakit. Menolak status
    // lain menjaga endpoint tidak dipakai menyunting kehadiran umum.
    if (existing.status !== "SAKIT") {
      return NextResponse.json(
        { error: "Hanya ketidakhadiran karena sakit yang dapat disunting di sini" },
        { status: 400 },
      )
    }

    const note = body.note === undefined ? existing.note : body.note || null
    const followUp = body.followUp === undefined ? existing.followUp : body.followUp || null
    if (note === existing.note && followUp === existing.followUp) {
      return NextResponse.json({ id: existing.id, note, followUp })
    }

    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { note, followUp },
      select: { id: true, note: true, followUp: true },
    })

    await recordAuditLog({
      actorId: viewer.id,
      action: "EUKS_SICK_ABSENCE_UPDATED",
      entity: "Attendance",
      entityId: updated.id,
      targetUserId: null,
      before: { note: existing.note, followUp: existing.followUp },
      after: { note: updated.note, followUp: updated.followUp },
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
