import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { notifyEuksVisit } from "@/lib/server-euks-notification"
import { parseSchoolDate, toPrismaDate } from "@/lib/school-date"

const payload = z.object({
  studentId: z.string().min(1),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  complaint: z.string().trim().min(2).max(500),
  treatment: z.string().trim().min(2).max(500),
  followUp: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
  /**
   * "Simpan & Kirim Notifikasi".
   *
   * Sengaja bagian dari permintaan SIMPAN, bukan panggilan kedua dari layar:
   * kunjungan yang tersimpan lalu gagal dinotifikasi harus tetap tersimpan,
   * dan petugas harus melihat satu hasil, bukan dua yang bisa bertentangan.
   * Permission-nya tetap diperiksa terpisah di bawah.
   */
  notify: z.boolean().optional().default(false),
})

/** Record one UKS visit. Requires euks.edit. */
export async function POST(request: Request) {
  try {
    const viewer = await requireEuksPermission("euks.visits.create")
    const body = payload.parse(await request.json())

    const schoolDate = parseSchoolDate(body.occurredAt)
    if (!schoolDate) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 })

    const student = await prisma.student.findUnique({
      where: { id: body.studentId },
      select: { id: true, name: true, active: true, schoolClass: { select: { name: true } } },
    })
    if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 })
    if (!student.active) {
      return NextResponse.json({ error: "Siswa sudah tidak aktif" }, { status: 400 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const visit = await tx.euksVisit.create({
        data: {
          studentId: student.id,
          occurredAt: toPrismaDate(schoolDate),
          complaint: body.complaint,
          treatment: body.treatment,
          followUp: body.followUp,
          recordedById: viewer.id,
        },
        select: { id: true },
      })
      await recordAuditLog(
        {
          actorId: viewer.id,
          action: "EUKS_VISIT_CREATED",
          entity: "EuksVisit",
          entityId: visit.id,
          summary: `Kunjungan UKS ${student.name} (${student.schoolClass.name}) pada ${body.occurredAt} dicatat`,
          after: {
            student: student.name,
            className: student.schoolClass.name,
            occurredAt: body.occurredAt,
            complaint: body.complaint,
            treatment: body.treatment,
            followUp: body.followUp,
          },
        },
        tx,
      )
      return visit
    })

    // NOTIFIKASI DI LUAR TRANSAKSI, SETELAH KUNJUNGAN TERSIMPAN.
    //
    // Pengiriman WhatsApp memanggil layanan luar yang bisa lambat atau gagal;
    // menahannya di dalam transaksi berarti kunjungan yang sah ikut dibatalkan
    // hanya karena worker sedang tidak terhubung.
    let notification: Awaited<ReturnType<typeof notifyEuksVisit>> | null = null
    if (body.notify) {
      // Permission notifikasi diperiksa TERSENDIRI: hak mencatat kunjungan
      // tidak dengan sendirinya memberi hak mengirim data kesehatan siswa ke
      // nomor pribadi seorang guru.
      await requireEuksPermission("euks.visits.notify")
      notification = await notifyEuksVisit({ visitId: created.id, actorId: viewer.id })
    }

    return NextResponse.json({ ...created, notification }, { status: 201 })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
