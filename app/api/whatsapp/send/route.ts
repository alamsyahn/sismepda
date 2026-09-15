import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { workerSend } from "@/lib/server-whatsapp-worker-client"
import { WHATSAPP_MESSAGE_TYPES, scheduleFor } from "@/lib/whatsapp-schedule"
import { requireWhatsAppSender } from "@/lib/whatsapp-access"

/**
 * Penanda slot untuk kiriman manual.
 *
 * Bukan jam: kiriman manual tidak menempati slot jadwal mana pun, dan
 * `trigger: "MANUAL"` di worker sudah memastikan `idempotencyKey` bernilai
 * NULL sehingga operator tetap boleh mengulang.
 */
const MANUAL_SLOT = "MANUAL"

const bodySchema = z.object({
  type: z.enum(WHATSAPP_MESSAGE_TYPES as unknown as [string, ...string[]]),
})

/**
 * "Kirim sekarang".
 *
 * Pengiriman dilakukan worker, bukan route ini: hanya worker yang memegang
 * koneksi WhatsApp. Route ini bertugas memastikan pemanggilnya berwenang,
 * mencatatnya, dan menerjemahkan hasilnya.
 *
 * Kiriman manual sengaja TIDAK idempoten — operator yang menekan tombol dua
 * kali memang bermaksud mengirim dua kali (mis. pesan pertama tenggelam di
 * grup). Penjagaan anti-duplikat hanya berlaku bagi scheduler.
 */
export async function POST(request: Request) {
  try {
    const context = await requireWhatsAppSender()

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Jenis pesan tidak dikenal." },
        { status: 400 },
      )
    }

    const type = parsed.data.type as (typeof WHATSAPP_MESSAGE_TYPES)[number]
    const definition = scheduleFor(type)

    // Slot dikirim sebagai label MANUAL, bukan jam jadwal mana pun. Satu jenis
    // pesan dapat memiliki beberapa slot (08:00 dan 10:00), dan meminjam salah
    // satunya akan membuat kiriman manual terlihat seperti kiriman terjadwal
    // di kartu jadwal maupun di histori.
    const outcome = await workerSend({
      type,
      slot: MANUAL_SLOT,
      initiatedById: context.user.id,
    })

    // Dicatat apa pun hasilnya. Percobaan kirim yang gagal atau dilewati sama
    // pentingnya untuk ditelusuri seperti yang berhasil.
    await recordAuditLog({
      actorId: context.user.id,
      action: "WHATSAPP_MESSAGE_SENT_MANUALLY",
      entity: "WhatsAppSendLog",
      entityId: type,
      summary: `Kirim manual: ${definition.label}`,
      after: {
        type,
        slot: MANUAL_SLOT,
        outcome: outcome.status,
        reason: outcome.reason ?? outcome.code ?? null,
      },
    })

    return NextResponse.json(outcome, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return authFailureResponse(error, "Pengiriman WhatsApp gagal")
  }
}
