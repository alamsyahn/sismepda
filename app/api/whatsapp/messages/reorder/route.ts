import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog } from "@/lib/audit-log"
import { moveMessage, readMessages } from "@/lib/server-whatsapp"
import { requireWhatsAppConnectionManager } from "@/lib/whatsapp-access"

/**
 * Pergeseran satu posisi, bukan urutan lengkap.
 *
 * Menerima seluruh daftar dari klien berarti mempercayai klien untuk
 * mengirimkan daftar yang lengkap dan mutakhir; dua admin yang menyusun ulang
 * bersamaan akan saling menimpa diam-diam. Perintah "naikkan kartu ini" selalu
 * dievaluasi terhadap urutan yang benar-benar tersimpan saat itu.
 */
const bodySchema = z.object({
  messageId: z.string().min(1),
  direction: z.enum(["UP", "DOWN"]),
})

/**
 * Susun ulang kartu pesan.
 *
 * Menuntut izin kelola koneksi, sama seperti menyunting jadwal: urutan kartu
 * menentukan apa yang pertama dilihat admin lain di halaman ini.
 */
export async function POST(request: Request) {
  try {
    const context = await requireWhatsAppConnectionManager()

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ message: "Permintaan urutan tidak valid." }, { status: 400 })
    }

    const moved = await moveMessage(parsed.data.messageId, parsed.data.direction)
    if (!moved) {
      // Kartu sudah berada di ujung. Bukan kesalahan — UI menonaktifkan
      // tombolnya — tetapi jawabannya harus jujur bahwa tidak ada yang berubah.
      return NextResponse.json(
        { moved: false, messages: await readMessages() },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    }

    const messages = await readMessages()

    await recordAuditLog({
      actorId: context.user.id,
      action: "WHATSAPP_SCHEDULE_TOGGLED",
      entity: "WhatsAppConnection",
      entityId: parsed.data.messageId,
      summary: "Urutan kartu pesan diubah",
      before: null,
      after: { order: messages.map((row) => row.id) },
    })

    return NextResponse.json(
      { moved: true, messages },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Urutan kartu pesan gagal disimpan")
  }
}
