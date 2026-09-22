/**
 * Notifikasi kunjungan UKS ke wali kelas — layer server.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Ia menyambung tiga hal yang sudah ada dan TIDAK membuat yang keempat:
 * kunjungan UKS (`EuksVisit`), wali kelas (`SchoolClass.homeroomUser` —
 * sumber kebenaran yang sama dengan rekap absensi), dan jalur pengiriman
 * WhatsApp (kartu pesan + worker). Tidak ada mapping wali kelas khusus E-UKS,
 * tidak ada koneksi WhatsApp kedua, dan tidak ada template di luar layar
 * "WhatsApp Otomatis".
 *
 * ARAH DATA: kunjungan → siswa → kelas siswa → wali kelas → nomor guru.
 * Nomor dibaca ULANG pada setiap pengiriman, tidak pernah disalin ke E-UKS,
 * sehingga nomor yang baru diperbaiki di Data Master Guru langsung berlaku
 * pada percobaan berikutnya.
 */
import "server-only"

import { prisma } from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { ApiError } from "@/lib/api-errors"
import {
  buildEuksVisitContext,
  notifyBlockMessage,
  type EuksNotifyStatus,
  type NotifyBlockReason,
} from "@/lib/euks-notification"
import { normalizeIndonesianPhone, personalJidFor } from "@/lib/phone-number"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import { readBuiltinMessage, readSchoolName } from "@/lib/server-whatsapp"
import { workerSend } from "@/lib/server-whatsapp-worker-client"
import { renderTemplate } from "@/lib/whatsapp-template"
import { effectiveTemplate, parseStoredTemplates } from "@/lib/whatsapp-template-store"
import { WhatsAppSendError } from "@/lib/whatsapp-transport"

export type NotifyOutcome = {
  status: EuksNotifyStatus
  /** Kalimat siap tampil; selalu terisi, termasuk saat berhasil. */
  message: string
  recipientName: string | null
  recipientPhone: string | null
}

const visitSelect = {
  id: true,
  occurredAt: true,
  complaint: true,
  treatment: true,
  followUp: true,
  notifyStatus: true,
  recordedBy: { select: { name: true } },
  student: {
    select: {
      name: true,
      schoolClass: {
        select: {
          name: true,
          // SUMBER KEBENARAN WALI KELAS. Relasi yang sama dipakai rekap
          // absensi; E-UKS tidak menyimpan pemetaannya sendiri.
          homeroomUser: { select: { id: true, name: true, phone: true, active: true } },
        },
      },
    },
  },
} as const

/**
 * Susun teks notifikasi dari template kartu yang berlaku SAAT INI.
 *
 * Template dibaca pada setiap pengiriman, bukan disalin saat kunjungan
 * disimpan: admin yang menyunting teks di "WhatsApp Otomatis" harus melihat
 * perubahannya berlaku pada kiriman berikutnya tanpa menunggu apa pun.
 */
async function composeVisitMessage(input: {
  messageTemplates: unknown
  dateLabel: string
  schoolName: string
  studentName: string
  className: string
  homeroomName: string
  complaint: string
  treatment: string
  followUp: string | null
  recordedByName: string | null
}): Promise<string> {
  const stored = parseStoredTemplates(input.messageTemplates)
  return renderTemplate(
    "EUKS_VISIT",
    effectiveTemplate("EUKS_VISIT", stored),
    buildEuksVisitContext(input),
  )
}

/** Catat hasil percobaan pada baris kunjungan. Selalu ditulis, apa pun hasilnya. */
async function recordAttempt(
  visitId: string,
  outcome: {
    status: EuksNotifyStatus
    error: string | null
    recipientName: string | null
    recipientPhone: string | null
    sendLogId?: string | null
  },
): Promise<void> {
  const now = new Date()
  await prisma.euksVisit.update({
    where: { id: visitId },
    data: {
      notifyStatus: outcome.status,
      notifyAttemptedAt: now,
      // Hanya pengiriman yang benar-benar berhasil yang menggeser stempel ini;
      // percobaan gagal tidak boleh menghapus bukti kiriman sebelumnya.
      ...(outcome.status === "SENT" ? { notifySentAt: now } : {}),
      notifyRecipientName: outcome.recipientName,
      notifyRecipientPhone: outcome.recipientPhone,
      notifyError: outcome.error,
      notifySendLogId: outcome.sendLogId ?? null,
    },
  })
}

function blocked(
  reason: NotifyBlockReason,
  className: string,
): { status: "SKIPPED"; message: string } {
  return { status: "SKIPPED", message: notifyBlockMessage(reason, className) }
}

/**
 * Kirim (atau kirim ulang) notifikasi satu kunjungan.
 *
 * Dipanggil route handler yang sudah menegakkan permission. Fungsi ini TIDAK
 * memeriksa permission sendiri — ia juga dipakai jalur "Simpan & Kirim
 * Notifikasi" yang guard-nya sudah berjalan lebih dulu di route yang sama.
 */
export async function notifyEuksVisit(input: {
  visitId: string
  actorId: string
}): Promise<NotifyOutcome> {
  const visit = await prisma.euksVisit.findUnique({
    where: { id: input.visitId },
    select: visitSelect,
  })
  if (!visit) throw new ApiError(404, "Kunjungan tidak ditemukan")

  const schoolClass = visit.student.schoolClass
  const homeroom = schoolClass.homeroomUser

  // Wali kelas tidak ada, atau akunnya sudah dinonaktifkan. Keduanya berarti
  // tidak ada penerima yang sah; memilih guru lain sebagai pengganti akan
  // mengirim data kesehatan siswa kepada orang yang tidak berkepentingan.
  if (!homeroom || !homeroom.active) {
    const result = blocked("NO_HOMEROOM", schoolClass.name)
    await recordAttempt(visit.id, {
      status: "SKIPPED",
      error: result.message,
      recipientName: homeroom?.name ?? null,
      recipientPhone: null,
    })
    return { ...result, recipientName: homeroom?.name ?? null, recipientPhone: null }
  }

  // NOMOR DIBACA ULANG DI SINI, BUKAN DARI SNAPSHOT.
  const phone = normalizeIndonesianPhone(homeroom.phone)
  if (!phone.valid) {
    const result = blocked(
      phone.reason === "EMPTY" ? "NO_PHONE" : "INVALID_PHONE",
      schoolClass.name,
    )
    await recordAttempt(visit.id, {
      status: "SKIPPED",
      error: result.message,
      recipientName: homeroom.name,
      recipientPhone: homeroom.phone ?? null,
    })
    return { ...result, recipientName: homeroom.name, recipientPhone: homeroom.phone ?? null }
  }

  const card = await readBuiltinMessage("EUKS_VISIT_NOTIFICATION")
  const text = await composeVisitMessage({
    messageTemplates: card.messageTemplates,
    dateLabel: formatSchoolDate(fromPrismaDate(visit.occurredAt)),
    schoolName: await readSchoolName(),
    studentName: visit.student.name,
    className: schoolClass.name,
    homeroomName: homeroom.name,
    complaint: visit.complaint,
    treatment: visit.treatment,
    followUp: visit.followUp,
    recordedByName: visit.recordedBy?.name ?? null,
  })

  let outcome: Awaited<ReturnType<typeof workerSend>>
  try {
    outcome = await workerSend({
      messageId: card.id,
      // Notifikasi ini tidak menempati slot jadwal mana pun.
      slot: null,
      text,
      recipient: { jid: personalJidFor(phone.whatsapp), name: homeroom.name },
      initiatedById: input.actorId,
    })
  } catch (error) {
    const message =
      error instanceof WhatsAppSendError
        ? error.message
        : "Notifikasi gagal dikirim. Coba lagi beberapa saat lagi."
    await recordAttempt(visit.id, {
      status: "FAILED",
      error: message,
      recipientName: homeroom.name,
      recipientPhone: phone.display,
    })
    await writeAudit(input.actorId, visit.id, "FAILED", homeroom, phone.display, message)
    return {
      status: "FAILED",
      message,
      recipientName: homeroom.name,
      recipientPhone: phone.display,
    }
  }

  const status: EuksNotifyStatus =
    outcome.status === "SENT" ? "SENT" : outcome.status === "SKIPPED" ? "SKIPPED" : "FAILED"
  const detail =
    status === "SENT"
      ? `Notifikasi terkirim ke ${homeroom.name} (${phone.display}).`
      : (outcome.message ?? outcome.detail ?? "Notifikasi tidak terkirim.")

  await recordAttempt(visit.id, {
    status,
    error: status === "SENT" ? null : detail,
    recipientName: homeroom.name,
    recipientPhone: phone.display,
    sendLogId: outcome.logId ?? null,
  })
  await writeAudit(input.actorId, visit.id, status, homeroom, phone.display, detail)

  return { status, message: detail, recipientName: homeroom.name, recipientPhone: phone.display }
}

/**
 * Catat percobaan ke audit trail bersama.
 *
 * Nomor penerima ikut dicatat karena audit harus menjawab "pesan berisi data
 * kesehatan siswa ini dikirim ke nomor siapa" — pertanyaan yang tidak dapat
 * dijawab oleh nama saja ketika nomor guru berubah kemudian.
 */
async function writeAudit(
  actorId: string,
  visitId: string,
  status: EuksNotifyStatus,
  homeroom: { id: string; name: string },
  phoneDisplay: string | null,
  detail: string,
): Promise<void> {
  await recordAuditLog({
    actorId,
    action: "EUKS_VISIT_NOTIFIED",
    entity: "EuksVisit",
    entityId: visitId,
    targetUserId: homeroom.id,
    summary: `Notifikasi kunjungan UKS ke ${homeroom.name}: ${status}`,
    after: { status, recipient: homeroom.name, phone: phoneDisplay, detail },
  })
}
