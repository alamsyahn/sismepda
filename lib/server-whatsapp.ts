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
  WHATSAPP_SCHEDULE,
  type WhatsAppMessageType,
} from "@/lib/whatsapp-schedule"
import {
  attendanceActivityDecision,
} from "@/lib/whatsapp-attendance-activity"
import {
  BUILTIN_MESSAGE_IDS,
  MANUAL_MESSAGE_DESCRIPTION,
  MANUAL_MESSAGE_ID,
  MANUAL_MESSAGE_TITLE,
  isSchedulable,
  legacyLogTypeFor,
  messageIdempotencyKey,
  reorderMessages,
  type ReorderDirection,
  type WhatsAppMessageKind,
} from "@/lib/whatsapp-message"
import {
  resolveDestination,
  type DefaultDestination,
  type DestinationMode,
  type ReportDestination,
  type TargetState,
} from "@/lib/whatsapp-target"
import {
  WhatsAppSendError,
  type WhatsAppErrorCode,
  type WhatsAppTransport,
} from "@/lib/whatsapp-transport"

/**
 * Satu kartu pesan sebagaimana dibaca aplikasi.
 *
 * Menggantikan `WhatsAppConfigurationRow` sebagai unit konfigurasi: kartu punya
 * `id` bebas, sehingga pesan buatan admin tidak perlu nilai enum.
 */
export type WhatsAppMessageRow = {
  id: string
  kind: WhatsAppMessageKind
  builtinType: WhatsAppMessageType | null
  title: string
  description: string
  sortOrder: number
  enabled: boolean
  requireAttendanceActivity: boolean
  destinationMode: DestinationMode
  targetGroupJid: string | null
  targetGroupName: string | null
  targetResolvedAt: Date | null
  slots: string[]
  /** JSON mentah; SELALU lewat `parseStoredTemplates` sebelum dipakai. */
  messageTemplates: unknown
  selectedVariables: string[]
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
 * Ubah template satu kartu pesan.
 *
 * Menerima set yang SUDAH divalidasi pemanggil (route). Nilai `null` berarti
 * kembali ke bawaan sepenuhnya: barisnya dikosongkan, bukan diisi salinan
 * template bawaan — lihat alasannya di `serializeTemplates`.
 */
export async function updateMessageTemplates(
  messageId: string,
  templates: StoredTemplates | null,
): Promise<WhatsAppMessageRow> {
  return prisma.whatsAppMessage.update({
    where: { id: messageId },
    data: { messageTemplates: templates === null ? Prisma.DbNull : templates },
  })
}

/** Bentuk yang dimengerti resolver, dari satu kartu pesan. */
export function destinationOf(
  row: Pick<WhatsAppMessageRow, "destinationMode" | "targetGroupJid" | "targetGroupName">,
): ReportDestination {
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
 * Baca seluruh kartu pesan, urut tampil.
 *
 * MENGAPA KARTU BAWAAN DIPASTIKAN ADA DI SINI
 *
 * Migrasi sudah membuatnya, tetapi database yang dibangun dengan cara lain,
 * atau baris yang terhapus tangan, akan membuat halaman kehilangan kartu
 * bawaannya — dan kehilangan kartu berarti jadwal yang sebelumnya berjalan
 * diam-diam berhenti. Karena itu ketiadaannya diperbaiki saat dibaca, dengan
 * `id` deterministik yang sama seperti migrasi sehingga tidak pernah lahir
 * kartu kedua untuk jenis yang sama.
 *
 * Kartu yang dibuat di sini lahir nonaktif: mengaktifkan pengiriman ke grup
 * sekolah adalah keputusan manusia, bukan efek samping sebuah pembacaan.
 */
export async function readMessages(): Promise<WhatsAppMessageRow[]> {
  const existing = await prisma.whatsAppMessage.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })

  const missing: Prisma.WhatsAppMessageCreateManyInput[] = []
  let nextOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0)

  for (const definition of WHATSAPP_SCHEDULE) {
    if (existing.some((row) => row.builtinType === definition.type)) continue
    missing.push({
      id: BUILTIN_MESSAGE_IDS[definition.type],
      kind: "BUILTIN",
      builtinType: definition.type,
      title: definition.label,
      description: definition.description,
      sortOrder: nextOrder++,
      // Kartu bawaan yang lahir tanpa jam tidak akan pernah terkirim.
      slots: [...definition.defaultSlots],
    })
  }

  if (!existing.some((row) => row.kind === "MANUAL")) {
    missing.push({
      id: MANUAL_MESSAGE_ID,
      kind: "MANUAL",
      title: MANUAL_MESSAGE_TITLE,
      description: MANUAL_MESSAGE_DESCRIPTION,
      sortOrder: nextOrder++,
      // Sengaja tanpa jam: scheduler tidak boleh pernah melihat kartu manual.
      slots: [],
    })
  }

  if (missing.length > 0) {
    await prisma.whatsAppMessage.createMany({ data: missing, skipDuplicates: true })
    return prisma.whatsAppMessage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
  }
  return existing
}

export async function readMessage(messageId: string): Promise<WhatsAppMessageRow> {
  const rows = await readMessages()
  const row = rows.find((entry) => entry.id === messageId)
  if (!row) throw new Error(`Kartu pesan WhatsApp tidak ditemukan: ${messageId}`)
  return row
}

/** Kartu bawaan menurut jenisnya, untuk jalur yang masih bicara dalam enum. */
export async function readBuiltinMessage(type: WhatsAppMessageType): Promise<WhatsAppMessageRow> {
  const rows = await readMessages()
  const row = rows.find((entry) => entry.builtinType === type)
  if (!row) throw new Error(`Kartu pesan bawaan tidak ditemukan untuk ${type}`)
  return row
}

/**
 * Ubah satu kartu pesan.
 *
 * Termasuk jam jadwal: jam sekolah bergeser (ujian, bulan puasa, jam masuk
 * baru), dan menuntut rilis untuk setiap pergeseran membuat jadwal di layar
 * perlahan berbohong tentang apa yang benar-benar dikirim.
 */
export async function updateMessage(
  messageId: string,
  changes: {
    title?: string
    description?: string
    enabled?: boolean
    requireAttendanceActivity?: boolean
    destinationMode?: DestinationMode
    targetGroupJid?: string | null
    targetGroupName?: string | null
    slots?: string[]
    selectedVariables?: string[]
  },
): Promise<WhatsAppMessageRow> {
  const data: Prisma.WhatsAppMessageUpdateInput = {}
  if (changes.title !== undefined) data.title = changes.title
  if (changes.description !== undefined) data.description = changes.description
  if (changes.enabled !== undefined) data.enabled = changes.enabled
  if (changes.requireAttendanceActivity !== undefined) {
    data.requireAttendanceActivity = changes.requireAttendanceActivity
  }
  if (changes.destinationMode !== undefined) data.destinationMode = changes.destinationMode
  if (changes.targetGroupJid !== undefined) {
    data.targetGroupJid = changes.targetGroupJid
    data.targetGroupName = changes.targetGroupName ?? null
    // Stempel waktu resolusi ikut diperbarui agar terlihat kapan terakhir
    // nama grup benar-benar dicocokkan dengan JID yang hidup.
    data.targetResolvedAt = changes.targetGroupJid ? new Date() : null
  }
  if (changes.slots !== undefined) data.slots = changes.slots
  if (changes.selectedVariables !== undefined) data.selectedVariables = changes.selectedVariables

  return prisma.whatsAppMessage.update({ where: { id: messageId }, data })
}

/**
 * Geser satu kartu satu posisi dan tulis urutan kanonik.
 *
 * SATU TRANSAKSI, BUKAN DUA UPDATE. Urutan yang separuh tertulis akan tampak
 * acak di layar dan, lebih buruk, tidak dapat diperbaiki admin tanpa menebak.
 * Keputusan urutannya sendiri dihitung modul murni `reorderMessages`, sehingga
 * aturannya dapat diuji tanpa database.
 *
 * Mengembalikan `false` bila pergeseran tidak mungkin (kartu sudah di ujung):
 * pemanggil harus dapat menjawab "tidak ada yang berubah", bukan melaporkan
 * keberhasilan yang tidak terjadi.
 */
export async function moveMessage(
  messageId: string,
  direction: ReorderDirection,
): Promise<boolean> {
  const messages = await readMessages()
  const next = reorderMessages(
    messages.map((row) => row.id),
    messageId,
    direction,
  )
  if (!next) return false

  await prisma.$transaction(
    next.map((entry) =>
      prisma.whatsAppMessage.update({
        where: { id: entry.id },
        data: { sortOrder: entry.sortOrder },
      }),
    ),
  )
  return true
}

/**
 * Apakah hari itu sudah ada kelas yang mengisi absensi?
 *
 * `AttendanceDay` punya UNIQUE `(classId, date)`, jadi pertanyaan ini dijawab
 * indeks: satu baris saja cukup, dan pencariannya berhenti di baris pertama.
 * Tidak menghitung jumlah siswa hadir — hari yang berjalan pun bisa nihil
 * kehadiran, dan menghitung kehadiran akan membatalkan pesan pada hari yang
 * justru paling perlu dilaporkan.
 */
export async function hasAttendanceActivity(date: SchoolDate): Promise<boolean> {
  const row = await prisma.attendanceDay.findFirst({
    where: { date: toPrismaDate(date) },
    select: { id: true },
  })
  return row !== null
}

export type SkipReason =
  | "AUTOMATIC_DISABLED"
  | "HOLIDAY"
  | "ALREADY_SENT"
  | "NO_TARGET"
  | "INVALID_TARGET"
  | "NO_SLOT"
  | "NO_ATTENDANCE_ACTIVITY"
  | "NOT_SCHEDULABLE"

export type SendOutcome =
  | { status: "SENT"; logId: string }
  | { status: "SKIPPED"; reason: SkipReason; detail: string }
  | { status: "FAILED"; code: WhatsAppErrorCode; message: string; logId: string | null }

/**
 * Susun teks pesan untuk satu kartu dan satu tanggal sekolah.
 *
 * Memakai sumber data yang sama dengan halaman /laporan-whatsapp, sehingga
 * angka yang dikirim ke grup tidak mungkin berbeda dari angka di layar.
 */
export async function composeMessage(
  message: WhatsAppMessageRow,
  date: SchoolDate,
  slot: string,
): Promise<string> {
  // Kartu bawaan yang dipicu peristiwa membawa teksnya sendiri (dirender
  // pemanggil dari data peristiwa) dan tidak pernah sampai ke sini.
  if (
    message.kind !== "BUILTIN" ||
    !message.builtinType ||
    message.builtinType === "EUKS_VISIT_NOTIFICATION"
  ) {
    // Kartu manual membawa teksnya sendiri dan tidak pernah sampai ke sini;
    // kartu buatan admin belum dapat dibuat lewat jalur mana pun pada tahap
    // ini. Gagal keras lebih baik daripada mengirim teks kosong ke grup.
    throw new Error(`Kartu pesan ${message.id} tidak menyusun teks otomatis`)
  }

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
  const templateKey = templateKeyFor(message.builtinType, classes)
  const stored = parseStoredTemplates(message.messageTemplates)

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
  /** Kartu pesan yang mengirim. */
  messageId: string
  /** Slot `HH:mm` untuk kiriman terjadwal; NULL untuk manual. */
  slot: string | null
  /** SCHEDULED dijaga idempoten; MANUAL sengaja boleh diulang operator. */
  trigger: "SCHEDULED" | "MANUAL"
  initiatedById?: string | null
  date?: SchoolDate
  /**
   * Penerima perorangan, menggantikan grup tujuan kartu.
   *
   * Dipakai notifikasi kunjungan UKS: penerimanya adalah wali kelas siswa yang
   * bersangkutan, jadi tujuannya ditentukan peristiwa, bukan konfigurasi kartu.
   * Bila diisi, resolusi grup TIDAK dijalankan — menjatuhkannya kembali ke grup
   * sekolah akan menyiarkan data kesehatan seorang siswa ke seluruh guru.
   */
  recipient?: { jid: string; name: string }
  /**
   * Teks persis untuk kartu "Pesan manual".
   *
   * Dikirim APA ADANYA. Tidak ada header, penanda "[MANUAL]", stempel waktu,
   * nama pengirim, atau tautan yang ditambahkan: admin menulis pesan untuk
   * dibaca orang di grup, dan sisipan otomatis mengubah pesan yang ia setujui.
   */
  text?: string
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
  const message = await readMessage(request.messageId)

  if (request.trigger === "SCHEDULED" && !isSchedulable(message)) {
    // Kartu manual tidak punya occurrence: memaksanya lewat jalur terjadwal
    // akan menulis klaim idempotensi untuk sesuatu yang tidak pernah dijadwalkan.
    return {
      status: "SKIPPED",
      reason: "NOT_SCHEDULABLE",
      detail: "Kartu pesan ini tidak dapat dijadwalkan.",
    }
  }

  if (request.trigger === "SCHEDULED" && !message.enabled) {
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

  const target: TargetState = request.recipient
    ? { status: "RESOLVED", jid: request.recipient.jid, name: request.recipient.name }
    : resolveDestination(
        destinationOf(message),
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

  const slot = request.slot ?? message.slots[0] ?? null
  if (request.trigger === "SCHEDULED" && !slot) {
    return {
      status: "SKIPPED",
      reason: "NO_SLOT",
      detail: "Jadwal pengiriman belum diatur untuk kartu pesan ini.",
    }
  }

  // TEKS MANUAL DIKIRIM APA ADANYA.
  //
  // Kartu manual tidak punya template dan tidak boleh melewati renderer:
  // placeholder yang kebetulan ditulis admin (`{tanggal}`) adalah teks biasa
  // baginya, dan merendernya akan mengubah pesan yang ia setujui di layar.
  //
  // Aturan yang sama berlaku bagi pesan berbasis peristiwa (notifikasi
  // kunjungan UKS): teksnya sudah dirender pemanggil dari template kartu
  // beserta data kunjungan, dan merendernya kembali di sini hanya akan
  // memindai ulang isi keluhan yang ditulis manusia.
  const messageText =
    request.text !== undefined
      ? request.text
      : message.kind === "MANUAL"
        ? ""
        : await composeMessage(message, date, slot ?? "")

  if (messageText.trim().length === 0) {
    throw new Error("Teks pesan tidak boleh kosong.")
  }

  // GUARD AKTIVITAS ABSENSI DIJALANKAN SETELAH KLAIM-KLAIM MURAH, SEBELUM KIRIM.
  //
  // Verdict-nya bisa berubah dalam masa grace 20 menit: jam 07.00 belum ada
  // kelas yang mengisi, jam 07.15 sudah. Karena itu keputusannya dicatat
  // sebagai baris SKIPPED ber-idempotencyKey — occurrence-nya dipakai habis,
  // sehingga tick berikutnya tidak mengirim laporan untuk hari yang, menurut
  // pemeriksaan pertama, memang tidak berjalan.
  if (request.trigger === "SCHEDULED" && message.requireAttendanceActivity) {
    const decision = attendanceActivityDecision({
      trigger: request.trigger,
      required: message.requireAttendanceActivity,
      hasActivity: await hasAttendanceActivity(date),
    })
    if (decision.blocked) {
      await recordLog({
        request,
        slot: slot!,
        date,
        idempotencyKey: messageIdempotencyKey(message, date, slot!),
        target,
        messageText,
        status: "SKIPPED",
        errorCode: decision.reason,
        errorMessage: decision.detail,
      })
      return { status: "SKIPPED", reason: "NO_ATTENDANCE_ACTIVITY", detail: decision.detail }
    }
  }

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
      slot: slot!,
      date,
      idempotencyKey: messageIdempotencyKey(message, date, slot!),
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

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
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
  slot: string | null
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
  const message = await readMessage(input.request.messageId)
  try {
    const log = await prisma.whatsAppSendLog.create({
      data: {
        messageId: message.id,
        // Kolom `type` legacy tetap diisi untuk kartu bawaan TERJADWAL selama
        // riwayat lama dan kolomnya belum dipensiunkan; kartu tanpa padanan
        // enum menulis NULL, bukan nilai enum yang mengada-ada.
        //
        // KARTU BAWAAN BERBASIS PERISTIWA JUGA MENULIS NULL.
        //
        // `type` masih ber-foreign-key ke `WhatsAppConfiguration.type`, dan
        // tabel itu hanya berisi jenis TERJADWAL — ia memang tabel jadwal.
        // Menulis enum jenis yang tidak punya baris jadwal di sana membuat
        // setiap pengiriman notifikasi UKS ditolak database sebagai
        // pelanggaran FK, lalu muncul di layar sebagai kegagalan layanan
        // WhatsApp — padahal transport-nya sehat dan pesannya sudah terkirim.
        type: legacyLogTypeFor(message),
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
  messageId: string
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
  const [logs, messages] = await Promise.all([
    prisma.whatsAppSendLog.findMany({
      where: { schoolDate: toPrismaDate(date), trigger: "SCHEDULED" },
      orderBy: { attemptedAt: "desc" },
    }),
    readMessages(),
  ])

  const statuses: ScheduleSlotStatus[] = []
  // Urutan mengikuti urutan kartu di layar: daftar jadwal dan daftar kartu
  // tidak boleh tampil dalam urutan yang berbeda.
  for (const message of messages) {
    if (!isSchedulable(message)) continue
    for (const slot of message.slots) {
      const log = logs.find(
        (entry) => entry.messageId === message.id && entry.scheduledSlot === slot,
      )
      statuses.push({
        messageId: message.id,
        label: message.title,
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
      messageId: true,
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
      // Judul kartu ikut dibaca agar riwayat tetap terbaca untuk kartu yang
      // tidak punya padanan enum.
      message: { select: { title: true } },
      initiatedBy: { select: { name: true, email: true } },
    },
  })
}
