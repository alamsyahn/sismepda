/**
 * Layer server WhatsApp otomatis: konfigurasi, riwayat, dan pengiriman.
 *
 * Berkas ini menyentuh database tetapi TIDAK menyentuh Baileys — transport
 * diterima sebagai argumen. Akibatnya seluruh aturan pengiriman, termasuk
 * idempotensi, dapat diuji dengan transport palsu.
 */
import { resolveHoliday } from "@/lib/holiday-rules"
import { prisma } from "@/lib/prisma"
import {
  formatSchoolDate,
  schoolMinutesOfDay,
  todayInSchoolTimeZone,
  toPrismaDate,
  type SchoolDate,
} from "@/lib/school-date"
import { readHolidayRules } from "@/lib/server-holidays"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { readWhatsAppReportClasses } from "@/lib/server-whatsapp-report"
import {
  buildAbsentStudentsMessage,
  buildMissingAttendanceMessage,
} from "@/lib/whatsapp-messages"
import {
  WHATSAPP_MESSAGE_TYPES,
  WHATSAPP_SCHEDULE,
  idempotencyKeyFor,
  scheduleFor,
  type WhatsAppMessageType,
} from "@/lib/whatsapp-schedule"
import {
  resolveDestination,
  type DefaultDestination,
  type DestinationMode,
  type ReportDestination,
} from "@/lib/whatsapp-target"
import {
  WhatsAppSendError,
  type WhatsAppErrorCode,
  type WhatsAppTransport,
} from "@/lib/whatsapp-transport"

export type WhatsAppConfigurationRow = {
  type: WhatsAppMessageType
  enabled: boolean
  destinationMode: DestinationMode
  targetGroupJid: string | null
  targetGroupName: string | null
  targetResolvedAt: Date | null
  lastSentAt: Date | null
  updatedAt: Date
}

export type WhatsAppSettingRow = {
  defaultGroupJid: string | null
  defaultGroupName: string | null
  defaultGroupResolvedAt: Date | null
}

/** Baris setelan tunggal, dibuat saat pertama dibutuhkan. */
export async function readWhatsAppSetting(): Promise<WhatsAppSettingRow> {
  const row = await prisma.whatsAppSetting.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  })
  return {
    defaultGroupJid: row.defaultGroupJid,
    defaultGroupName: row.defaultGroupName,
    defaultGroupResolvedAt: row.defaultGroupResolvedAt,
  }
}

/**
 * Ubah grup tujuan default.
 *
 * JID adalah identitas; nama hanya ikut sebagai snapshot tampilan. Keduanya
 * ditulis bersama supaya nama tersimpan tidak pernah menjadi milik JID lain.
 */
export async function updateDefaultDestination(changes: {
  jid: string | null
  name: string | null
}): Promise<WhatsAppSettingRow> {
  const row = await prisma.whatsAppSetting.upsert({
    where: { id: "default" },
    update: {
      defaultGroupJid: changes.jid,
      defaultGroupName: changes.jid ? changes.name : null,
      defaultGroupResolvedAt: changes.jid ? new Date() : null,
    },
    create: {
      id: "default",
      defaultGroupJid: changes.jid,
      defaultGroupName: changes.jid ? changes.name : null,
      defaultGroupResolvedAt: changes.jid ? new Date() : null,
    },
  })
  return {
    defaultGroupJid: row.defaultGroupJid,
    defaultGroupName: row.defaultGroupName,
    defaultGroupResolvedAt: row.defaultGroupResolvedAt,
  }
}

/** Bentuk yang dimengerti resolver, dari satu baris konfigurasi. */
export function destinationOf(row: WhatsAppConfigurationRow): ReportDestination {
  return {
    mode: row.destinationMode,
    jid: row.targetGroupJid,
    name: row.targetGroupName,
  }
}

/** Bentuk yang dimengerti resolver, dari baris setelan. */
export function defaultDestinationOf(row: WhatsAppSettingRow): DefaultDestination {
  return { jid: row.defaultGroupJid, name: row.defaultGroupName }
}

/**
 * Baca konfigurasi seluruh jenis pesan, membuat baris yang belum ada.
 *
 * Default `enabled: false` berasal dari schema: mengaktifkan pengiriman ke grup
 * sekolah adalah keputusan manusia, bukan efek samping migrasi database.
 */
export async function readConfigurations(): Promise<WhatsAppConfigurationRow[]> {
  const existing = await prisma.whatsAppConfiguration.findMany()
  const missing = WHATSAPP_MESSAGE_TYPES.filter(
    (type) => !existing.some((row) => row.type === type),
  )

  if (missing.length > 0) {
    await prisma.whatsAppConfiguration.createMany({
      data: missing.map((type) => ({ type })),
      skipDuplicates: true,
    })
    return prisma.whatsAppConfiguration.findMany()
  }
  return existing
}

export async function readConfiguration(
  type: WhatsAppMessageType,
): Promise<WhatsAppConfigurationRow> {
  const rows = await readConfigurations()
  const row = rows.find((entry) => entry.type === type)
  if (!row) throw new Error(`Konfigurasi WhatsApp tidak ditemukan untuk ${type}`)
  return row
}

/**
 * Ubah konfigurasi satu jenis pesan.
 *
 * Hanya dua hal yang boleh diubah operator: aktif/nonaktif, dan grup tujuan.
 * Jam jadwal sengaja TIDAK termasuk — itu aturan sekolah yang hidup di
 * `lib/whatsapp-schedule.ts`, bukan pengaturan yang bisa digeser dari layar.
 */
export async function updateConfiguration(
  type: WhatsAppMessageType,
  changes: {
    enabled?: boolean
    destinationMode?: DestinationMode
    targetGroupJid?: string | null
    targetGroupName?: string | null
  },
): Promise<WhatsAppConfigurationRow> {
  await readConfigurations()

  const data: Record<string, unknown> = {}
  if (changes.enabled !== undefined) data.enabled = changes.enabled
  if (changes.destinationMode !== undefined) data.destinationMode = changes.destinationMode
  if (changes.targetGroupJid !== undefined) {
    data.targetGroupJid = changes.targetGroupJid
    data.targetGroupName = changes.targetGroupName ?? null
    // Stempel waktu resolusi ikut diperbarui agar terlihat kapan terakhir
    // nama grup benar-benar dicocokkan dengan JID yang hidup.
    data.targetResolvedAt = changes.targetGroupJid ? new Date() : null
  }

  return prisma.whatsAppConfiguration.update({ where: { type }, data })
}

export type SkipReason =
  | "AUTOMATIC_DISABLED"
  | "HOLIDAY"
  | "ALREADY_SENT"
  | "NO_TARGET"
  | "INVALID_TARGET"

export type SendOutcome =
  | { status: "SENT"; logId: string }
  | { status: "SKIPPED"; reason: SkipReason; detail: string }
  | { status: "FAILED"; code: WhatsAppErrorCode; message: string; logId: string | null }

/**
 * Susun teks pesan untuk satu jenis dan satu tanggal sekolah.
 *
 * Memakai sumber data yang sama dengan halaman /laporan-whatsapp, sehingga
 * angka yang dikirim ke grup tidak mungkin berbeda dari angka di layar.
 */
export async function composeMessage(
  type: WhatsAppMessageType,
  date: SchoolDate,
  slot: string,
): Promise<string> {
  // Data laporan dibaca lewat fungsi data-only: jalur ini juga dijalankan
  // worker latar yang tidak punya sesi pengguna. Guard permission untuk
  // pemanggil web ada di `lib/whatsapp-access.ts`.
  const classes = await readWhatsAppReportClasses(toPrismaDate(date))
  // Parameter ketiga formatSchoolDate adalah LOCALE, bukan zona waktu:
  // SchoolDate sudah bebas zona waktu dan tidak boleh diproyeksikan ulang.
  const dateLabel = formatSchoolDate(date)

  switch (type) {
    case "ATTENDANCE_MISSING":
      return buildMissingAttendanceMessage(dateLabel, slot, classes)
    case "ATTENDANCE_ABSENT":
      return buildAbsentStudentsMessage(dateLabel, slot, classes)
    default: {
      const exhaustive: never = type
      throw new Error(`Jenis pesan tidak dikenal: ${String(exhaustive)}`)
    }
  }
}

export type SendRequest = {
  type: WhatsAppMessageType
  /** Slot `HH:mm` untuk kiriman terjadwal; NULL untuk manual. */
  slot: string | null
  /** SCHEDULED dijaga idempoten; MANUAL sengaja boleh diulang operator. */
  trigger: "SCHEDULED" | "MANUAL"
  initiatedById?: string | null
  date?: SchoolDate
}

/**
 * Kirim satu pesan, dengan seluruh penjagaan.
 *
 * Urutan pemeriksaan disengaja: yang paling murah dan paling menentukan lebih
 * dulu, sehingga hari libur tidak pernah menyentuh query laporan.
 */
export async function sendWhatsAppMessage(
  transport: WhatsAppTransport,
  request: SendRequest,
): Promise<SendOutcome> {
  const timeZone = await readSchoolTimeZone()
  const date = request.date ?? todayInSchoolTimeZone(new Date(), timeZone)
  const configuration = await readConfiguration(request.type)

  if (request.trigger === "SCHEDULED" && !configuration.enabled) {
    return {
      status: "SKIPPED",
      reason: "AUTOMATIC_DISABLED",
      detail: "Pengiriman otomatis sedang dinonaktifkan.",
    }
  }

  // Hari libur hanya membatalkan jadwal. Pengiriman manual tetap diizinkan:
  // admin yang menekan tombol tahu persis hari apa ini.
  if (request.trigger === "SCHEDULED") {
    const verdict = resolveHoliday(date, await readHolidayRules())
    if (verdict.isHoliday) {
      return { status: "SKIPPED", reason: "HOLIDAY", detail: `Hari libur: ${verdict.reason}.` }
    }
  }

  const target = resolveDestination(
    destinationOf(configuration),
    defaultDestinationOf(await readWhatsAppSetting()),
  )
  if (target.status === "NOT_RESOLVED") {
    return { status: "SKIPPED", reason: "NO_TARGET", detail: "Grup tujuan belum dipilih." }
  }
  if (target.status === "INVALID") {
    return {
      status: "SKIPPED",
      reason: "INVALID_TARGET",
      detail: "Identitas grup tujuan tidak valid. Pilih ulang grup tujuan.",
    }
  }

  const slot = request.slot ?? scheduleFor(request.type).slots[0]
  const idempotencyKey =
    request.trigger === "SCHEDULED" ? idempotencyKeyFor(request.type, date, slot) : null

  const messageText = await composeMessage(request.type, date, slot)

  let sendResult: { providerMessageId: string | null }
  try {
    sendResult = await transport.sendMessage(target.jid, messageText)
  } catch (error) {
    const code = error instanceof WhatsAppSendError ? error.code : "UNKNOWN"
    const message = error instanceof WhatsAppSendError ? error.message : "Pengiriman gagal."
    const failure = await recordLog({
      request,
      slot,
      date,
      idempotencyKey,
      target,
      messageText,
      status: "FAILED",
      errorCode: code,
      errorMessage: message,
    })
    if (failure.duplicate) {
      return {
        status: "SKIPPED",
        reason: "ALREADY_SENT",
        detail: "Pesan untuk jadwal ini sudah pernah dikirim hari ini.",
      }
    }
    return { status: "FAILED", code, message, logId: failure.id }
  }

  const success = await recordLog({
    request,
    slot,
    date,
    idempotencyKey,
    target,
    messageText,
    status: "SENT",
    providerMessageId: sendResult.providerMessageId,
  })

  // Kunci UNIQUE ditolak SETELAH pesan terkirim berarti slot ini sudah pernah
  // dikirim oleh worker lain. Dicatat apa adanya; baris pertamalah yang sah.
  if (success.duplicate) {
    return {
      status: "SKIPPED",
      reason: "ALREADY_SENT",
      detail: "Pesan untuk jadwal ini sudah pernah dikirim hari ini.",
    }
  }

  await prisma.whatsAppConfiguration.update({
    where: { type: request.type },
    data: { lastSentAt: new Date() },
  })

  return { status: "SENT", logId: success.id! }
}

type LogInput = {
  request: SendRequest
  slot: string
  date: SchoolDate
  idempotencyKey: string | null
  target: { jid: string; name: string }
  messageText: string
  status: "SENT" | "FAILED" | "SKIPPED"
  providerMessageId?: string | null
  errorCode?: string
  errorMessage?: string
}

/**
 * Catat hasil pengiriman.
 *
 * Constraint UNIQUE pada `idempotencyKey`-lah penjaga duplikat yang
 * sesungguhnya — bukan variabel di memori, yang akan gagal begitu worker
 * restart atau dua worker berjalan bersamaan.
 */
async function recordLog(input: LogInput): Promise<{ id: string | null; duplicate: boolean }> {
  try {
    const log = await prisma.whatsAppSendLog.create({
      data: {
        type: input.request.type,
        trigger: input.request.trigger,
        status: input.status,
        idempotencyKey: input.idempotencyKey,
        schoolDate: toPrismaDate(input.date),
        scheduledSlot: input.request.trigger === "SCHEDULED" ? input.slot : null,
        targetGroupJid: input.target.jid,
        targetGroupName: input.target.name,
        // Snapshot: data absensi berubah setelah pesan dikirim.
        messageText: input.messageText,
        providerMessageId: input.providerMessageId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        sentAt: input.status === "SENT" ? new Date() : null,
        initiatedById: input.request.initiatedById ?? null,
      },
      select: { id: true },
    })
    return { id: log.id, duplicate: false }
  } catch (error) {
    if (isUniqueViolation(error)) return { id: null, duplicate: true }
    throw error
  }
}

/** Kode Prisma untuk pelanggaran constraint unik. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
}

/** Menit-dalam-hari menurut zona waktu sekolah, bukan jam container. */
export async function schoolMinutesNow(now: Date = new Date()): Promise<number> {
  return schoolMinutesOfDay(now, await readSchoolTimeZone())
}

export type ScheduleSlotStatus = {
  type: WhatsAppMessageType
  label: string
  slot: string
  status: "SENT" | "FAILED" | "SKIPPED" | "NOT_YET"
  sentAt: Date | null
  errorMessage: string | null
}

/** Status setiap slot untuk satu hari sekolah — sumber kartu jadwal di UI. */
export async function readScheduleStatus(date: SchoolDate): Promise<ScheduleSlotStatus[]> {
  const logs = await prisma.whatsAppSendLog.findMany({
    where: { schoolDate: toPrismaDate(date), trigger: "SCHEDULED" },
    orderBy: { attemptedAt: "desc" },
  })

  const statuses: ScheduleSlotStatus[] = []
  for (const definition of WHATSAPP_SCHEDULE) {
    for (const slot of definition.slots) {
      const log = logs.find((entry) => entry.type === definition.type && entry.scheduledSlot === slot)
      statuses.push({
        type: definition.type,
        label: definition.label,
        slot,
        status: log ? log.status : "NOT_YET",
        sentAt: log?.sentAt ?? null,
        errorMessage: log?.errorMessage ?? null,
      })
    }
  }
  return statuses
}

/** Riwayat pengiriman terbaru untuk ditampilkan di halaman admin. */
export async function readSendHistory(limit = 50) {
  return prisma.whatsAppSendLog.findMany({
    orderBy: { attemptedAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      trigger: true,
      status: true,
      scheduledSlot: true,
      schoolDate: true,
      targetGroupName: true,
      errorCode: true,
      errorMessage: true,
      attemptedAt: true,
      sentAt: true,
      initiatedBy: { select: { name: true, email: true } },
    },
  })
}
