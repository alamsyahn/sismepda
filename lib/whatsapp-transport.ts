/**
 * Batas transport WhatsApp.
 *
 * Modul ini TIDAK mengimpor Baileys. Ia mendefinisikan kontrak minimum yang
 * dibutuhkan logika bisnis, sehingga pengiriman pesan dapat diuji dengan
 * transport palsu tanpa satu pun koneksi WhatsApp nyata — dan sehingga
 * mengganti Baileys nanti tidak menyentuh aturan bisnis.
 *
 * MURNI/client-safe: tanpa Prisma, tanpa Node API, tanpa rahasia.
 */

/**
 * Status koneksi yang dapat dipahami admin.
 *
 * Sengaja terpisah dari status internal Baileys: UI tidak boleh menampilkan
 * istilah pustaka, dan mengganti pustaka tidak boleh mengubah kosakata UI.
 */
export type WhatsAppConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "WAITING_QR"
  | "CONNECTED"
  | "LOGGED_OUT"
  | "ERROR"

export const CONNECTION_STATE_LABELS: Record<WhatsAppConnectionState, string> = {
  DISCONNECTED: "Terputus",
  CONNECTING: "Menghubungkan…",
  WAITING_QR: "Menunggu QR",
  CONNECTED: "Terhubung",
  LOGGED_OUT: "Perlu login ulang",
  ERROR: "Error",
}

/** Kategori kegagalan yang stabil; dipakai kode dan disimpan di riwayat. */
export type WhatsAppErrorCode =
  | "WORKER_UNREACHABLE"
  | "NOT_CONNECTED"
  | "LOGGED_OUT"
  | "TARGET_NOT_RESOLVED"
  | "TARGET_NOT_MEMBER"
  | "TARGET_INVALID"
  | "RATE_LIMITED"
  | "NETWORK"
  | "SEND_FAILED"
  | "UNKNOWN"

/**
 * Terjemahan tunggal dari kode ke kalimat untuk admin.
 *
 * Satu-satunya tempat kalimat kegagalan ditulis. Stack trace mentah tidak
 * pernah sampai ke browser; ia tinggal di log server.
 */
export const ERROR_MESSAGES: Record<WhatsAppErrorCode, string> = {
  WORKER_UNREACHABLE:
    "Layanan WhatsApp sedang tidak berjalan. Hubungi administrator server bila keadaan ini bertahan.",
  NOT_CONNECTED: "WhatsApp tidak terhubung. Hubungkan kembali sebelum mengirim pesan.",
  LOGGED_OUT: "Sesi WhatsApp sudah berakhir. Diperlukan login ulang dengan memindai QR.",
  TARGET_NOT_RESOLVED:
    "Grup tujuan belum ditemukan. Pastikan akun WhatsApp sudah menjadi anggota grup, lalu muat ulang daftar grup.",
  TARGET_NOT_MEMBER:
    "Akun WhatsApp bukan lagi anggota grup tujuan. Tambahkan kembali akun ke grup tersebut.",
  TARGET_INVALID: "Identitas grup tujuan tidak valid. Muat ulang daftar grup untuk memperbaikinya.",
  RATE_LIMITED: "WhatsApp menolak sementara karena terlalu banyak permintaan. Coba lagi beberapa saat lagi.",
  NETWORK: "Jaringan ke WhatsApp bermasalah. Sistem akan mencoba menyambung kembali.",
  SEND_FAILED: "Pesan gagal dikirim. Periksa status koneksi lalu coba lagi.",
  UNKNOWN: "Terjadi kesalahan yang tidak dikenali. Periksa status koneksi lalu coba lagi.",
}

export function errorMessageFor(code: WhatsAppErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN
}

/**
 * Kesalahan pengiriman yang sudah diklasifikasikan.
 *
 * `message` selalu kalimat aman untuk admin. Detail teknis tinggal di
 * `cause` dan hanya dicatat di log server.
 */
export class WhatsAppSendError extends Error {
  readonly code: WhatsAppErrorCode

  constructor(code: WhatsAppErrorCode, cause?: unknown) {
    super(errorMessageFor(code))
    this.name = "WhatsAppSendError"
    this.code = code
    this.cause = cause
  }
}

export type WhatsAppGroup = {
  /** JID kanonik, mis. `1203...@g.us`. */
  jid: string
  name: string
}

/** Ringkasan status yang aman dikirim ke browser. */
export type WhatsAppStatus = {
  state: WhatsAppConnectionState
  /** Nomor tersambung dalam bentuk yang dapat dibaca, tanpa JID mentah. */
  phoneNumber: string | null
  displayName: string | null
  connectedSince: string | null
  lastDisconnectedAt: string | null
  /** Alasan putus yang sudah diterjemahkan; tidak pernah stack trace. */
  lastDisconnectReason: string | null
  lastError: { code: WhatsAppErrorCode; message: string } | null
  /** Apakah berkas sesi ada — BUKAN isinya. */
  sessionExists: boolean
  /** QR dalam bentuk string payload untuk dirender klien saat dibutuhkan. */
  qr: string | null
  lastHeartbeatAt: string | null
}

export type SendResult = {
  /** ID pesan dari penyedia bila tersedia. */
  providerMessageId: string | null
}

/**
 * Kontrak transport. Implementasi nyata: `BaileysWhatsAppTransport`.
 * Implementasi uji: transport palsu di dalam test.
 */
export type WhatsAppTransport = {
  getStatus(): Promise<WhatsAppStatus>
  /** Mulai/lanjutkan autentikasi; memicu QR bila diperlukan. */
  connect(): Promise<void>
  /** Sambung ulang memakai sesi yang ada. */
  reconnect(): Promise<void>
  /** Keluar dan HAPUS sesi. Destruktif: login ulang akan diperlukan. */
  logout(): Promise<void>
  listGroups(): Promise<WhatsAppGroup[]>
  sendMessage(jid: string, text: string): Promise<SendResult>
}

/**
 * Jeda percobaan sambung ulang, dalam milidetik.
 *
 * Eksponensial dengan batas atas, supaya kegagalan yang bertahan tidak berubah
 * menjadi loop sambung-ulang yang membanjiri WhatsApp — perilaku yang justru
 * mempercepat pemblokiran akun.
 */
export function reconnectDelayMs(
  attempt: number,
  { baseMs = 2_000, maxMs = 300_000 }: { baseMs?: number; maxMs?: number } = {},
): number {
  if (attempt <= 0) return baseMs
  const delay = baseMs * 2 ** attempt
  return Math.min(delay, maxMs)
}

/**
 * Apakah masuk akal menyambung ulang secara otomatis.
 *
 * Sesi yang sudah logged out TIDAK boleh disambung ulang otomatis: tidak ada
 * kredensial yang tersisa, sehingga percobaan berulang hanya menghasilkan
 * kegagalan tanpa akhir. Kondisi itu menuntut tindakan manusia (pindai QR).
 */
export function shouldReconnect(state: WhatsAppConnectionState): boolean {
  return state !== "LOGGED_OUT" && state !== "CONNECTED"
}
