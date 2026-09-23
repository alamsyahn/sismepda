/**
 * Batas transport WhatsApp.
 *
 * Modul ini TIDAK mengimpor Baileys. Ia mendefinisikan kontrak minimum yang
 * dibutuhkan logika bisnis, sehingga pengiriman pesan dapat diuji dengan
 * transport palsu tanpa satu pun koneksi WhatsApp nyata — dan sehingga
 * mengganti Baileys nanti tidak menyentuh aturan bisnis.
 *
 * Di sini pula seluruh KEBIJAKAN koneksi tinggal: klasifikasi alasan putus,
 * apakah sebuah putus boleh disambung ulang otomatis, dan tombol apa yang
 * masuk akal pada setiap keadaan. Semuanya fungsi murni, karena itulah bagian
 * yang paling mudah salah dan paling mahal bila salah — dan satu-satunya cara
 * mengujinya tanpa akun WhatsApp sungguhan.
 *
 * MURNI/client-safe: tanpa Prisma, tanpa Node API, tanpa rahasia.
 */

/**
 * Status koneksi yang dapat dipahami admin.
 *
 * Sengaja terpisah dari status internal Baileys: UI tidak boleh menampilkan
 * istilah pustaka, dan mengganti pustaka tidak boleh mengubah kosakata UI.
 *
 * Perbedaan yang WAJIB terjaga:
 *
 * | State          | Kredensial | Arti |
 * |---|---|---|
 * | UNPAIRED       | tidak ada  | belum pernah ditautkan, atau sesi sudah dibersihkan |
 * | CONNECTING     | ada/tidak  | soket sedang dibuka |
 * | WAITING_QR     | belum sah  | menunggu manusia memindai QR |
 * | CONNECTED      | sah        | sesi hidup |
 * | DISCONNECTED   | sah        | putus sementara, sambung ulang masuk akal |
 * | LOGGED_OUT     | tidak sah  | HARUS login ulang; sambung ulang tidak akan pernah berhasil |
 * | ERROR          | tidak diketahui | worker tidak terjangkau atau kegagalan tak terduga |
 *
 * Menyatukan UNPAIRED dengan DISCONNECTED membuat UI menampilkan "Hubungkan"
 * dan "Sambung ulang" berbarengan, dan menyatukan LOGGED_OUT dengan
 * DISCONNECTED membuat sistem menyambung ulang kredensial yang sudah mati.
 */
export type WhatsAppConnectionState =
  | "UNPAIRED"
  | "CONNECTING"
  | "WAITING_QR"
  | "CONNECTED"
  | "DISCONNECTED"
  | "LOGGED_OUT"
  | "ERROR"

export const CONNECTION_STATE_LABELS: Record<WhatsAppConnectionState, string> = {
  UNPAIRED: "Belum ditautkan",
  CONNECTING: "Menghubungkan…",
  WAITING_QR: "Menunggu pemindaian QR",
  CONNECTED: "Terhubung",
  DISCONNECTED: "Terputus sementara",
  LOGGED_OUT: "Perlu login ulang",
  ERROR: "Bermasalah",
}

/**
 * Kalimat penjelas di bawah label.
 *
 * Admin tidak perlu tahu enum internal; ia perlu tahu apa yang harus
 * dilakukan. Enum tetap tersedia di bagian detail teknis.
 */
export const CONNECTION_STATE_DESCRIPTIONS: Record<WhatsAppConnectionState, string> = {
  UNPAIRED:
    "Belum ada nomor WhatsApp yang tertaut. Mulai penautan lalu pindai kode QR dari ponsel sekolah.",
  CONNECTING: "Sedang membuka koneksi ke WhatsApp. Tunggu beberapa saat.",
  WAITING_QR:
    "Pindai kode QR di bawah dari WhatsApp ponsel sekolah melalui menu Perangkat tertaut.",
  CONNECTED: "Nomor sekolah tertaut dan pengiriman terjadwal berjalan.",
  DISCONNECTED:
    "Koneksi terputus sementara, tetapi penautan nomor masih berlaku. Sistem mencoba menyambung sendiri; Anda juga dapat menyambungkan ulang sekarang.",
  LOGGED_OUT:
    "Penautan perangkat sudah dibatalkan dari WhatsApp, sehingga sesi lama tidak dapat dipakai lagi. Lakukan login ulang untuk mendapatkan kode QR baru.",
  ERROR:
    "Status koneksi tidak dapat dibaca. Periksa layanan WhatsApp pada server, lalu coba lagi.",
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
  | "HANDSHAKE_FAILED"
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
  HANDSHAKE_FAILED:
    "WhatsApp menolak koneksi sebelum sesi terbentuk. Coba hubungkan kembali; bila berulang, keluar lalu pindai QR baru.",
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

// --- kebijakan putus --------------------------------------------------------

/**
 * Kategori penyebab putus.
 *
 * Dibedakan sampai sehalus ini justru karena dari layar admin semuanya tampak
 * identik ("terputus"), padahal tindakan yang benar berbeda tajam: satu
 * menuntut manusia memindai QR, satu cukup ditunggu, satu justru TIDAK boleh
 * disambung ulang karena sambung ulang itulah yang memperparah.
 */
export type WhatsAppDisconnectCategory =
  | "LOGGED_OUT"
  | "CONNECTION_REPLACED"
  | "RESTART_REQUIRED"
  | "BAD_SESSION"
  | "VERSION_MISMATCH"
  | "ACCOUNT_REFUSED"
  | "HANDSHAKE_FAILED"
  | "NETWORK"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTENTIONAL"
  | "UNKNOWN"

export type WhatsAppDisconnectPolicy = {
  category: WhatsAppDisconnectCategory
  /** Keadaan yang harus dipasang setelah putus ini. */
  nextState: Extract<WhatsAppConnectionState, "DISCONNECTED" | "LOGGED_OUT" | "ERROR" | "UNPAIRED">
  /** Boleh disambung ulang otomatis? */
  reconnect: boolean
  /**
   * Sambung ulang tanpa menaikkan backoff.
   *
   * 515 (restart diminta) adalah bagian NORMAL dari pairing, bukan kegagalan;
   * memperlakukannya sebagai kegagalan membuat penautan yang baru berhasil
   * menunggu menit-menit sebelum kembali.
   */
  immediate: boolean
  /** Kredensial lokal sudah tidak sah dan harus diganti lewat QR baru. */
  requiresNewLogin: boolean
  errorCode: WhatsAppErrorCode
  /** Kalimat untuk admin. Tidak pernah memuat angka status atau stack trace. */
  reason: string
}

/**
 * Klasifikasi putus dari ANGKA status mentah.
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
 * Angka status tidak pernah ditampilkan sebagai informasi utama kepada admin;
 * ia masuk log dan bagian detail teknis.
 */
export function classifyDisconnect(
  statusCode: number | undefined,
  hadQr: boolean,
): WhatsAppDisconnectPolicy {
  switch (statusCode) {
    case 401:
      return {
        category: "LOGGED_OUT",
        nextState: "LOGGED_OUT",
        reconnect: false,
        immediate: false,
        requiresNewLogin: true,
        errorCode: "LOGGED_OUT",
        reason:
          "Sesi dikeluarkan dari daftar perangkat tertaut WhatsApp. Diperlukan login ulang dengan memindai QR baru.",
      }
    case 440:
      // Sesi diambil alih koneksi lain dengan kredensial yang sama. Menyambung
      // ulang di sini adalah tepat hal yang memperburuk: dua soket saling
      // merebut satu kredensial, dan WhatsApp mengakhirinya dengan 401.
      return {
        category: "CONNECTION_REPLACED",
        nextState: "DISCONNECTED",
        reconnect: false,
        immediate: false,
        requiresNewLogin: false,
        reason:
          "Sesi diambil alih oleh koneksi lain yang memakai akun WhatsApp yang sama. Pastikan hanya satu layanan yang memakai nomor ini, lalu sambungkan ulang.",
        errorCode: "NETWORK",
      }
    case 515:
      return {
        category: "RESTART_REQUIRED",
        nextState: "DISCONNECTED",
        reconnect: true,
        immediate: true,
        requiresNewLogin: false,
        errorCode: "NETWORK",
        reason: "WhatsApp meminta koneksi dimulai ulang. Sistem menyambung kembali sendiri.",
      }
    case 500:
      return {
        category: "BAD_SESSION",
        nextState: "LOGGED_OUT",
        reconnect: false,
        immediate: false,
        requiresNewLogin: true,
        errorCode: "LOGGED_OUT",
        reason: "Berkas sesi rusak dan tidak dapat dipakai lagi. Diperlukan login ulang.",
      }
    case 411:
      return {
        category: "VERSION_MISMATCH",
        nextState: "LOGGED_OUT",
        reconnect: false,
        immediate: false,
        requiresNewLogin: true,
        errorCode: "LOGGED_OUT",
        reason: "Versi multi-perangkat WhatsApp tidak cocok. Diperlukan login ulang.",
      }
    case 403:
      return {
        category: "ACCOUNT_REFUSED",
        nextState: "ERROR",
        reconnect: false,
        immediate: false,
        requiresNewLogin: false,
        errorCode: "TARGET_NOT_MEMBER",
        reason: "Akun WhatsApp ditolak oleh server WhatsApp.",
      }
    case 428:
      return {
        category: "HANDSHAKE_FAILED",
        nextState: "DISCONNECTED",
        reconnect: true,
        immediate: false,
        requiresNewLogin: false,
        errorCode: "HANDSHAKE_FAILED",
        reason: "WhatsApp menutup koneksi sebelum sesi terbentuk.",
      }
    case 408:
      return hadQr
        ? {
            category: "NETWORK",
            nextState: "DISCONNECTED",
            reconnect: true,
            immediate: false,
            requiresNewLogin: false,
            errorCode: "NETWORK",
            reason: "Koneksi ke WhatsApp terputus karena jaringan.",
          }
        : {
            category: "HANDSHAKE_FAILED",
            nextState: "DISCONNECTED",
            reconnect: true,
            immediate: false,
            requiresNewLogin: false,
            errorCode: "HANDSHAKE_FAILED",
            reason: "WhatsApp tidak merespons saat memulai sesi.",
          }
    case 429:
      return {
        category: "RATE_LIMITED",
        nextState: "DISCONNECTED",
        reconnect: true,
        immediate: false,
        requiresNewLogin: false,
        errorCode: "RATE_LIMITED",
        reason: "WhatsApp menolak sementara karena terlalu banyak permintaan.",
      }
    case 503:
      return {
        category: "SERVICE_UNAVAILABLE",
        nextState: "DISCONNECTED",
        reconnect: true,
        immediate: false,
        requiresNewLogin: false,
        errorCode: "NETWORK",
        reason: "Layanan WhatsApp sedang tidak tersedia.",
      }
    default:
      return {
        category: statusCode === undefined ? "NETWORK" : "UNKNOWN",
        nextState: "DISCONNECTED",
        reconnect: true,
        immediate: false,
        requiresNewLogin: false,
        errorCode: statusCode === undefined ? "NETWORK" : "UNKNOWN",
        reason: "Koneksi ke WhatsApp terputus.",
      }
  }
}

/** Kategori putus yang ditutup sengaja oleh sistem, bukan oleh WhatsApp. */
export const INTENTIONAL_DISCONNECT: WhatsAppDisconnectPolicy = {
  category: "INTENTIONAL",
  nextState: "DISCONNECTED",
  reconnect: false,
  immediate: false,
  requiresNewLogin: false,
  errorCode: "NOT_CONNECTED",
  reason: "Koneksi ditutup oleh sistem.",
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
  /** Kategori teknis putus terakhir, untuk bagian detail admin. */
  lastDisconnectCategory: WhatsAppDisconnectCategory | null
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

/** Tambahan opsional saat mengirim. */
export type SendOptions = {
  /**
   * JID yang ikut sebagai metadata mention.
   *
   * Teks pesan sudah memuat `@628…`-nya; tanpa metadata ini WhatsApp hanya
   * mencetaknya sebagai tulisan biasa dan tidak memberi notifikasi kepada
   * siapa pun.
   */
  mentions?: readonly string[]
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
  /** Bersihkan sesi lalu langsung minta QR baru. */
  relogin(): Promise<void>
  listGroups(): Promise<WhatsAppGroup[]>
  /**
   * `options.mentions` berisi JID yang harus benar-benar DIPANGGIL WhatsApp,
   * bukan sekadar tertulis `@628…` di dalam teks. Opsional dan default kosong,
   * sehingga seluruh pemanggil lama — termasuk transport palsu di dalam uji —
   * tetap sah tanpa perubahan.
   */
  sendMessage(jid: string, text: string, options?: SendOptions): Promise<SendResult>
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
 * Apakah masuk akal menyambung ulang secara otomatis dari keadaan ini.
 *
 * Hanya putus SEMENTARA dengan kredensial yang masih sah yang boleh disambung
 * ulang sendiri. Sesi yang sudah logged out tidak punya kredensial sah, jadi
 * percobaan berulang hanya menghasilkan kegagalan tanpa akhir sekaligus
 * membebani WhatsApp; yang dibutuhkan adalah manusia memindai QR. Keadaan
 * UNPAIRED juga bukan urusan sambung-ulang: belum ada yang bisa disambung.
 */
export function shouldReconnect(state: WhatsAppConnectionState): boolean {
  return state === "DISCONNECTED"
}

// --- tombol kontekstual -----------------------------------------------------

export type WhatsAppConnectionAction = "connect" | "reconnect" | "relogin" | "logout"

export type ConnectionActionDescriptor = {
  action: WhatsAppConnectionAction
  label: string
  /** Label saat aksi sedang berjalan. */
  busyLabel: string
  variant: "default" | "outline" | "destructive"
  /**
   * Tombol yang hanya menerangkan keadaan dan tidak dapat ditekan — dipakai
   * saat koneksi sedang dibuka.
   */
  disabled?: boolean
}

/**
 * Tombol apa yang masuk akal pada keadaan ini.
 *
 * Aturan yang dijaga: "Hubungkan" dan "Sambungkan ulang" TIDAK PERNAH muncul
 * bersamaan, karena keduanya berarti hal berbeda dan menampilkan keduanya
 * memaksa admin menebak. Saat sesi sudah tidak sah, satu-satunya jalan keluar
 * yang benar adalah login ulang, jadi hanya itu yang ditawarkan.
 */
export function connectionActionsFor(
  state: WhatsAppConnectionState,
  sessionExists: boolean,
): ConnectionActionDescriptor[] {
  const logout: ConnectionActionDescriptor = {
    action: "logout",
    label: "Keluar & hapus sesi",
    busyLabel: "Menghapus sesi…",
    variant: "destructive",
  }

  switch (state) {
    case "UNPAIRED":
      return [
        {
          action: "connect",
          label: "Hubungkan WhatsApp",
          busyLabel: "Menghubungkan…",
          variant: "default",
        },
      ]

    case "CONNECTING":
      return [
        {
          action: "connect",
          label: "Menghubungkan…",
          busyLabel: "Menghubungkan…",
          variant: "default",
          disabled: true,
        },
      ]

    case "WAITING_QR":
      return [
        {
          action: "logout",
          label: "Batalkan penautan",
          busyLabel: "Membatalkan…",
          variant: "destructive",
        },
      ]

    case "CONNECTED":
      return [logout]

    case "DISCONNECTED":
      // Tanpa kredensial di disk, "sambungkan ulang" tidak punya apa pun untuk
      // disambung; yang benar adalah penautan baru.
      return sessionExists
        ? [
            {
              action: "reconnect",
              label: "Sambungkan ulang",
              busyLabel: "Menyambungkan ulang…",
              variant: "default",
            },
            logout,
          ]
        : [
            {
              action: "connect",
              label: "Hubungkan WhatsApp",
              busyLabel: "Menghubungkan…",
              variant: "default",
            },
          ]

    case "LOGGED_OUT":
      return [
        {
          action: "relogin",
          label: "Login ulang",
          busyLabel: "Menyiapkan QR baru…",
          variant: "default",
        },
      ]

    case "ERROR":
      return [
        {
          action: "reconnect",
          label: "Coba sambungkan lagi",
          busyLabel: "Mencoba…",
          variant: "outline",
        },
      ]
  }
}
