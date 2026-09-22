import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { readBuiltinMessage, readMessage } from "@/lib/server-whatsapp"
import { workerSend } from "@/lib/server-whatsapp-worker-client"
import { WHATSAPP_MESSAGE_TYPES } from "@/lib/whatsapp-schedule"
import { requireWhatsAppSender } from "@/lib/whatsapp-access"

/**
 * Penanda slot untuk kiriman manual.
 *
 * Bukan jam: kiriman manual tidak menempati slot jadwal mana pun, dan
 * `trigger: "MANUAL"` di worker sudah memastikan `idempotencyKey` bernilai
 * NULL sehingga operator tetap boleh mengulang.
 */
const MANUAL_SLOT = "MANUAL"

/**
 * Kartu ditunjuk dengan `messageId`; `type` masih diterima untuk kartu bawaan
 * selama peralihan, diterjemahkan di satu tempat.
 *
 * `text` hanya bermakna bagi kartu manual. Batas panjangnya mengikuti batas
 * praktis satu pesan WhatsApp — menolaknya di sini memberi admin pesan
 * kesalahan yang jelas, alih-alih kegagalan transport yang tidak bisa ia baca.
 */
const bodySchema = z.object({
  messageId: z.string().min(1).optional(),
  type: z.enum(WHATSAPP_MESSAGE_TYPES as unknown as [string, ...string[]]).optional(),
  text: z.string().max(4096).optional(),
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
      return NextResponse.json({ message: "Permintaan kirim tidak valid." }, { status: 400 })
    }

    const message = parsed.data.messageId
      ? await readMessage(parsed.data.messageId)
      : parsed.data.type
        ? await readBuiltinMessage(parsed.data.type as (typeof WHATSAPP_MESSAGE_TYPES)[number])
        : null
    if (!message) {
      return NextResponse.json({ message: "Kartu pesan tidak dikenal." }, { status: 400 })
    }

    // TEKS WAJIB DAN TIDAK BOLEH HANYA SPASI, DIPERIKSA DI SERVER.
    //
    // Tombol di layar sudah dinonaktifkan untuk textarea kosong, tetapi tombol
    // bukan penjaga: permintaan dapat datang tanpa melewati layar, dan pesan
    // kosong yang sampai ke grup sekolah tidak dapat ditarik kembali.
    if (message.kind === "MANUAL" && (parsed.data.text ?? "").trim().length === 0) {
      return NextResponse.json({ message: "Tulis isi pesan lebih dulu." }, { status: 400 })
    }

    // Slot dikirim sebagai label MANUAL, bukan jam jadwal mana pun. Satu kartu
    // dapat memiliki beberapa slot (08:00 dan 10:00), dan meminjam salah
    // satunya akan membuat kiriman manual terlihat seperti kiriman terjadwal
    // di kartu jadwal maupun di histori.
    const outcome = await workerSend({
      messageId: message.id,
      slot: MANUAL_SLOT,
      // Diteruskan apa adanya: tanpa trim, tanpa penanda, tanpa header.
      // Newline dan format WhatsApp yang ditulis admin harus utuh.
      text: message.kind === "MANUAL" ? parsed.data.text : undefined,
      initiatedById: context.user.id,
    })

    // Dicatat apa pun hasilnya. Percobaan kirim yang gagal atau dilewati sama
    // pentingnya untuk ditelusuri seperti yang berhasil.
    await recordAuditLog({
      actorId: context.user.id,
      action: "WHATSAPP_MESSAGE_SENT_MANUALLY",
      entity: "WhatsAppSendLog",
      entityId: message.id,
      summary: `Kirim manual: ${message.title}`,
      after: {
        messageId: message.id,
        title: message.title,
        // Grup tujuan dicatat agar audit menjawab "ke mana pesan ini dikirim",
        // bukan hanya "siapa yang menekan tombol".
        targetGroupName: message.targetGroupName,
        destinationMode: message.destinationMode,
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
