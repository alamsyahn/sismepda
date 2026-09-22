/**
 * Normalisasi nomor telepon Indonesia — SATU-SATUNYA tempat aturannya hidup.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Nomor guru diketik manusia: `0857 8409 5162`, `+62 857-8409-5162`,
 * `62857.8409.5162`, kadang dengan awalan `(0)`. WhatsApp hanya menerima satu
 * bentuk: deret digit berawalan kode negara. Menyebar regex kecil-kecil ke
 * komponen React dan route handler berarti setiap tempat memperbaiki kasus
 * yang kebetulan ia temui, dan nomor yang lolos di satu layar ditolak di layar
 * lain.
 *
 * YANG SENGAJA TIDAK DILAKUKAN
 *
 * Tidak pernah sekadar menempelkan `+62` di depan apa pun. `085784095162`
 * bukan `+62085784095162`; angka `0` pertama adalah awalan nasional yang harus
 * DIGANTI, bukan dipertahankan. Nomor yang tidak dapat dipastikan bentuknya
 * dikembalikan sebagai tidak sah beserta alasannya, bukan ditebak — pesan yang
 * terkirim ke nomor keliru tidak dapat ditarik kembali.
 *
 * MURNI dan CLIENT-SAFE: tanpa Prisma, tanpa Node API, tanpa jaringan.
 */

/** Kode negara Indonesia, tanpa `+`. */
export const INDONESIA_COUNTRY_CODE = "62"

/**
 * Batas panjang nomor seluler Indonesia dalam bentuk `62…`.
 *
 * Nomor seluler nasional berbentuk `08xx…` sepanjang 10–13 digit, sehingga
 * bentuk internasionalnya 11–14 digit. Batas ini menolak salah ketik yang
 * kentara (nomor terpotong atau kelebihan digit) tanpa berpura-pura tahu blok
 * nomor mana yang sedang dialokasikan operator.
 */
export const MIN_DIGITS = 11
export const MAX_DIGITS = 14

export type PhoneInvalidReason =
  /** Kolom nomor kosong atau hanya berisi pemisah. */
  | "EMPTY"
  /** Ada karakter selain digit, spasi, `+`, `-`, `.`, `(`, `)`. */
  | "INVALID_CHARACTER"
  /** Bukan nomor Indonesia yang dikenali (bukan `0…`, `62…`, `+62…`, `8…`). */
  | "UNKNOWN_PREFIX"
  | "TOO_SHORT"
  | "TOO_LONG"

export const PHONE_INVALID_MESSAGES: Record<PhoneInvalidReason, string> = {
  EMPTY: "Nomor WhatsApp belum diisi.",
  INVALID_CHARACTER: "Nomor WhatsApp mengandung karakter yang tidak dikenal.",
  UNKNOWN_PREFIX:
    "Nomor WhatsApp bukan nomor Indonesia yang dikenali. Gunakan format 08xxxxxxxxxx atau +62xxxxxxxxxx.",
  TOO_SHORT: "Nomor WhatsApp terlalu pendek.",
  TOO_LONG: "Nomor WhatsApp terlalu panjang.",
}

export function phoneInvalidMessage(reason: PhoneInvalidReason): string {
  return PHONE_INVALID_MESSAGES[reason]
}

export type NormalizedPhone =
  | {
      valid: true
      /** Deret digit siap dipakai WhatsApp, mis. `6285784095162`. */
      whatsapp: string
      /** Bentuk yang ditampilkan ke manusia, mis. `+6285784095162`. */
      display: string
    }
  | {
      valid: false
      reason: PhoneInvalidReason
      message: string
    }

/** Karakter pemisah yang lazim diketik manusia dan tidak mengubah nomor. */
const SEPARATORS = /[\s().-]/g

/** Hanya digit yang tersisa setelah pemisah dibuang; `+` hanya boleh di depan. */
const ALLOWED = /^\+?\d+$/

function invalid(reason: PhoneInvalidReason): NormalizedPhone {
  return { valid: false, reason, message: phoneInvalidMessage(reason) }
}

/**
 * Mengubah nomor apa adanya menjadi bentuk kanonik WhatsApp.
 *
 * Pemetaan yang dijamin:
 *
 *   `085784095162`     → `6285784095162`
 *   `08 578-409-5162`  → `6285784095162`
 *   `+6285784095162`   → `6285784095162`
 *   `6285784095162`    → `6285784095162`
 *   `85784095162`      → `6285784095162`
 *
 * Bentuk terakhir (tanpa `0` maupun `62`) diterima karena sebagian data lama
 * menyimpannya demikian; ia tetap diperiksa panjang, sehingga angka acak tidak
 * berubah menjadi nomor yang tampak sah.
 */
export function normalizeIndonesianPhone(value: string | null | undefined): NormalizedPhone {
  const raw = (value ?? "").trim()
  if (raw.length === 0) return invalid("EMPTY")

  const compact = raw.replace(SEPARATORS, "")
  if (compact.length === 0) return invalid("EMPTY")
  if (!ALLOWED.test(compact)) return invalid("INVALID_CHARACTER")

  // `+` hanya bermakna sebagai penanda kode negara dan tidak ikut disimpan.
  const digits = compact.startsWith("+") ? compact.slice(1) : compact

  let national: string
  if (digits.startsWith(INDONESIA_COUNTRY_CODE)) {
    national = digits.slice(INDONESIA_COUNTRY_CODE.length)
    // `620…` terjadi saat `+62` ditempelkan di depan nomor yang masih berawalan
    // nol. Nol nasional dibuang, bukan dipertahankan.
    if (national.startsWith("0")) national = national.replace(/^0+/, "")
  } else if (digits.startsWith("0")) {
    national = digits.slice(1)
  } else if (digits.startsWith("8")) {
    national = digits
  } else {
    return invalid("UNKNOWN_PREFIX")
  }

  if (national.length === 0) return invalid("TOO_SHORT")
  // Nomor seluler Indonesia selalu dimulai angka 8 setelah awalan nasional.
  if (!national.startsWith("8")) return invalid("UNKNOWN_PREFIX")

  const whatsapp = `${INDONESIA_COUNTRY_CODE}${national}`
  if (whatsapp.length < MIN_DIGITS) return invalid("TOO_SHORT")
  if (whatsapp.length > MAX_DIGITS) return invalid("TOO_LONG")

  return { valid: true, whatsapp, display: `+${whatsapp}` }
}

/**
 * JID WhatsApp untuk nomor perorangan.
 *
 * Dipisahkan dari normalisasi supaya bentuk JID hanya ditulis di satu tempat:
 * grup memakai `@g.us`, nomor perorangan `@s.whatsapp.net`, dan menukar
 * keduanya menghasilkan pengiriman yang gagal dengan pesan yang tidak
 * menjelaskan apa pun.
 */
export const PERSONAL_JID_SUFFIX = "@s.whatsapp.net"

export function personalJidFor(whatsappDigits: string): string {
  return `${whatsappDigits}${PERSONAL_JID_SUFFIX}`
}

/** Apakah sebuah JID menunjuk nomor perorangan (bukan grup)? */
export function isPersonalJid(value: unknown): value is string {
  return typeof value === "string" && /^\d+@s\.whatsapp\.net$/.test(value.trim())
}
