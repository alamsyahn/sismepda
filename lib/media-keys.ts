/**
 * Kunci logis media: pembuatan, validasi, dan pemetaan ke jalur relatif.
 *
 * Modul ini MURNI — tidak menyentuh filesystem, database, maupun `process.env`
 * — sehingga aman diimpor dari komponen klien dan dari test tanpa menyiapkan
 * apa pun. Seluruh keputusan keamanan tentang bentuk kunci ada di sini, di satu
 * tempat, supaya backend penyimpanan mana pun (filesystem hari ini, object
 * storage kelak) mewarisi aturan yang sama alih-alih menegakkannya sendiri.
 *
 * Kunci adalah identitas logis, BUKAN jalur absolut. Database hanya menyimpan
 * string seperti `euks/hero/9f2c...webp`; letak sebenarnya ditentukan runtime
 * lewat MEDIA_STORAGE_ROOT. Menyimpan jalur absolut akan mengunci data pada
 * satu mesin dan membocorkan tata letak server ke klien.
 */

import { randomUUID } from "node:crypto"

/**
 * Kategori media = direktori tingkat pertama. Daftar tertutup: kategori baru
 * harus ditambahkan di sini secara sadar, sehingga tidak ada pemanggil yang
 * diam-diam menciptakan pohon direktori baru di volume produksi.
 */
export const MEDIA_CATEGORIES = [
  "users",
  "branding",
  "euks",
  "sarpras",
  "students",
] as const

export type MediaCategory = (typeof MEDIA_CATEGORIES)[number]

/**
 * Sub-direktori per kategori. Dipisah dari kategori agar tata letak berkas
 * terbaca manusia saat menelusuri volume (`euks/hero`, `euks/officer`) tanpa
 * memberi pemanggil kebebasan menyusun jalur sendiri.
 */
export const MEDIA_SCOPES = {
  "users/avatar": { category: "users", prefix: "users/avatar" },
  "branding/app-logo": { category: "branding", prefix: "branding/app-logo" },
  "branding/favicon": { category: "branding", prefix: "branding/favicon" },
  "euks/hero": { category: "euks", prefix: "euks/hero" },
  "euks/hero-logo": { category: "euks", prefix: "euks/hero-logo" },
  "euks/officer": { category: "euks", prefix: "euks/officer" },
  "euks/facility": { category: "euks", prefix: "euks/facility" },
  "sarpras/item": { category: "sarpras", prefix: "sarpras/item" },
  /**
   * Belum dipakai kode mana pun: foto siswa belum ada fiturnya. Scope-nya
   * didaftarkan lebih dulu supaya implementasi nanti tidak tergoda menambah
   * kolom `Bytes` baru — lihat docs/architecture/media-storage.md.
   */
  "students/photo": { category: "students", prefix: "students/photo" },
} as const satisfies Record<string, { category: MediaCategory; prefix: string }>

export type MediaScope = keyof typeof MEDIA_SCOPES

/**
 * Ekstensi yang boleh muncul pada kunci, dipetakan dari MIME hasil deteksi
 * magic bytes — bukan dari nama berkas kiriman pengguna. Nama asli tidak pernah
 * ikut ke jalur filesystem sama sekali.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
}

/** Ekstensi cadangan bila MIME tidak dikenal; isi berkas tetap divalidasi di lapisan unggah. */
const FALLBACK_EXTENSION = "bin"

export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? FALLBACK_EXTENSION
}

/**
 * Bentuk kunci yang sah: segmen huruf kecil/angka/`-`/`_`, dipisah `/`, diakhiri
 * satu ekstensi. Sengaja ketat dan berbasis allowlist, bukan blacklist `..`:
 * pola yang hanya melarang `..` akan lolos untuk `%2e%2e`, backslash Windows,
 * atau jalur absolut, sedangkan pola ini menolak semuanya karena karakternya
 * memang tidak ada di daftar yang diizinkan.
 */
const MEDIA_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)+\.[a-z0-9]+$/

/** Kunci lebih panjang dari ini menandakan penyalahgunaan, bukan nama wajar. */
const MAX_MEDIA_KEY_LENGTH = 200

export class MediaKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaKeyError"
  }
}

/** True bila `key` aman dipakai sebagai jalur relatif di backend penyimpanan. */
export function isValidMediaKey(key: unknown): key is string {
  if (typeof key !== "string") return false
  if (key.length === 0 || key.length > MAX_MEDIA_KEY_LENGTH) return false
  // Cek eksplisit walau pola sudah menolaknya: membuat maksud terbaca oleh
  // pembaca berikutnya, dan menjaga jaring tetap ada bila pola dilonggarkan.
  if (key.includes("..") || key.includes("\\") || key.includes("\0")) return false
  if (key.startsWith("/")) return false
  const category = key.split("/")[0]
  if (!MEDIA_CATEGORIES.includes(category as MediaCategory)) return false
  return MEDIA_KEY_PATTERN.test(key)
}

/** Varian melempar; dipakai backend penyimpanan sebelum menyentuh filesystem. */
export function assertValidMediaKey(key: unknown): string {
  if (!isValidMediaKey(key)) {
    // Nilai yang ditolak tidak ikut dicetak: ia berasal dari input dan bisa
    // berakhir di log atau respons.
    throw new MediaKeyError("Kunci media tidak valid")
  }
  return key
}

/**
 * Buat kunci baru untuk satu unggahan. Selalu UUID acak: tidak ada bagian kunci
 * yang berasal dari input pengguna, sehingga tidak ada tabrakan nama, tidak ada
 * penimpaan berkas milik record lain, dan tidak ada jalur yang bisa ditebak.
 */
export function generateMediaKey(scope: MediaScope, mimeType: string): string {
  const { prefix } = MEDIA_SCOPES[scope]
  const key = `${prefix}/${randomUUID()}.${extensionForMimeType(mimeType)}`
  // Sabuk pengaman: bila daftar scope kelak diedit menjadi bentuk yang tidak
  // lolos validasi, kegagalan muncul di sini alih-alih menjadi kunci rusak di
  // database yang baru ketahuan saat gambar tidak bisa dibaca.
  return assertValidMediaKey(key)
}

/** Kategori dari sebuah kunci, untuk pelaporan/statistik. */
export function mediaCategoryOf(key: string): MediaCategory | null {
  const category = key.split("/")[0]
  return MEDIA_CATEGORIES.includes(category as MediaCategory) ? (category as MediaCategory) : null
}
