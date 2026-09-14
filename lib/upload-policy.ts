/**
 * Resolver kebijakan upload dan validator terpusat.
 *
 * CLIENT-SAFE: murni, tanpa Prisma dan tanpa sesi — konfigurasi dikirim masuk
 * sebagai argumen. Server membacanya dari database; klien menerimanya dari
 * endpoint. Karena logikanya satu, batas yang ditampilkan form selalu batas
 * yang ditegakkan route handler.
 *
 * Urutan penentuan batas sebuah slot:
 *
 *   override admin untuk slot   → dipakai
 *   tidak ada override          → `defaultMaxBytes` milik slot
 *   slot tanpa batas bawaan     → default global kategori slot
 *   slot tidak terdaftar        → GAGAL TERTUTUP (melempar)
 *
 * Slot yang tidak dikenal tidak pernah berarti "tanpa batas". Kunci slot
 * selalu berasal dari kode pemanggil, tidak pernah dari payload klien; bila
 * suatu saat ada yang meneruskan kunci kiriman klien, resolver ini menolaknya
 * alih-alih memberi kelonggaran.
 *
 * GRANDFATHERING: modul ini hanya memeriksa KANDIDAT upload. Berkas yang sudah
 * tersimpan tidak pernah dilewatkan ke sini, sehingga menurunkan batas tidak
 * membatalkan aset lama. Mengganti berkas adalah upload baru dan melewati
 * pemeriksaan yang sama seperti unggahan pertama.
 */

import {
  findUploadSlot,
  formatBytes,
  type UploadCategory,
  type UploadSlot,
} from "@/lib/upload-slots"

/** Batas global bawaan per kategori, dipakai saat admin belum menyetel apa pun. */
export const DEFAULT_GLOBAL_LIMITS: Record<UploadCategory, number> = {
  image: 2 * 1024 * 1024,
  document: 5 * 1024 * 1024,
}

/**
 * Batas atas yang boleh disetel admin. Bukan selera: nilai di atas ini membuat
 * satu request menahan memori proses Node dalam jumlah yang bisa menjatuhkan
 * server, karena berkas dibaca utuh ke memori sebelum disimpan.
 */
export const MAX_CONFIGURABLE_UPLOAD_BYTES = 64 * 1024 * 1024

/** Batas bawah; nol atau negatif akan mematikan fitur secara diam-diam. */
export const MIN_CONFIGURABLE_UPLOAD_BYTES = 32 * 1024

export type UploadPolicyConfig = {
  readonly globalLimits?: Partial<Record<UploadCategory, number>>
  /// Override per slot, dalam byte. Kunci yang tidak dikenal diabaikan.
  readonly slotOverrides?: Readonly<Record<string, number>>
}

export type ResolvedUploadPolicy = {
  readonly slot: UploadSlot
  readonly maxBytes: number
  /// Dari mana angka `maxBytes` berasal; dipakai UI untuk menandai Custom/Default.
  readonly source: "override" | "slot_default" | "category_default"
  readonly allowedMimeTypes?: readonly string[]
}

export type UploadErrorCode =
  | "UPLOAD_SLOT_UNKNOWN"
  | "UPLOAD_POLICY_INVALID"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_NOT_ALLOWED"
  | "FILE_MISSING"

/**
 * Error domain upload. Membawa kode yang stabil untuk dipetakan ke status HTTP,
 * dan pesan berbahasa Indonesia yang aman ditampilkan apa adanya kepada
 * pengguna — tanpa path internal maupun stack.
 */
export class UploadPolicyError extends Error {
  readonly code: UploadErrorCode
  readonly status: number

  constructor(code: UploadErrorCode, message: string, status: number) {
    super(message)
    this.name = "UploadPolicyError"
    this.code = code
    this.status = status
  }
}

/** Apakah `value` sah sebagai batas ukuran? Dipakai resolver dan validasi input admin. */
export function isValidLimitBytes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_CONFIGURABLE_UPLOAD_BYTES &&
    value <= MAX_CONFIGURABLE_UPLOAD_BYTES
  )
}

function globalLimitFor(category: UploadCategory, config: UploadPolicyConfig): number {
  const configured = config.globalLimits?.[category]
  // Nilai rusak di database (negatif, NaN, di luar rentang) tidak boleh
  // menjadi kebijakan. Kembali ke bawaan kode, bukan menolak seluruh upload:
  // menolak akan mematikan setiap unggahan gara-gara satu baris konfigurasi.
  return isValidLimitBytes(configured) ? configured : DEFAULT_GLOBAL_LIMITS[category]
}

/**
 * Kebijakan efektif untuk sebuah slot.
 *
 * @throws {UploadPolicyError} bila `slotKey` tidak terdaftar di registry.
 */
export function resolveUploadPolicy(
  slotKey: string,
  config: UploadPolicyConfig = {},
): ResolvedUploadPolicy {
  const slot = findUploadSlot(slotKey)
  if (!slot) {
    throw new UploadPolicyError(
      "UPLOAD_SLOT_UNKNOWN",
      "Tujuan unggahan tidak dikenal",
      400,
    )
  }

  const override = config.slotOverrides?.[slot.key]
  // Override hanya berlaku untuk slot yang memang boleh disetel admin. Baris
  // sisa untuk slot non-configurable (mis. setelah metadata slot diubah)
  // tidak boleh diam-diam melonggarkan operasi sistem.
  if (slot.configurable !== false && isValidLimitBytes(override)) {
    return { slot, maxBytes: override, source: "override", allowedMimeTypes: slot.allowedMimeTypes }
  }

  if (typeof slot.defaultMaxBytes === "number") {
    return {
      slot,
      maxBytes: slot.defaultMaxBytes,
      source: "slot_default",
      allowedMimeTypes: slot.allowedMimeTypes,
    }
  }

  return {
    slot,
    maxBytes: globalLimitFor(slot.category, config),
    source: "category_default",
    allowedMimeTypes: slot.allowedMimeTypes,
  }
}

export type UploadCandidate = {
  readonly size: number
  /// Tipe hasil deteksi isi berkas. `null` berarti isinya tidak dikenali.
  readonly detectedMimeType?: string | null
  readonly fileName?: string
}

/**
 * Gerbang tunggal sebelum menyimpan. Memeriksa ukuran, lalu format bila slot
 * memang mendeklarasikan daftar format.
 *
 * Pemeriksaan format memakai tipe hasil DETEKSI ISI berkas yang disediakan
 * pemanggil, bukan `file.type` atau ekstensi. Bila slot tidak mendeklarasikan
 * `allowedMimeTypes`, validasi format tetap menjadi tanggung jawab domain
 * pemanggil dan tidak dilonggarkan di sini.
 *
 * @throws {UploadPolicyError}
 */
export function assertUploadAllowed(
  slotKey: string,
  candidate: UploadCandidate,
  config: UploadPolicyConfig = {},
): ResolvedUploadPolicy {
  const policy = resolveUploadPolicy(slotKey, config)

  if (!Number.isFinite(candidate.size) || candidate.size < 0) {
    throw new UploadPolicyError("FILE_MISSING", "Berkas tidak terbaca", 400)
  }
  if (candidate.size === 0) {
    throw new UploadPolicyError("FILE_MISSING", "Berkas kosong", 400)
  }

  if (candidate.size > policy.maxBytes) {
    throw new UploadPolicyError("FILE_TOO_LARGE", tooLargeMessage(candidate, policy), 413)
  }

  if (policy.allowedMimeTypes && candidate.detectedMimeType !== undefined) {
    const detected = candidate.detectedMimeType
    if (!detected || !policy.allowedMimeTypes.includes(detected)) {
      throw new UploadPolicyError(
        "FILE_TYPE_NOT_ALLOWED",
        `Format berkas tidak didukung. Gunakan ${describeFormats(policy.allowedMimeTypes)}.`,
        415,
      )
    }
  }

  return policy
}

/** Pesan yang menyebut nama, ukuran, dan batas — bukan sekadar "gagal". */
export function tooLargeMessage(
  candidate: Pick<UploadCandidate, "size" | "fileName">,
  policy: Pick<ResolvedUploadPolicy, "maxBytes">,
): string {
  const subject = candidate.fileName ? `Berkas "${candidate.fileName}"` : "Ukuran berkas"
  return `${subject} berukuran ${formatBytes(candidate.size)}, melebihi batas maksimum ${formatBytes(policy.maxBytes)}.`
}

const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  "image/x-icon": "ICO",
  "text/csv": "CSV",
}

/** Daftar format dalam bahasa manusia: "JPG, PNG, atau WebP". */
export function describeFormats(types: readonly string[]): string {
  const labels = types.map((type) => MIME_LABELS[type] ?? type)
  if (labels.length <= 1) return labels.join("")
  return `${labels.slice(0, -1).join(", ")}, atau ${labels[labels.length - 1]}`
}

/**
 * Pastikan hasil deteksi isi berkas termasuk format yang diizinkan slot, lalu
 * kembalikan tipenya dalam bentuk yang sudah menyempit.
 *
 * Dipisah dari pemeriksaan ukuran karena deteksi format menuntut isi berkas
 * sudah dibaca, sementara ukuran harus diperiksa lebih dulu — memuat berkas
 * raksasa ke memori hanya untuk mengetahui formatnya adalah urutan yang salah.
 *
 * @throws {UploadPolicyError}
 */
export function assertDetectedType<T extends string>(
  policy: ResolvedUploadPolicy,
  detected: T | null,
): T {
  const allowed = policy.allowedMimeTypes
  if (!detected || (allowed && !allowed.includes(detected))) {
    const formats = allowed ? ` Gunakan ${describeFormats(allowed)}.` : ""
    throw new UploadPolicyError(
      "FILE_TYPE_NOT_ALLOWED",
      `Format berkas tidak didukung.${formats}`,
      415,
    )
  }
  return detected
}
