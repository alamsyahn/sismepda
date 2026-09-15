/**
 * Adapter Baileys — SATU-SATUNYA berkas yang mengimpor `@whiskeysockets/baileys`.
 *
 * Seluruh sistem lain berbicara lewat `WhatsAppTransport`. Batas ini disengaja:
 * Baileys adalah klien WhatsApp Web hasil rekayasa balik yang berubah cepat dan
 * kadang breaking antar rilis. Dengan mengurungnya di sini, penggantian pustaka
 * tidak menyentuh aturan bisnis maupun UI.
 *
 * Berkas ini HANYA berjalan di dalam proses worker, tidak pernah di dalam
 * Next.js: soket Baileys bersifat long-lived dan stateful, sedangkan route
 * handler bisa dijalankan ulang kapan saja oleh runtime.
 */
import { Boom } from "@hapi/boom"
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  // Dialias: ESLint memperlakukan setiap pengenal berawalan `use` sebagai React
  // Hook, dan memanggilnya di dalam kelas dianggap pelanggaran. Alias ini
  // memadamkan salah-kenali itu tanpa mematikan aturan hooks untuk berkas ini.
  useMultiFileAuthState as loadMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys"
import { rm } from "node:fs/promises"
import P from "pino"

import {
  WhatsAppSendError,
  reconnectDelayMs,
  shouldReconnect,
  type SendResult,
  type WhatsAppConnectionState,
  type WhatsAppErrorCode,
  type WhatsAppGroup,
  type WhatsAppStatus,
  type WhatsAppTransport,
} from "@/lib/whatsapp-transport"

/**
 * Terjemahan alasan putus Baileys ke kalimat untuk admin.
 *
 * Angka status di sisi kiri berasal dari `DisconnectReason` Baileys; admin
 * tidak boleh pernah melihat angka itu.
 */
function describeDisconnect(statusCode: number | undefined): string {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
      return "Sesi dikeluarkan dari perangkat tertaut WhatsApp. Diperlukan pemindaian QR ulang."
    case DisconnectReason.connectionReplaced:
      return "Sesi diambil alih oleh perangkat lain yang memakai akun WhatsApp yang sama."
    case DisconnectReason.connectionClosed:
      return "Koneksi ke WhatsApp tertutup."
    case DisconnectReason.connectionLost:
      return "Koneksi ke WhatsApp terputus karena jaringan."
    case DisconnectReason.restartRequired:
      return "WhatsApp meminta koneksi dimulai ulang."
    case DisconnectReason.timedOut:
      return "Koneksi ke WhatsApp kehabisan waktu."
    case DisconnectReason.badSession:
      return "Berkas sesi rusak dan tidak dapat dipakai lagi."
    case DisconnectReason.multideviceMismatch:
      return "Versi multi-perangkat WhatsApp tidak cocok. Diperlukan pemindaian QR ulang."
    case DisconnectReason.forbidden:
      return "Akun WhatsApp ditolak oleh server WhatsApp."
    case DisconnectReason.unavailableService:
      return "Layanan WhatsApp sedang tidak tersedia."
    default:
      return "Koneksi ke WhatsApp terputus."
  }
}

/** Nomor dari JID milik sendiri, tanpa membocorkan bentuk JID mentah. */
function phoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null
  const digits = jid.split(":")[0]?.split("@")[0]
  return digits ? `+${digits}` : null
}

function classifySendError(error: unknown): WhatsAppErrorCode {
  const statusCode = error instanceof Boom ? error.output?.statusCode : undefined
  if (statusCode === DisconnectReason.loggedOut) return "LOGGED_OUT"
  if (statusCode === 429) return "RATE_LIMITED"
  if (statusCode === 403) return "TARGET_NOT_MEMBER"
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (message.includes("not-authorized") || message.includes("forbidden")) return "TARGET_NOT_MEMBER"
  if (message.includes("timed out") || message.includes("econn") || message.includes("network")) return "NETWORK"
  return "SEND_FAILED"
}

export type BaileysTransportOptions = {
  /** Direktori penyimpanan kredensial multi-file Baileys. */
  sessionDir: string
  /** Dipanggil setiap kali status berubah, untuk dicatat worker. */
  onStatusChange?: (status: WhatsAppStatus) => void
  logger?: P.Logger
}

export class BaileysWhatsAppTransport implements WhatsAppTransport {
  private socket: WASocket | null = null
  private state: WhatsAppConnectionState = "DISCONNECTED"
  private qr: string | null = null
  private connectedSince: Date | null = null
  private lastDisconnectedAt: Date | null = null
  private lastDisconnectReason: string | null = null
  private lastError: { code: WhatsAppErrorCode; message: string } | null = null
  private lastHeartbeatAt: Date | null = null
  private phoneNumber: string | null = null
  private displayName: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private starting: Promise<void> | null = null
  private stopped = false

  private readonly sessionDir: string
  private readonly onStatusChange?: (status: WhatsAppStatus) => void
  private readonly logger: P.Logger

  constructor(options: BaileysTransportOptions) {
    this.sessionDir = options.sessionDir
    this.onStatusChange = options.onStatusChange
    this.logger = options.logger ?? P({ level: "warn" })
  }

  // --- status ---------------------------------------------------------------

  async getStatus(): Promise<WhatsAppStatus> {
    return this.snapshot()
  }

  private snapshot(): WhatsAppStatus {
    return {
      state: this.state,
      phoneNumber: this.phoneNumber,
      displayName: this.displayName,
      connectedSince: this.connectedSince?.toISOString() ?? null,
      lastDisconnectedAt: this.lastDisconnectedAt?.toISOString() ?? null,
      lastDisconnectReason: this.lastDisconnectReason,
      lastError: this.lastError,
      // Hanya KEBERADAAN sesi yang dilaporkan, tidak pernah isinya.
      sessionExists: this.connectedSince !== null || this.state === "CONNECTED",
      qr: this.qr,
      lastHeartbeatAt: this.lastHeartbeatAt?.toISOString() ?? null,
    }
  }

  private setState(state: WhatsAppConnectionState): void {
    this.state = state
    this.lastHeartbeatAt = new Date()
    this.onStatusChange?.(this.snapshot())
  }

  // --- siklus hidup ---------------------------------------------------------

  async connect(): Promise<void> {
    this.stopped = false
    if (this.starting) return this.starting
    this.starting = this.openSocket().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  async reconnect(): Promise<void> {
    await this.closeSocket()
    this.reconnectAttempt = 0
    await this.connect()
  }

  private async openSocket(): Promise<void> {
    this.setState("CONNECTING")

    const { state, saveCreds } = await loadMultiFileAuthState(this.sessionDir)
    const { version } = await fetchLatestBaileysVersion()

    const socket = makeWASocket({
      version,
      auth: state,
      // Tanpa ini Baileys mencetak seluruh lalu lintas protokol, termasuk
      // isi pesan, ke stdout container.
      logger: this.logger,
      browser: Browsers.ubuntu("SISMEPDA"),
      // Menandai pesan terbaca akan mengubah keadaan chat orang lain; sistem
      // ini hanya mengirim, tidak pernah membaca.
      markOnlineOnConnect: false,
    })
    this.socket = socket

    socket.ev.on("creds.update", saveCreds)
    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this.qr = qr
        this.setState("WAITING_QR")
      }

      if (connection === "open") {
        this.qr = null
        this.reconnectAttempt = 0
        this.connectedSince = new Date()
        this.lastError = null
        this.phoneNumber = phoneFromJid(socket.user?.id)
        this.displayName = socket.user?.name ?? null
        this.setState("CONNECTED")
        return
      }

      if (connection === "close") {
        this.lastDisconnectedAt = new Date()
        const statusCode =
          lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : undefined
        this.lastDisconnectReason = describeDisconnect(statusCode)
        this.qr = null

        if (statusCode === DisconnectReason.loggedOut) {
          // Kredensial sudah tidak sah. Menyambung ulang tidak akan pernah
          // berhasil; yang dibutuhkan adalah manusia memindai QR.
          this.setState("LOGGED_OUT")
          return
        }

        this.setState("DISCONNECTED")
        this.scheduleReconnect()
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (!shouldReconnect(this.state)) return
    if (this.reconnectTimer) return

    const delay = reconnectDelayMs(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch((error) => {
        this.lastError = { code: "NETWORK", message: String(error) }
        this.scheduleReconnect()
      })
    }, delay)
    // Timer sambung-ulang tidak boleh menahan proses tetap hidup saat shutdown.
    this.reconnectTimer.unref?.()
  }

  private async closeSocket(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      this.socket?.end(undefined)
    } catch {
      // Menutup soket yang sudah mati bukan kegagalan.
    }
    this.socket = null
  }

  /** Hentikan tanpa menghapus sesi — dipakai saat shutdown graceful. */
  async shutdown(): Promise<void> {
    this.stopped = true
    await this.closeSocket()
    this.setState("DISCONNECTED")
  }

  async logout(): Promise<void> {
    this.stopped = true
    try {
      await this.socket?.logout()
    } catch {
      // Bila WhatsApp sudah memutus lebih dulu, sesi lokal tetap harus dibuang.
    }
    await this.closeSocket()
    // Sesi dihapus dari disk: inilah yang membuat "reset" benar-benar mereset.
    await rm(this.sessionDir, { recursive: true, force: true })
    this.connectedSince = null
    this.phoneNumber = null
    this.displayName = null
    this.qr = null
    this.setState("LOGGED_OUT")
  }

  // --- operasi --------------------------------------------------------------

  async listGroups(): Promise<WhatsAppGroup[]> {
    if (!this.socket || this.state !== "CONNECTED") {
      throw new WhatsAppSendError("NOT_CONNECTED")
    }
    const groups = await this.socket.groupFetchAllParticipating()
    return Object.values(groups).map((group) => ({
      jid: group.id,
      name: group.subject ?? group.id,
    }))
  }

  async sendMessage(jid: string, text: string): Promise<SendResult> {
    if (!this.socket || this.state !== "CONNECTED") {
      throw new WhatsAppSendError("NOT_CONNECTED")
    }
    try {
      const sent = await this.socket.sendMessage(jid, { text })
      return { providerMessageId: sent?.key?.id ?? null }
    } catch (error) {
      const code = classifySendError(error)
      this.lastError = { code, message: new WhatsAppSendError(code).message }
      throw new WhatsAppSendError(code, error)
    }
  }
}
