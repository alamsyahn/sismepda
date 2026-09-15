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
  fetchLatestWaWebVersion,
  // Dialias: ESLint memperlakukan setiap pengenal berawalan `use` sebagai React
  // Hook, dan memanggilnya di dalam kelas dianggap pelanggaran. Alias ini
  // memadamkan salah-kenali itu tanpa mematikan aturan hooks untuk berkas ini.
  useMultiFileAuthState as loadMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import P from "pino"

import {
  WhatsAppSendError,
  errorMessageFor,
  reconnectDelayMs,
  shouldReconnect,
  type SendResult,
  type WhatsAppConnectionState,
  type WhatsAppErrorCode,
  type WhatsAppGroup,
  type WhatsAppStatus,
  type WhatsAppTransport,
} from "./whatsapp-transport.js"

/**
 * Terjemahan alasan putus ke kalimat untuk admin.
 *
 * PERHATIAN pada tabrakan nilai: di Baileys `connectionLost` dan `timedOut`
 * SAMA-SAMA 408, dan `connectionClosed` adalah 428. Mencocokkan lewat
 * `DisconnectReason` membuat setiap 408 dilaporkan sebagai gangguan jaringan,
 * termasuk handshake yang kehabisan waktu sebelum QR terbit — persis kekeliruan
 * yang membuat kegagalan pairing terlihat seperti masalah jaringan.
 *
 * Karena itu pemetaan dilakukan atas angka mentah, dengan `hadQr` sebagai
 * pembeda: 408 sebelum QR pernah terbit berarti handshake gagal, bukan koneksi
 * yang terputus di tengah jalan.
 *
 * Angka status tidak pernah ditampilkan kepada admin; ia hanya masuk log.
 */
function describeDisconnect(statusCode: number | undefined, hadQr: boolean): string {
  switch (statusCode) {
    case 401:
      return "Sesi dikeluarkan dari perangkat tertaut WhatsApp. Diperlukan pemindaian QR ulang."
    case 440:
      return "Sesi diambil alih oleh perangkat lain yang memakai akun WhatsApp yang sama."
    case 428:
      return "WhatsApp menutup koneksi sebelum sesi terbentuk. Coba hubungkan kembali."
    case 408:
      return hadQr
        ? "Koneksi ke WhatsApp terputus karena jaringan."
        : "WhatsApp tidak merespons saat memulai sesi. Coba hubungkan kembali."
    case 515:
      return "WhatsApp meminta koneksi dimulai ulang."
    case 500:
      return "Berkas sesi rusak dan tidak dapat dipakai lagi."
    case 411:
      return "Versi multi-perangkat WhatsApp tidak cocok. Diperlukan pemindaian QR ulang."
    case 403:
      return "Akun WhatsApp ditolak oleh server WhatsApp."
    case 503:
      return "Layanan WhatsApp sedang tidak tersedia."
    default:
      return "Koneksi ke WhatsApp terputus."
  }
}

/**
 * Kategori kegagalan koneksi, untuk log dan untuk `lastError`.
 *
 * Membedakan handshake gagal dari gangguan jaringan adalah inti diagnosis:
 * keduanya tampak sama di permukaan tetapi menuntut tindakan berbeda.
 */
function classifyDisconnect(statusCode: number | undefined, hadQr: boolean): WhatsAppErrorCode {
  if (statusCode === 401) return "LOGGED_OUT"
  if (statusCode === 428) return "HANDSHAKE_FAILED"
  if (statusCode === 408) return hadQr ? "NETWORK" : "HANDSHAKE_FAILED"
  if (statusCode === 403) return "TARGET_NOT_MEMBER"
  if (statusCode === 429) return "RATE_LIMITED"
  if (statusCode === undefined) return "NETWORK"
  return "UNKNOWN"
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
  /** Apakah QR pernah terbit pada percobaan koneksi berjalan. Pembeda 408. */
  private sawQr = false
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
      // Hanya KEBERADAAN sesi yang dilaporkan, tidak pernah isinya. Diperiksa
      // dari disk, bukan disimpulkan dari state: sesi tersimpan tetap ada
      // meskipun koneksi sedang putus, dan admin perlu tahu bedanya antara
      // "belum pernah pairing" dan "pernah pairing tetapi sedang terputus".
      sessionExists: existsSync(join(this.sessionDir, "creds.json")),
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
    // `fetchLatestWaWebVersion` membaca versi yang BENAR-BENAR dilayani
    // web.whatsapp.com saat ini. `fetchLatestBaileysVersion` membaca metadata
    // repositori Baileys, yang bisa tertinggal dari server dan membuat
    // handshake ditolak sebelum QR sempat terbit. Versi tidak pernah
    // dipatok keras: yang dipakai selalu hasil pengambilan, dan bila
    // pengambilan gagal Baileys memakai bawaannya sendiri.
    const { version, isLatest } = await fetchLatestWaWebVersion()
    console.log(
      `[whatsapp] versi WA Web ${version.join(".")} (terbaru: ${isLatest ? "ya" : "tidak"})`,
    )

    const socket = makeWASocket({
      version,
      auth: state,
      // Tanpa ini Baileys mencetak seluruh lalu lintas protokol, termasuk
      // isi pesan, ke stdout container.
      logger: this.logger,
      // WAJIB tuple WEB. Subplatform desktop (WIN32/DARWIN) dilaporkan ditolak
      // dengan 428 sebelum QR terbit; identitas web adalah jalur pairing QR
      // yang didukung. Jangan ganti ke Browsers.windows/macOS.
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
        // Payload QR TIDAK PERNAH dicatat: siapa pun yang membacanya di log
        // dapat menautkan perangkatnya ke akun WhatsApp sekolah.
        this.qr = qr
        this.sawQr = true
        this.setState("WAITING_QR")
      }

      if (connection === "open") {
        this.qr = null
        this.sawQr = false
        this.reconnectAttempt = 0
        this.connectedSince = new Date()
        this.lastError = null
        this.phoneNumber = phoneFromJid(socket.user?.id)
        this.displayName = socket.user?.name ?? null
        this.setState("CONNECTED")
        return
      }

      if (connection === "close") {
        const previousState = this.state
        const hadQr = this.sawQr
        this.lastDisconnectedAt = new Date()

        const error = lastDisconnect?.error
        const statusCode = error instanceof Boom ? error.output?.statusCode : undefined
        const code = classifyDisconnect(statusCode, hadQr)

        // Diagnostik: tanpa angka status mentah, 428/408/401 tidak dapat
        // dibedakan dari luar dan setiap kegagalan tampak sebagai "jaringan".
        // Yang dicatat hanya metadata — tidak ada kredensial, auth state,
        // payload QR, token, atau isi pesan.
        console.error(
          `[whatsapp] koneksi tertutup: status=${statusCode ?? "tidak ada"} kategori=${code} ` +
            `state_sebelumnya=${previousState} qr_pernah_terbit=${hadQr ? "ya" : "tidak"} ` +
            `error=${error instanceof Error ? error.name : "tidak ada"}`,
        )

        this.lastDisconnectReason = describeDisconnect(statusCode, hadQr)
        this.lastError = { code, message: errorMessageFor(code) }
        this.qr = null

        if (statusCode === DisconnectReason.loggedOut) {
          // Kredensial sudah tidak sah. Menyambung ulang tidak akan pernah
          // berhasil; yang dibutuhkan adalah manusia memindai QR.
          this.sawQr = false
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
