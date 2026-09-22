import { NextResponse } from "next/server"
import { z } from "zod"
import { normalizeSlots, slotsErrorMessage } from "@/lib/whatsapp-slot-config"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import {
  defaultDestinationOf,
  destinationOf,
  readBuiltinMessage,
  readMessage,
  readMessages,
  readSchoolName,
  readWhatsAppSetting,
  updateMessage,
  updateDefaultDestination,
  updateMessageTemplates,
} from "@/lib/server-whatsapp"
import {
  TEMPLATE_KEYS,
  templateErrorMessage,
  validateTemplate,
  type WhatsAppTemplate,
} from "@/lib/whatsapp-template"
import {
  customizedKeys,
  serializeTemplates,
  type StoredTemplates,
} from "@/lib/whatsapp-template-store"
import { workerGroups } from "@/lib/server-whatsapp-worker-client"
import { WHATSAPP_MESSAGE_TYPES } from "@/lib/whatsapp-schedule"
import { WhatsAppSendError, type WhatsAppGroup } from "@/lib/whatsapp-transport"
import {
  AUTOMATIC_BLOCK_MESSAGES,
  automaticBlockFor,
  isGroupJid,
} from "@/lib/whatsapp-target"
import {
  requireWhatsAppConnectionManager,
  requireWhatsAppViewer,
} from "@/lib/whatsapp-access"

/**
 * Tujuan dipilih dengan JID, bukan nama.
 *
 * Nama grup dapat berubah dan dapat kembar; JID tidak. Menerima nama berarti
 * menerjemahkan ulang setiap kali menyimpan, dan terjemahan yang salah mengirim
 * rekap absensi siswa ke grup yang keliru.
 */
const destinationSchema = z.object({
  jid: z.string().trim().refine(isGroupJid, "JID grup tidak valid"),
  name: z.string().trim().min(1).optional(),
})

/**
 * Kartu ditunjuk dengan `messageId`.
 *
 * `type` masih diterima sebagai penunjuk kartu BAWAAN supaya pemanggil lama
 * (dan uji yang menjaga perilakunya) tidak patah di tengah peralihan; ia
 * diterjemahkan ke `messageId` di satu tempat, bukan menjadi jalur kedua.
 */
const patchSchema = z.object({
  messageId: z.string().min(1).optional(),
  type: z.enum(WHATSAPP_MESSAGE_TYPES as unknown as [string, ...string[]]).optional(),
  enabled: z.boolean().optional(),
  /**
   * Penjagaan "hanya kirim saat ada aktivitas absensi".
   *
   * Disimpan per kartu, bukan sebagai setelan global: satu sekolah dapat
   * menghendaki pengingat absensi berhenti pada hari tanpa kegiatan sementara
   * rekap lain tetap berjalan.
   */
  requireAttendanceActivity: z.boolean().optional(),
  destinationMode: z.enum(["DEFAULT", "OVERRIDE"]).optional(),
  destination: destinationSchema.nullable().optional(),
  slots: z.array(z.string()).optional(),
})

const defaultSchema = z.object({
  scope: z.literal("default"),
  destination: destinationSchema.nullable(),
})

/**
 * Penyuntingan template pesan.
 *
 * `templates: null` berarti "kembalikan seluruh template jenis ini ke bawaan".
 * Dibedakan dari objek kosong supaya reset menjadi tindakan eksplisit, bukan
 * efek samping dari mengirim badan kosong.
 */
const templatesSchema = z.object({
  scope: z.literal("templates"),
  messageId: z.string().min(1).optional(),
  type: z.enum(WHATSAPP_MESSAGE_TYPES as unknown as [string, ...string[]]).optional(),
  templates: z
    .record(
      z.string(),
      z.object({
        body: z.string(),
        items: z
          .record(
            z.string(),
            z.object({
              format: z.string(),
              separator: z.enum(["NEWLINE", "BLANK_LINE"]),
            }),
          )
          .default({}),
      }),
    )
    .nullable(),
})

/** Konfigurasi tiap jenis pesan, setelan default, plus daftar grup. */
export async function GET() {
  try {
    await requireWhatsAppViewer()

    const [messages, setting, schoolName] = await Promise.all([
      readMessages(),
      readWhatsAppSetting(),
      // Nama sekolah ikut dikirim agar PRATINJAU memakai identitas sekolah yang
      // sebenarnya. Isi siswa boleh berupa contoh — bentuk pesanlah yang sedang
      // ditinjau — tetapi nama sekolah yang salah di pratinjau membuat admin
      // menyunting template untuk memperbaiki sesuatu yang bukan template.
      readSchoolName(),
    ])

    // Daftar grup hanya bisa dibaca saat WhatsApp terhubung. Keadaan "belum
    // terhubung" adalah hal normal dan dilewati diam-diam; kegagalan LAIN
    // tetap dicatat agar masalah nyata tidak tersembunyi. Dalam kedua kasus
    // konfigurasi tetap harus bisa dilihat, jadi halaman tidak ikut gagal.
    //
    // `null` berarti "daftar tidak diketahui saat ini", BUKAN "tidak ada grup".
    // Bedanya menentukan: layar tidak boleh menghapus pilihan tersimpan hanya
    // karena satu kali pengambilan gagal.
    const groups = await workerGroups()
      .then((result): WhatsAppGroup[] | null => result.groups)
      .catch((error) => {
        const code = error instanceof WhatsAppSendError ? error.code : "UNKNOWN"
        if (code !== "NOT_CONNECTED") {
          console.error(`[whatsapp] daftar grup gagal dimuat: ${code}`)
        }
        return null
      })

    return NextResponse.json(
      {
        messages,
        groups,
        schoolName,
        defaultDestination: {
          jid: setting.defaultGroupJid,
          name: setting.defaultGroupName,
          resolvedAt: setting.defaultGroupResolvedAt,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Konfigurasi WhatsApp gagal dimuat")
  }
}

/**
 * Ubah grup tujuan default, atau konfigurasi satu jenis pesan.
 *
 * Menuntut izin kelola koneksi, bukan sekadar izin baca: mengaktifkan jadwal
 * atau memindahkan tujuan berarti menentukan ke mana pesan sekolah dikirim.
 */
export async function PATCH(request: Request) {
  try {
    const context = await requireWhatsAppConnectionManager()
    const body = await request.json()

    // Grup tujuan default: satu baris setelan, berlaku lintas jenis pesan.
    const asDefault = defaultSchema.safeParse(body)
    if (asDefault.success) {
      const before = await readWhatsAppSetting()
      const after = await updateDefaultDestination({
        jid: asDefault.data.destination?.jid ?? null,
        name: asDefault.data.destination?.name ?? null,
      })

      await recordAuditLog({
        actorId: context.user.id,
        action: "WHATSAPP_SCHEDULE_TOGGLED",
        entity: "WhatsAppConnection",
        entityId: "default",
        summary: "Grup tujuan default diubah",
        before: { defaultGroupName: before.defaultGroupName },
        after: { defaultGroupName: after.defaultGroupName },
      })

      return NextResponse.json(
        {
          defaultDestination: {
            jid: after.defaultGroupJid,
            name: after.defaultGroupName,
            resolvedAt: after.defaultGroupResolvedAt,
          },
        },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    }

    // Template pesan. Divalidasi di server juga, bukan hanya di layar: layar
    // dapat dilewati, dan template dengan variabel salah ketik akan mengirim
    // teks rusak ke grup sekolah setiap hari sampai ada yang menyadarinya.
    const asTemplates = templatesSchema.safeParse(body)
    if (asTemplates.success) {
      const target = asTemplates.data.messageId
        ? await readMessage(asTemplates.data.messageId)
        : await readBuiltinMessage(
            asTemplates.data.type as (typeof WHATSAPP_MESSAGE_TYPES)[number],
          )

      let stored: StoredTemplates | null = null
      if (asTemplates.data.templates !== null) {
        const candidate: StoredTemplates = {}
        for (const key of TEMPLATE_KEYS) {
          const template = asTemplates.data.templates[key]
          if (!template) continue
          const errors = validateTemplate(key, template as WhatsAppTemplate)
          if (errors.length > 0) {
            return NextResponse.json(
              { message: templateErrorMessage(errors[0]) },
              { status: 400 },
            )
          }
          candidate[key] = template as WhatsAppTemplate
        }
        stored = serializeTemplates(candidate)
      }

      const after = await updateMessageTemplates(target.id, stored)

      await recordAuditLog({
        actorId: context.user.id,
        action: "WHATSAPP_SCHEDULE_TOGGLED",
        entity: "WhatsAppConnection",
        entityId: target.id,
        summary:
          stored === null
            ? "Template pesan dikembalikan ke bawaan"
            : "Template pesan diubah",
        before: null,
        after: { customized: stored === null ? [] : customizedKeys(stored) },
      })

      return NextResponse.json(
        { message: after },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Perubahan konfigurasi tidak valid." },
        { status: 400 },
      )
    }

    // Satu penunjuk kartu, dua cara menyebutnya. Menerjemahkan di sini
    // membuat sisa handler tidak perlu tahu bentuk mana yang dipakai.
    const before = parsed.data.messageId
      ? await readMessage(parsed.data.messageId)
      : parsed.data.type
        ? await readBuiltinMessage(parsed.data.type as (typeof WHATSAPP_MESSAGE_TYPES)[number])
        : null
    if (!before) {
      return NextResponse.json(
        { message: "Kartu pesan tidak disebutkan." },
        { status: 400 },
      )
    }

    const targetGroupJid =
      parsed.data.destination === undefined
        ? undefined
        : (parsed.data.destination?.jid ?? null)
    const targetGroupName =
      parsed.data.destination === undefined
        ? undefined
        : (parsed.data.destination?.name ?? null)

    // Keadaan SETELAH perubahan diperiksa, bukan keadaan sebelumnya: admin
    // boleh memilih grup dan mengaktifkan otomatis dalam satu permintaan.
    const nextMessage = {
      ...before,
      destinationMode: parsed.data.destinationMode ?? before.destinationMode,
      targetGroupJid: targetGroupJid === undefined ? before.targetGroupJid : targetGroupJid,
      targetGroupName: targetGroupName === undefined ? before.targetGroupName : targetGroupName,
    }

    // Penjagaan ini WAJIB ada di server. UI menampilkan alasannya lebih awal,
    // tetapi UI bukan penjaga: permintaan dapat datang dari mana saja.
    if (parsed.data.enabled === true) {
      const block = automaticBlockFor(
        destinationOf(nextMessage),
        defaultDestinationOf(await readWhatsAppSetting()),
      )
      if (block) {
        return NextResponse.json({ message: AUTOMATIC_BLOCK_MESSAGES[block] }, { status: 409 })
      }
    }

    // Normalisasi dijalankan ulang di server memakai fungsi yang sama dengan
    // UI. Klien bukan penjaga: permintaan bisa datang tanpa melewati layar.
    let slots: string[] | undefined
    if (parsed.data.slots !== undefined) {
      const normalized = normalizeSlots(parsed.data.slots)
      if (!normalized.ok) {
        return NextResponse.json({ message: slotsErrorMessage(normalized.error) }, { status: 400 })
      }
      slots = normalized.slots
    }

    const after = await updateMessage(before.id, {
      enabled: parsed.data.enabled,
      requireAttendanceActivity: parsed.data.requireAttendanceActivity,
      destinationMode: parsed.data.destinationMode,
      targetGroupJid,
      targetGroupName,
      slots,
    })

    await recordAuditLog({
      actorId: context.user.id,
      action: "WHATSAPP_SCHEDULE_TOGGLED",
      entity: "WhatsAppConnection",
      entityId: before.id,
      summary: `Konfigurasi ${before.title} diubah`,
      before: {
        enabled: before.enabled,
        requireAttendanceActivity: before.requireAttendanceActivity,
        destinationMode: before.destinationMode,
        targetGroupName: before.targetGroupName,
        slots: before.slots,
      },
      after: {
        enabled: after.enabled,
        requireAttendanceActivity: after.requireAttendanceActivity,
        destinationMode: after.destinationMode,
        targetGroupName: after.targetGroupName,
        slots: after.slots,
      },
    })

    return NextResponse.json(
      { message: after },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Konfigurasi WhatsApp gagal disimpan")
  }
}
