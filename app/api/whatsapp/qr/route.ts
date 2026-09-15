import { NextResponse } from "next/server"
import QRCode from "qrcode"

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
 *
 * Yang dikirim ke browser adalah GAMBAR (data URL PNG), bukan payload mentah.
 * Payload mentah tidak dapat dipindai oleh WhatsApp, dan menaruhnya di DOM
 * membuatnya mudah tersalin dari layar atau tangkapan layar.
 */
export async function GET() {
  try {
    await requireWhatsAppConnectionManager()

    const status = await workerStatus()

    // Rendering di server, bukan di klien: payload mentah berhenti di sini.
    const qrImage = status.qr
      ? await QRCode.toDataURL(status.qr, { errorCorrectionLevel: "M", margin: 2, width: 288 })
      : null

    return NextResponse.json(
      { qrImage, state: status.state },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Kode QR gagal dimuat")
  }
}
