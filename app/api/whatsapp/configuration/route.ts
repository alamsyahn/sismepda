import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { readConfiguration, readConfigurations, updateConfiguration } from "@/lib/server-whatsapp"
import { workerGroups, workerResolveTarget } from "@/lib/server-whatsapp-worker-client"
import { WHATSAPP_MESSAGE_TYPES, scheduleFor } from "@/lib/whatsapp-schedule"
import { WhatsAppSendError } from "@/lib/whatsapp-transport"
import {
  requireWhatsAppConnectionManager,
  requireWhatsAppViewer,
} from "@/lib/whatsapp-access"

const patchSchema = z.object({
  type: z.enum(WHATSAPP_MESSAGE_TYPES as unknown as [string, ...string[]]),
  enabled: z.boolean().optional(),
  targetGroupName: z.string().trim().min(1).optional(),
})

/** Konfigurasi tiap jenis pesan, plus daftar grup bila worker terhubung. */
export async function GET() {
  try {
    await requireWhatsAppViewer()

    const configurations = await readConfigurations()
    // Daftar grup hanya bisa dibaca saat WhatsApp terhubung. Keadaan "belum
    // terhubung" adalah hal normal dan dilewati diam-diam; kegagalan LAIN
    // tetap dicatat agar masalah nyata tidak tersembunyi. Dalam kedua kasus
    // konfigurasi tetap harus bisa dilihat, jadi halaman tidak ikut gagal.
    const groups = await workerGroups()
      .then((result) => result.groups)
      .catch((error) => {
        const code = error instanceof WhatsAppSendError ? error.code : "UNKNOWN"
        if (code !== "NOT_CONNECTED") {
          console.error(`[whatsapp] daftar grup gagal dimuat: ${code}`)
        }
        return null
      })

    return NextResponse.json(
      { configurations, groups },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Konfigurasi WhatsApp gagal dimuat")
  }
}

/**
 * Ubah toggle otomatis atau grup tujuan.
 *
 * Menuntut izin kelola koneksi, bukan sekadar izin baca: mengaktifkan jadwal
 * atau memindahkan tujuan berarti menentukan ke mana pesan sekolah dikirim.
 */
export async function PATCH(request: Request) {
  try {
    const context = await requireWhatsAppConnectionManager()

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Perubahan konfigurasi tidak valid." },
        { status: 400 },
      )
    }

    const type = parsed.data.type as (typeof WHATSAPP_MESSAGE_TYPES)[number]
    const before = await readConfiguration(type)

    let targetGroupJid: string | null | undefined
    let targetGroupName: string | null | undefined

    if (parsed.data.targetGroupName !== undefined) {
      const resolution = await workerResolveTarget(parsed.data.targetGroupName)

      // Nama kembar tidak diselesaikan diam-diam dengan mengambil yang pertama:
      // salah pilih berarti rekap absensi siswa masuk ke grup yang keliru.
      if (resolution.status === "AMBIGUOUS") {
        return NextResponse.json(
          {
            message: `Ada lebih dari satu grup bernama "${resolution.searchedName}". Ganti nama salah satunya agar tujuan tidak ambigu.`,
          },
          { status: 409 },
        )
      }
      if (resolution.status === "NOT_FOUND") {
        return NextResponse.json(
          {
            message: `Grup "${resolution.searchedName}" tidak ditemukan. Pastikan akun WhatsApp sekolah sudah menjadi anggota grup tersebut.`,
          },
          { status: 404 },
        )
      }

      targetGroupJid = resolution.jid
      targetGroupName = resolution.name
    }

    const after = await updateConfiguration(type, {
      enabled: parsed.data.enabled,
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
        targetGroupName: before.targetGroupName,
      },
      after: {
        enabled: after.enabled,
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
