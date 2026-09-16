import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { withoutQr, workerStatus } from "@/lib/server-whatsapp-worker-client"
import { readScheduleStatus, readSendHistory } from "@/lib/server-whatsapp"
import { todayInSchoolTimeZone } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { requireWhatsAppViewer } from "@/lib/whatsapp-access"
import { errorMessageFor, type WhatsAppStatus } from "@/lib/whatsapp-transport"

/**
 * Status koneksi, jadwal hari ini, dan histori pengiriman.
 *
 * Worker adalah satu-satunya pemilik koneksi; route ini hanya bertanya. Bila
 * worker sedang mati, statusnya dilaporkan sebagai error yang bisa dibaca
 * operator — bukan 500 tanpa penjelasan, karena "worker mati" adalah kondisi
 * operasional yang wajar dan harus terlihat di layar.
 */
export async function GET() {
  try {
    await requireWhatsAppViewer()

    const timeZone = await readSchoolTimeZone()
    const today = todayInSchoolTimeZone(new Date(), timeZone)

    const [status, schedule, history] = await Promise.all([
      workerStatus().catch((error: unknown): WhatsAppStatus => {
        // Detail teknis (ECONNREFUSED, URL worker, stack) hanya untuk log
        // server. Browser hanya menerima kode + kalimat kanonik, mengikuti
        // kontrak lastError yang sama dengan status dari worker.
        console.error("[whatsapp] status worker tidak terbaca:", error)
        return {
          state: "ERROR",
          phoneNumber: null,
          displayName: null,
          connectedSince: null,
          lastDisconnectedAt: null,
          lastDisconnectReason: null,
          lastDisconnectCategory: null,
          lastError: {
            code: "WORKER_UNREACHABLE",
            message: errorMessageFor("WORKER_UNREACHABLE"),
          },
          sessionExists: false,
          qr: null,
          lastHeartbeatAt: null,
        }
      }),
      readScheduleStatus(today),
      readSendHistory(50),
    ])

    const safeStatus = withoutQr(status)

    return NextResponse.json(
      { status: safeStatus, schedule, history, today, timeZone },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Status WhatsApp gagal dimuat")
  }
}
