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
 *
 * SATU PEMILIK SOKET
 *
 * Instance ini adalah pemilik tunggal soket. Setiap pembukaan soket baru
 * menaikkan `generation`, dan event dari soket generasi lama diabaikan.
 * Tanpa itu, dua soket dapat hidup berbarengan dengan kredensial yang SAMA —
 * WhatsApp menanggapinya dengan mengambil alih sesi (440) lalu mengeluarkannya
 * dari daftar perangkat tertaut (401) beberapa menit setelah penautan berhasil.
 * Itu persis gejala yang membuat berkas ini ditulis ulang.
 */
import { Boom } from "@hapi/boom"
import makeWASocket, {
  Browsers,
  fetchLatestWaWebVersion,
  // Dialias: ESLint memperlakukan setiap pengenal berawalan `use` sebagai React
  // Hook, dan memanggilnya di dalam kelas dianggap pelanggaran. Alias ini
  // memadamkan salah-kenali itu tanpa mematikan aturan hooks untuk berkas ini.
  useMultiFileAuthState as loadMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys"
import { existsSync } from "node:fs"
import { mkdir, stat, writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import P from "pino"

import {
  INTENTIONAL_DISCONNECT,
  WhatsAppSendError,
  classifyDisconnect,
  errorMessageFor,
  reconnectDelayMs,
  shouldReconnect,
  type SendResult,
  type WhatsAppConnectionState,
  type WhatsAppDisconnectCategory,
  type WhatsAppDisconnectPolicy,
  type WhatsAppErrorCode,
  type WhatsAppGroup,
  type WhatsAppStatus,
  type WhatsAppTransport,
} from "./whatsapp-transport.js"
import { discardSessionCredentials, sessionExistsIn } from "./whatsapp-session-store.js"

/** Nomor dari JID milik sendiri, tanpa membocorkan bentuk JID mentah. */
function phoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null
  const digits = jid.split(":")[0]?.split("@")[0]
  return digits ? `+${digits}` : null
}

function classifySendError(error: unknown): WhatsAppErrorCode {
  const statusCode = error instanceof Boom ? error.output?.statusCode : undefined
  if (statusCode === 401) return "LOGGED_OUT"
  if (statusCode === 429) return "RATE_LIMITED"
  if (statusCode === 403) return "TARGET_NOT_MEMBER"
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (message.includes("not-authorized") || message.includes("forbidden")) return "TARGET_NOT_MEMBER"
  if (message.includes("timed out") || message.includes("econn") || message.includes("network")) return "NETWORK"
  return "SEND_FAILED"
}

/**
 * Nama error yang aman dicatat.
 *
 * Hanya NAMA kelas error, tidak pernah pesannya: pesan Baileys dapat memuat
 * potongan payload protokol.
 */
function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "tidak ada"
}

export type BaileysTransportOptions = {
  /** Direktori penyimpanan kredensial multi-file Baileys. */
  sessionDir: string
  /** Dipanggil setiap kali status berubah, untuk dicatat worker. */
  onStatusChange?: (status: WhatsAppStatus) => void
  logger?: P.Logger
  /** Jam yang dapat diganti dalam test. */
  now?: () => Date
}

export class BaileysWhatsAppTransport implements WhatsAppTransport {
  private socket: WASocket | null = null
  /**
   * Generasi soket yang sedang berlaku.
   *
   * Baileys tidak melepas listener saat soket berakhir, jadi soket lama masih
   * dapat memancarkan `connection.update` setelah penggantinya dibuka. Tanpa
   * pembanding generasi, event basi itu menimpa status yang benar dan memicu
   * sambung ulang tambahan — cara tercepat mendapat dua soket sekaligus.
   */
  private generation = 0
  private state: WhatsAppConnectionState = "UNPAIRED"
  private qr: string | null = null
  /** Apakah QR pernah terbit pada percobaan koneksi berjalan. Pembeda 408. */
  private sawQr = false
  private connectedSince: Date | null = null
  private lastDisconnectedAt: Date | null = null
  private lastDisconnectReason: string | null = null
  private lastDisconnectCategory: WhatsAppDisconnectCategory | null = null
  private lastError: { code: WhatsAppErrorCode; message: string } | null = null
  private lastHeartbeatAt: Date | null = null
  private phoneNumber: string | null = null
  private displayName: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private starting: Promise<void> | null = null
  /** Menutup sengaja: event `close` yang menyusul bukan kegagalan. */
  private closingDeliberately = false
  private stopped = false

  private readonly sessionDir: string
  private readonly onStatusChange?: (status: WhatsAppStatus) => void
  private readonly logger: P.Logger
  private readonly now: () => Date

  constructor(options: BaileysTransportOptions) {
    this.sessionDir = options.sessionDir
    this.onStatusChange = options.onStatusChange
    this.logger = options.logger ?? P({ level: "warn" })
    this.now = options.now ?? (() => new Date())
    // Keadaan awal mengikuti disk: sesi tersimpan berarti "pernah ditautkan,
    // sedang terputus", bukan "belum pernah ditautkan".
    this.state = this.sessionOnDisk() ? "DISCONNECTED" : "UNPAIRED"
  }

  // --- status ---------------------------------------------------------------

  async getStatus(): Promise<WhatsAppStatus> {
    return this.snapshot()
  }

  private sessionOnDisk(): boolean {
    return sessionExistsIn(this.sessionDir)
  }

  private snapshot(): WhatsAppStatus {
    return {
      state: this.state,
      phoneNumber: this.phoneNumber,
      displayName: this.displayName,
      connectedSince: this.connectedSince?.toISOString() ?? null,
      lastDisconnectedAt: this.lastDisconnectedAt?.toISOString() ?? null,
      lastDisconnectReason: this.lastDisconnectReason,
      lastDisconnectCategory: this.lastDisconnectCategory,
      lastError: this.lastError,
      // Hanya KEBERADAAN sesi yang dilaporkan, tidak pernah isinya. Diperiksa
      // dari disk, bukan disimpulkan dari state: sesi tersimpan tetap ada
      // meskipun koneksi sedang putus, dan admin perlu tahu bedanya antara
      // "belum pernah pairing" dan "pernah pairing tetapi sedang terputus".
      sessionExists: this.sessionOnDisk(),
      qr: this.qr,
      lastHeartbeatAt: this.lastHeartbeatAt?.toISOString() ?? null,
    }
  }

  private setState(state: WhatsAppConnectionState): void {
    this.state = state
    this.lastHeartbeatAt = this.now()
    this.onStatusChange?.(this.snapshot())
  }

  /**
   * Catat satu peristiwa koneksi dengan stempel waktu.
   *
   * Tanpa stempel waktu eksplisit, log container yang dibaca belakangan tidak
   * dapat dipasangkan dengan keluhan "beberapa menit setelah tertaut". Yang
   * dicatat hanya metadata: tidak ada kredensial, kunci, token, payload QR,
   * maupun isi pesan.
   */
  private logEvent(event: string, fields: Record<string, string | number | boolean>): void {
    const parts = Object.entries(fields).map(([key, value]) => `${key}=${value}`)
    console.log(`[whatsapp] ${this.now().toISOString()} ${event} ${parts.join(" ")}`)
  }

  // --- siklus hidup ---------------------------------------------------------

  /**
   * Buka koneksi bila memang belum ada.
   *
   * Idempotent DENGAN SENGAJA. Panggilan kedua saat soket sudah hidup TIDAK
   * boleh membuka soket kedua: dua soket dengan kredensial sama membuat
   * WhatsApp mengambil alih sesi lalu mengeluarkannya. Tombol "Hubungkan" yang
   * ditekan dua kali, atau dua replica app yang memanggil worker bersamaan,
   * cukup untuk memicunya.
   */
  async connect(): Promise<void> {
    this.stopped = false
    if (this.starting) return this.starting
    if (this.socket && (this.state === "CONNECTED" || this.state === "CONNECTING" || this.state === "WAITING_QR")) {
      this.logEvent("permintaan_connect_diabaikan", { state: this.state })
      return
    }
    this.starting = this.openSocket().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  /** Tutup soket berjalan lalu buka yang baru memakai sesi yang sama. */
  async reconnect(): Promise<void> {
    this.stopped = false
    await this.closeSocket()
    this.reconnectAttempt = 0
    await this.connect()
  }

  /**
   * Login ulang: buang kredensial lama, lalu minta QR baru.
   *
   * Dipakai saat sesi sudah tidak sah. Menyambung ulang kredensial mati tidak
   * pernah berhasil; yang dibutuhkan adalah penautan baru, dan itu menuntut
   * kredensial lama benar-benar hilang lebih dulu.
   */
  async relogin(): Promise<void> {
    await this.logout()
    await this.connect()
  }

  private async openSocket(): Promise<void> {
    this.closingDeliberately = false
    this.setState("CONNECTING")

    // Direktori dibuat eksplisit. `useMultiFileAuthState` membuatnya sendiri,
    // tetapi kegagalannya (volume belum ter-mount, izin salah) baru terlihat
    // saat kredensial gagal DISIMPAN — yaitu setelah pairing berhasil, yang
    // membuat sesi hilang beberapa menit kemudian tanpa jejak.
    await mkdir(this.sessionDir, { recursive: true })
    await this.assertSessionWritable()

    const generation = ++this.generation
    const { state, saveCreds } = await loadMultiFileAuthState(this.sessionDir)
    // `fetchLatestWaWebVersion` membaca versi yang BENAR-BENAR dilayani
    // web.whatsapp.com saat ini. `fetchLatestBaileysVersion` membaca metadata
    // repositori Baileys, yang bisa tertinggal dari server dan membuat
    // handshake ditolak sebelum QR sempat terbit. Versi tidak pernah
    // dipatok keras: yang dipakai selalu hasil pengambilan, dan bila
    // pengambilan gagal Baileys memakai bawaannya sendiri.
    const { version, isLatest } = await fetchLatestWaWebVersion()
    this.logEvent("versi_wa_web", { versi: version.join("."), terbaru: isLatest ? "ya" : "tidak" })

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
    this.logEvent("soket_dibuka", { generasi: generation })

    // Kredensial disimpan pada setiap perubahan. Kegagalan penyimpanan dicatat
    // keras: sesi yang tidak tersimpan akan tampak hidup sekarang dan hilang
    // setelah restart berikutnya.
    socket.ev.on("creds.update", () => {
      void saveCreds().catch((error: unknown) => {
        this.logEvent("kredensial_gagal_disimpan", {
          error: safeErrorName(error),
          direktori_ada: existsSync(this.sessionDir) ? "ya" : "tidak",
        })
      })
    })

    socket.ev.on("connection.update", (update) => {
      // Event dari soket yang sudah digantikan tidak boleh menyentuh status.
      if (generation !== this.generation) {
        this.logEvent("event_soket_basi_diabaikan", { generasi: generation, berlaku: this.generation })
        return
      }

      const { connection, lastDisconnect, qr } = update

      if (qr) {
        // Payload QR TIDAK PERNAH dicatat: siapa pun yang membacanya di log
        // dapat menautkan perangkatnya ke akun WhatsApp sekolah.
        this.qr = qr
        this.sawQr = true
        this.setState("WAITING_QR")
        this.logEvent("qr_terbit", { generasi: generation })
      }

      if (connection === "open") {
        this.qr = null
        this.sawQr = false
        this.reconnectAttempt = 0
        this.connectedSince = this.now()
        this.lastError = null
        this.lastDisconnectCategory = null
        this.phoneNumber = phoneFromJid(socket.user?.id)
        this.displayName = socket.user?.name ?? null
        this.setState("CONNECTED")
        this.logEvent("terhubung", { generasi: generation })
        return
      }

      if (connection === "close") {
        this.handleClose(generation, lastDisconnect?.error)
      }
    })
  }

  /**
   * Satu tempat keputusan untuk setiap penutupan koneksi.
   *
   * Kebijakannya murni dan diuji terpisah (`classifyDisconnect`); di sini hanya
   * penerapannya. Memisahkan keduanya penting karena inilah bagian yang salah
   * menentukan apakah sistem menyambung ulang kredensial mati sampai WhatsApp
   * memblokir nomor sekolah.
   */
  private handleClose(generation: number, error: unknown): void {
    const previousState = this.state
    const hadQr = this.sawQr
    this.lastDisconnectedAt = this.now()
    this.socket = null

    const statusCode = error instanceof Boom ? error.output?.statusCode : undefined
    const policy: WhatsAppDisconnectPolicy = this.closingDeliberately
      ? INTENTIONAL_DISCONNECT
      : classifyDisconnect(statusCode, hadQr)

    // Diagnostik: tanpa angka status mentah, 401/408/428/440/515 tidak dapat
    // dibedakan dari luar dan setiap kegagalan tampak sebagai "jaringan".
    // Yang dicatat hanya metadata — tidak ada kredensial, auth state,
    // payload QR, token, atau isi pesan.
    this.logEvent("koneksi_tertutup", {
      generasi: generation,
      status: statusCode ?? "tidak ada",
      kategori: policy.category,
      state_sebelumnya: previousState,
      qr_pernah_terbit: hadQr ? "ya" : "tidak",
      sambung_ulang: policy.reconnect ? "ya" : "tidak",
      perlu_login_ulang: policy.requiresNewLogin ? "ya" : "tidak",
      sesi_tersimpan: this.sessionOnDisk() ? "ya" : "tidak",
      error: safeErrorName(error),
    })

    this.lastDisconnectReason = policy.reason
    this.lastDisconnectCategory = policy.category
    this.lastError =
      policy.category === "INTENTIONAL"
        ? null
        : { code: policy.errorCode, message: errorMessageFor(policy.errorCode) }
    this.qr = null
    this.sawQr = false
    this.connectedSince = null

    if (policy.requiresNewLogin) {
      // Kredensial sudah tidak sah. Membiarkannya di disk membuat setiap
      // start berikutnya mencoba memakainya dan gagal lagi — sekaligus
      // membuat `sessionExists` berbohong kepada UI.
      void this.discardCredentials("sesi_tidak_sah")
      this.setState("LOGGED_OUT")
      return
    }

    this.setState(policy.nextState)
    if (policy.reconnect) this.scheduleReconnect(policy.immediate)
  }

  private scheduleReconnect(immediate = false): void {
    if (this.stopped) return
    // Aturannya dijaga satu tempat (`shouldReconnect`) dan diuji terpisah.
    // Menyalin syaratnya ke sini berarti kebijakan sambung-ulang punya dua
    // rumah yang bisa melenceng diam-diam.
    if (!shouldReconnect(this.state)) return
    // Tanpa kredensial di disk tidak ada yang bisa disambung ulang; keadaan
    // ini menuntut QR baru, bukan percobaan berulang.
    if (!this.sessionOnDisk()) return
    if (this.reconnectTimer) return

    const delay = immediate ? 0 : reconnectDelayMs(this.reconnectAttempt)
    if (!immediate) this.reconnectAttempt += 1
    this.logEvent("sambung_ulang_dijadwalkan", { jeda_ms: delay, percobaan: this.reconnectAttempt })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch((error: unknown) => {
        this.lastError = { code: "NETWORK", message: errorMessageFor("NETWORK") }
        this.logEvent("sambung_ulang_gagal", { error: safeErrorName(error) })
        this.setState("DISCONNECTED")
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
    const socket = this.socket
    this.socket = null
    if (!socket) return
    this.closingDeliberately = true
    // Generasi dinaikkan agar event `close` dari soket ini tidak lagi
    // menyentuh status maupun menjadwalkan sambung ulang.
    this.generation += 1
    try {
      socket.end(undefined)
    } catch {
      // Menutup soket yang sudah mati bukan kegagalan.
    }
  }

  /**
   * Hapus seluruh kredensial lokal.
   *
   * Dibuat idempotent dan TUNTAS: sesi separuh terhapus adalah keadaan
   * terburuk dari ketiganya — Baileys memuatnya, WhatsApp menolaknya, dan
   * admin melihat "tertaut" yang tidak pernah terhubung. Bila direktori tidak
   * dapat dihapus (mis. titik mount volume), isinya yang dikosongkan.
   */
  private async discardCredentials(sebab: string): Promise<boolean> {
    // Mekanismenya ada di `whatsapp-session-store`, yang bebas Baileys dan
    // karenanya dapat diuji langsung. Di sini hanya pencatatannya.
    const bersih = await discardSessionCredentials(this.sessionDir)
    this.logEvent("kredensial_dihapus", { sebab, bersih: bersih ? "ya" : "tidak" })
    return bersih
  }

  /**
   * Pastikan direktori sesi benar-benar dapat ditulis.
   *
   * Kegagalan di sini adalah penjelasan paling sering untuk "tertaut lalu
   * hilang": kredensial hanya ada di memori, sehingga proses berikutnya
   * memulai dari nol. Lebih baik terlihat sebagai satu baris log saat start
   * daripada sebagai sesi yang lenyap beberapa menit kemudian.
   */
  private async assertSessionWritable(): Promise<void> {
    const probe = join(this.sessionDir, ".tulis-uji")
    try {
      await writeFile(probe, "ok")
      await unlink(probe)
      const info = await stat(this.sessionDir)
      this.logEvent("sesi_persisten", {
        dapat_ditulis: "ya",
        sesi_tersimpan: this.sessionOnDisk() ? "ya" : "tidak",
        direktori: info.isDirectory() ? "ya" : "tidak",
      })
    } catch (error) {
      this.logEvent("sesi_tidak_dapat_ditulis", { error: safeErrorName(error) })
      throw new WhatsAppSendError("UNKNOWN", error)
    }
  }

  /** Hentikan tanpa menghapus sesi — dipakai saat shutdown graceful. */
  async shutdown(): Promise<void> {
    this.stopped = true
    await this.closeSocket()
    this.setState(this.sessionOnDisk() ? "DISCONNECTED" : "UNPAIRED")
  }

  /**
   * Keluar dan hapus sesi. IDEMPOTENT.
   *
   * Logout jarak jauh dicoba lebih dulu supaya perangkat benar-benar lepas
   * dari daftar perangkat tertaut. Tetapi kegagalannya — yang PASTI terjadi
   * saat sesi sudah LOGGED_OUT, karena tidak ada soket untuk memintanya —
   * tidak boleh menggagalkan operasi: yang dijanjikan tombol ini adalah
   * keadaan bersih, dan keadaan bersih tidak bergantung pada WhatsApp.
   */
  async logout(): Promise<void> {
    this.stopped = true
    const punyaSoket = this.socket !== null
    let remote: "berhasil" | "gagal" | "dilewati" = "dilewati"

    if (punyaSoket && this.state === "CONNECTED") {
      try {
        await this.socket?.logout()
        remote = "berhasil"
      } catch (error) {
        // Sesi sudah mati di sisi WhatsApp. Pembersihan lokal tetap jalan.
        remote = "gagal"
        this.logEvent("logout_jarak_jauh_gagal", { error: safeErrorName(error) })
      }
    }

    await this.closeSocket()
    const bersih = await this.discardCredentials("logout")

    this.connectedSince = null
    this.phoneNumber = null
    this.displayName = null
    this.qr = null
    this.sawQr = false
    this.reconnectAttempt = 0
    this.lastDisconnectCategory = null
    this.lastDisconnectReason = null
    this.lastError = bersih ? null : { code: "UNKNOWN", message: errorMessageFor("UNKNOWN") }

    this.logEvent("logout_selesai", { jarak_jauh: remote, kredensial_bersih: bersih ? "ya" : "tidak" })
    // Tanpa kredensial, keadaan yang jujur adalah "belum ditautkan" — bukan
    // "perlu login ulang", yang menyiratkan masih ada sesi untuk dipulihkan.
    this.setState(bersih ? "UNPAIRED" : "ERROR")
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
