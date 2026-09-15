import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { workerStatus } from "@/lib/server-whatsapp-worker-client"
import { requireWhatsAppConnectionManager } from "@/lib/whatsapp-access"

/**
 * Kode QR pairing.
 *
 * Dipisah dari endpoint status dan dijaga izin KELOLA KONEKSI, bukan izin
 * baca: siapa pun yang memindai QR ini menautkan perangkatnya ke akun WhatsApp
 * sekolah. Ia tidak boleh ikut terbawa dalam payload status yang dilihat semua
 * pemegang `whatsapp.read`.
 *
 * QR tidak pernah disimpan ke database; ia hidup di memori worker dan
 * kedaluwarsa sendiri.
 */
export async function GET() {
  try {
    await requireWhatsAppConnectionManager()

    const status = await workerStatus()

    return NextResponse.json(
      { qr: status.qr, state: status.state },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Kode QR gagal dimuat")
  }
}
