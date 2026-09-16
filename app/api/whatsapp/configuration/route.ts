import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import {
  defaultDestinationOf,
  destinationOf,
  readConfiguration,
  readConfigurations,
  readWhatsAppSetting,
  updateConfiguration,
  updateDefaultDestination,
} from "@/lib/server-whatsapp"
import { workerGroups } from "@/lib/server-whatsapp-worker-client"
import { WHATSAPP_MESSAGE_TYPES, scheduleFor } from "@/lib/whatsapp-schedule"
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

const patchSchema = z.object({
  type: z.enum(WHATSAPP_MESSAGE_TYPES as unknown as [string, ...string[]]),
  enabled: z.boolean().optional(),
  destinationMode: z.enum(["DEFAULT", "OVERRIDE"]).optional(),
  destination: destinationSchema.nullable().optional(),
})

const defaultSchema = z.object({
  scope: z.literal("default"),
  destination: destinationSchema.nullable(),
})

/** Konfigurasi tiap jenis pesan, setelan default, plus daftar grup. */
export async function GET() {
  try {
    await requireWhatsAppViewer()

    const [configurations, setting] = await Promise.all([
      readConfigurations(),
      readWhatsAppSetting(),
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
        configurations,
        groups,
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

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Perubahan konfigurasi tidak valid." },
        { status: 400 },
      )
    }

    const type = parsed.data.type as (typeof WHATSAPP_MESSAGE_TYPES)[number]
    const before = await readConfiguration(type)

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
    const nextConfiguration = {
      ...before,
      destinationMode: parsed.data.destinationMode ?? before.destinationMode,
      targetGroupJid: targetGroupJid === undefined ? before.targetGroupJid : targetGroupJid,
      targetGroupName: targetGroupName === undefined ? before.targetGroupName : targetGroupName,
    }

    // Penjagaan ini WAJIB ada di server. UI menampilkan alasannya lebih awal,
    // tetapi UI bukan penjaga: permintaan dapat datang dari mana saja.
    if (parsed.data.enabled === true) {
      const block = automaticBlockFor(
        destinationOf(nextConfiguration),
        defaultDestinationOf(await readWhatsAppSetting()),
      )
      if (block) {
        return NextResponse.json({ message: AUTOMATIC_BLOCK_MESSAGES[block] }, { status: 409 })
      }
    }

    const after = await updateConfiguration(type, {
      enabled: parsed.data.enabled,
      destinationMode: parsed.data.destinationMode,
      targetGroupJid,
      targetGroupName,
    })

    await recordAuditLog({
      actorId: context.user.id,
      action: "WHATSAPP_SCHEDULE_TOGGLED",
      entity: "WhatsAppConnection",
      entityId: type,
      summary: `Konfigurasi ${scheduleFor(type).label} diubah`,
      before: {
        enabled: before.enabled,
        destinationMode: before.destinationMode,
        targetGroupName: before.targetGroupName,
      },
      after: {
        enabled: after.enabled,
        destinationMode: after.destinationMode,
        targetGroupName: after.targetGroupName,
      },
    })

    return NextResponse.json(
      { configuration: after },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Konfigurasi WhatsApp gagal disimpan")
  }
}
