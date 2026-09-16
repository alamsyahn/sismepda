import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { recordAuditLog, type AuditAction } from "@/lib/audit-log"
import {
  workerConnect,
  workerLogout,
  workerReconnect,
  workerRelogin,
  workerStatus,
  withoutQr,
} from "@/lib/server-whatsapp-worker-client"
import { requireWhatsAppConnectionManager } from "@/lib/whatsapp-access"
import type { WhatsAppConnectionAction } from "@/lib/whatsapp-transport"

const bodySchema = z.object({
  action: z.enum(["connect", "reconnect", "relogin", "logout"]),
})

/**
 * Setiap aksi dicatat ke jejak audit yang sama dengan fitur lain. Logout
 * khususnya: ia menghapus sesi dan menghentikan seluruh pengiriman otomatis
 * sampai ada yang memindai QR kembali, jadi harus selalu jelas siapa yang
 * melakukannya.
 */
const AUDIT_ACTIONS: Record<WhatsAppConnectionAction, AuditAction> = {
  connect: "WHATSAPP_CONNECTION_STARTED",
  reconnect: "WHATSAPP_CONNECTION_RECONNECTED",
  // Login ulang membuang kredensial lama sebelum meminta QR baru; secara
  // akibat ia sedestruktif logout dan dicatat dengan aksi yang sama.
  relogin: "WHATSAPP_LOGGED_OUT",
  logout: "WHATSAPP_LOGGED_OUT",
}

const SUMMARIES: Record<WhatsAppConnectionAction, string> = {
  connect: "Memulai koneksi WhatsApp",
  reconnect: "Menyambung ulang koneksi WhatsApp",
  relogin: "Menghapus sesi lama dan meminta QR baru",
  logout: "Keluar dari akun WhatsApp dan menghapus sesi",
}

const RUNNERS: Record<WhatsAppConnectionAction, () => ReturnType<typeof workerStatus>> = {
  connect: workerConnect,
  reconnect: workerReconnect,
  relogin: workerRelogin,
  logout: workerLogout,
}

export async function POST(request: Request) {
  try {
    const context = await requireWhatsAppConnectionManager()

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Aksi koneksi tidak dikenal." },
        { status: 400 },
      )
    }

    const { action } = parsed.data
    const before = await workerStatus().catch(() => null)

    const status = await RUNNERS[action]()

    await recordAuditLog({
      actorId: context.user.id,
      action: AUDIT_ACTIONS[action],
      entity: "WhatsAppConnection",
      entityId: "default",
      summary: SUMMARIES[action],
      // Nomor dan status saja. Kredensial sesi tidak pernah masuk jejak audit.
      before: before
        ? { state: before.state, phoneNumber: before.phoneNumber }
        : null,
      after: { state: status.state, phoneNumber: status.phoneNumber },
    })

    const safeStatus = withoutQr(status)
    return NextResponse.json(
      { status: safeStatus },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error, "Aksi koneksi WhatsApp gagal")
  }
}
