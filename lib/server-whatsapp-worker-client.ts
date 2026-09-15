/**
 * Klien HTTP ke worker WhatsApp.
 *
 * Next.js TIDAK PERNAH membuka soket Baileys sendiri; ia hanya bertanya kepada
 * worker. Inilah yang menjaga agar hanya ada satu koneksi WhatsApp, berapa pun
 * jumlah request atau render yang terjadi.
 */
import "server-only"

import {
  WhatsAppSendError,
  type WhatsAppGroup,
  type WhatsAppStatus,
} from "@/lib/whatsapp-transport"

const BASE_URL = process.env.WHATSAPP_WORKER_URL ?? "http://whatsapp-worker:3100"
const TOKEN = process.env.WHATSAPP_WORKER_TOKEN ?? ""
/** Worker bisa sedang menyambung ulang; menunggu selamanya membekukan UI. */
const TIMEOUT_MS = 10_000

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    })
    if (!response.ok) throw new WhatsAppSendError("WORKER_UNREACHABLE")
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof WhatsAppSendError) throw error
    // Worker mati, jaringan Docker putus, atau timeout — bagi admin semuanya
    // berarti hal yang sama: layanan sedang tidak dapat dihubungi.
    throw new WhatsAppSendError("WORKER_UNREACHABLE", error)
  } finally {
    clearTimeout(timer)
  }
}

export function workerStatus(): Promise<WhatsAppStatus> {
  return call<WhatsAppStatus>("/status")
}

export function workerConnect(): Promise<WhatsAppStatus> {
  return call<WhatsAppStatus>("/connect", { method: "POST" })
}

export function workerReconnect(): Promise<WhatsAppStatus> {
  return call<WhatsAppStatus>("/reconnect", { method: "POST" })
}

export function workerLogout(): Promise<WhatsAppStatus> {
  return call<WhatsAppStatus>("/logout", { method: "POST" })
}

export async function workerGroups(): Promise<{ groups: WhatsAppGroup[] }> {
  // Daftar grup hanya berarti setelah sesi terbentuk. Bertanya lebih awal
  // menghasilkan kegagalan yang dapat diprediksi dan membanjiri log worker,
  // jadi keadaan koneksi diperiksa lebih dulu di sini.
  const status = await workerStatus()
  if (status.state !== "CONNECTED") {
    throw new WhatsAppSendError("NOT_CONNECTED")
  }
  return call<{ groups: WhatsAppGroup[] }>("/groups")
}

export function workerSend(body: {
  type: string
  slot: string
  initiatedById: string | null
}): Promise<{ status: string; code?: string; message?: string; reason?: string; detail?: string }> {
  return call("/send", { method: "POST", body })
}

export function workerResolveTarget(name?: string): Promise<
  | { status: "RESOLVED"; jid: string; name: string }
  | { status: "NOT_FOUND"; searchedName: string }
  | { status: "AMBIGUOUS"; searchedName: string; candidates: WhatsAppGroup[] }
> {
  return call("/resolve-target", { method: "POST", body: { name } })
}

/**
 * Buang kode QR dari payload status.
 *
 * QR menautkan perangkat mana pun ke akun WhatsApp sekolah, sehingga ia tidak
 * boleh ikut dalam respons yang boleh dibaca setiap pemegang `whatsapp.read`.
 * Pengambilannya lewat endpoint terpisah yang menuntut izin kelola koneksi.
 */
export function withoutQr<T extends { qr: string | null }>(status: T): Omit<T, "qr"> {
  const copy: Record<string, unknown> = { ...status }
  delete copy.qr
  return copy as Omit<T, "qr">
}
