/**
 * Layer server WhatsApp otomatis: konfigurasi, riwayat, dan pengiriman.
 *
 * Berkas ini menyentuh database tetapi TIDAK menyentuh Baileys — transport
 * diterima sebagai argumen. Akibatnya seluruh aturan pengiriman, termasuk
 * idempotensi, dapat diuji dengan transport palsu.
 */
import { Prisma } from "@/app/generated/prisma/client"
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
import { renderTemplate } from "@/lib/whatsapp-template"
import {
  buildTemplateContext,
  templateKeyFor,
} from "@/lib/whatsapp-template-context"
import {
  effectiveTemplate,
  parseStoredTemplates,
  type StoredTemplates,
} from "@/lib/whatsapp-template-store"
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
  slots: string[]
  /** JSON mentah; SELALU lewat `parseStoredTemplates` sebelum dipakai. */
  messageTemplates: unknown
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

/**
 * Nama sekolah untuk placeholder `{{nama_sekolah}}`.
 *
 * Dibaca dari `SchoolSetting` yang sudah dipakai seluruh aplikasi, bukan
 * konstanta baru, supaya nama di pesan WhatsApp tidak pernah berbeda dari nama
 * yang terlihat di layar.
 */
export async function readSchoolName(): Promise<string> {
  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { schoolName: true },
  })
  return setting?.schoolName ?? ""
}

/**
 * Ubah template satu jenis pesan.
 *
 * Menerima set yang SUDAH divalidasi pemanggil (route). Nilai `null` berarti
 * kembali ke bawaan sepenuhnya: barisnya dikosongkan, bukan diisi salinan
 * template bawaan — lihat alasannya di `serializeTemplates`.
 */
export async function updateMessageTemplates(
  type: WhatsAppMessageType,
  templates: StoredTemplates | null,
): Promise<WhatsAppConfigurationRow> {
  await readConfigurations()
  return prisma.whatsAppConfiguration.update({
    where: { type },
    data: { messageTemplates: templates === null ? Prisma.DbNull : templates },
  })
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
      // Baris baru dibenihi jam bawaan jenisnya. Tanpa ini, jenis pesan baru
      // lahir tanpa jadwal dan diam-diam tidak pernah terkirim.
      data: missing.map((type) => ({ type, slots: [...scheduleFor(type).defaultSlots] })),
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
 * Termasuk jam jadwal: jam sekolah bergeser (ujian, bulan puasa, jam masuk
 * baru), dan menuntut rilis untuk setiap pergeseran membuat jadwal di layar
 * perlahan berbohong tentang apa yang benar-benar dikirim.
 */
export async function updateConfiguration(
  type: WhatsAppMessageType,
  changes: {
    enabled?: boolean
    destinationMode?: DestinationMode
    targetGroupJid?: string | null
    targetGroupName?: string | null
    slots?: string[]
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
  if (changes.slots !== undefined) data.slots = changes.slots

  return prisma.whatsAppConfiguration.update({ where: { type }, data })
}

export type SkipReason =
  | "AUTOMATIC_DISABLED"
  | "HOLIDAY"
  | "ALREADY_SENT"
  | "NO_TARGET"
  | "INVALID_TARGET"
  | "NO_SLOT"

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

  // KONDISI DITENTUKAN SISTEM, BUKAN ADMIN.
  //
  // Template tidak mengenal percabangan; yang memilih antara "masih ada yang
  // belum rekap" dan "semua sudah" adalah data, di satu tempat, sehingga
  // template yang dipilih tidak pernah bertentangan dengan angka di dalamnya.
  const templateKey = templateKeyFor(type, classes)
  const configuration = await readConfiguration(type)
  const stored = parseStoredTemplates(configuration.messageTemplates)

  return renderTemplate(
    templateKey,
    effectiveTemplate(templateKey, stored),
    buildTemplateContext({
      dateLabel,
      slot,
      schoolName: await readSchoolName(),
      classes,
    }),
  )
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

  const slot = request.slot ?? configuration.slots[0]
  if (!slot) {
    return {
      status: "SKIPPED",
      reason: "NO_SLOT",
      detail: "Jadwal pengiriman belum diatur untuk jenis laporan ini.",
    }
  }

  const messageText = await composeMessage(request.type, date, slot)

  // KLAIM DULU, BARU KIRIM.
  //
  // Inilah inti perbaikan duplikat-per-menit. Sebelumnya pesan dikirim lebih
  // dulu dan barisnya baru ditulis sesudahnya, sehingga constraint UNIQUE hanya
  // menolak CATATANNYA — pesannya sendiri sudah terlanjur sampai. Scheduler
  // yang berdetak tiap menit dengan grace 20 menit karena itu mengirim occurrence
  // yang sama berulang kali; tick berikutnya tidak pernah menemukan baris
  // penanda, karena baris itu ditulis setelah kerusakan terjadi.
  //
  // Sekarang baris PROCESSING ditulis lebih dahulu. Penulis kedua ditolak
  // database sebelum transport disentuh, sehingga yang dijaga adalah
  // PENGIRIMAN, bukan pencatatan.
  let claim: { id: string | null; duplicate: boolean }
  if (request.trigger === "SCHEDULED") {
    claim = await recordLog({
      request,
      slot,
      date,
      idempotencyKey: idempotencyKeyFor(request.type, date, slot),
      target,
      messageText,
      status: "PROCESSING",
    })
    if (claim.duplicate || !claim.id) {
      return {
        status: "SKIPPED",
        reason: "ALREADY_SENT",
        detail: "Pesan untuk jadwal ini sudah pernah diproses hari ini.",
      }
    }
  } else {
    // Kiriman manual sengaja boleh diulang: admin yang menekannya tahu persis
    // apa yang ia minta. Ia tidak pernah mengklaim occurrence terjadwal, jadi
    // jadwal hari itu tidak ikut terkunci olehnya.
    claim = { id: null, duplicate: false }
  }

  let sendResult: { providerMessageId: string | null }
  try {
    sendResult = await transport.sendMessage(target.jid, messageText)
  } catch (error) {
    const code = error instanceof WhatsAppSendError ? error.code : "UNKNOWN"
    const message = error instanceof WhatsAppSendError ? error.message : "Pengiriman gagal."
    // Klaim yang gagal dikirim ditandai FAILED, bukan dihapus. Occurrence-nya
    // tetap terpakai sehingga tick menit berikutnya tidak mencoba lagi — kalau
    // dihapus, slot yang gagal akan diulang tiap menit sepanjang masa grace.
    const failure = claim.id
      ? await markLog(claim.id, { status: "FAILED", errorCode: code, errorMessage: message })
      : await recordLog({
          request,
          slot,
          date,
          idempotencyKey: null,
          target,
          messageText,
          status: "FAILED",
          errorCode: code,
          errorMessage: message,
        })
    return { status: "FAILED", code, message, logId: failure.id }
  }

  const success = claim.id
    ? await markLog(claim.id, {
        status: "SENT",
        providerMessageId: sendResult.providerMessageId,
      })
    : await recordLog({
        request,
        slot,
        date,
        idempotencyKey: null,
        target,
        messageText,
        status: "SENT",
        providerMessageId: sendResult.providerMessageId,
      })

  await prisma.whatsAppConfiguration.update({
    where: { type: request.type },
    data: { lastSentAt: new Date() },
  })

  return { status: "SENT", logId: success.id! }
}

/** Selesaikan klaim yang sudah ditulis: PROCESSING → SENT/FAILED. */
async function markLog(
  id: string,
  outcome: {
    status: "SENT" | "FAILED"
    providerMessageId?: string | null
    errorCode?: string
    errorMessage?: string
  },
): Promise<{ id: string | null; duplicate: boolean }> {
  const log = await prisma.whatsAppSendLog.update({
    where: { id },
    data: {
      status: outcome.status,
      providerMessageId: outcome.providerMessageId ?? null,
      errorCode: outcome.errorCode ?? null,
      errorMessage: outcome.errorMessage ?? null,
      sentAt: outcome.status === "SENT" ? new Date() : null,
    },
    select: { id: true },
  })
  return { id: log.id, duplicate: false }
}

type LogInput = {
  request: SendRequest
  slot: string
  date: SchoolDate
  idempotencyKey: string | null
  target: { jid: string; name: string }
  messageText: string
  status: "PROCESSING" | "SENT" | "FAILED" | "SKIPPED"
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
  status: "PROCESSING" | "SENT" | "FAILED" | "SKIPPED" | "NOT_YET"
  sentAt: Date | null
  errorMessage: string | null
}

/**
 * Status setiap slot untuk satu hari sekolah — sumber kartu jadwal di UI.
 *
 * Status berasal dari catatan pengiriman yang benar-benar ada, bukan dari
 * perbandingan jam. "Terkirim" harus berarti pesannya memang sampai; menebak
 * dari `sekarang >= jadwal` akan menyatakan sukses untuk slot yang justru gagal.
 */
export async function readScheduleStatus(date: SchoolDate): Promise<ScheduleSlotStatus[]> {
  const [logs, configurations] = await Promise.all([
    prisma.whatsAppSendLog.findMany({
      where: { schoolDate: toPrismaDate(date), trigger: "SCHEDULED" },
      orderBy: { attemptedAt: "desc" },
    }),
    readConfigurations(),
  ])

  const statuses: ScheduleSlotStatus[] = []
  for (const definition of WHATSAPP_SCHEDULE) {
    const configuration = configurations.find((row) => row.type === definition.type)
    for (const slot of configuration?.slots ?? []) {
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
