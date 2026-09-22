import { NextResponse } from "next/server"

import { euksErrorResponse, requireEuksPermission } from "@/lib/euks-access"
import { notifyEuksVisit } from "@/lib/server-euks-notification"

/**
 * Kirim (atau kirim ulang) notifikasi WhatsApp satu kunjungan ke wali kelas.
 *
 * ENDPOINT TERPISAH, BUKAN FLAG PADA PATCH.
 *
 * Mengirim pesan bukan penyuntingan data: ia punya permission sendiri
 * (`euks.visits.notify`), efek yang tidak dapat dibatalkan, dan boleh dilakukan
 * oleh orang yang tidak berhak mengubah isi kunjungan. Menempelkannya ke PATCH
 * berarti siapa pun yang boleh menyunting otomatis boleh mengirim.
 *
 * Konfirmasi "kirim ulang" adalah urusan layar; server sengaja TIDAK menolak
 * kiriman kedua — petugas yang memang perlu mengulang (pesan pertama tenggelam,
 * nomor baru diperbaiki) harus bisa melakukannya.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  try {
    const viewer = await requireEuksPermission("euks.visits.notify")
    const { visitId } = await params
    const outcome = await notifyEuksVisit({ visitId, actorId: viewer.id })
    return NextResponse.json(outcome, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    const { error: message, status } = euksErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
