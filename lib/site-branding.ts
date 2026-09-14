export const DEFAULT_WEBSITE_TITLE = "SISMEPDA — Dashboard Absensi Sekolah"
export const FAVICON_ACCEPT = ".png,.ico,image/png,image/x-icon,image/vnd.microsoft.icon"

/** Identitas aplikasi yang tampil pada area branding sidebar. */
export const DEFAULT_APP_NAME = "SISMEPDA"
export const DEFAULT_APP_FULL_NAME = "Sistem Informasi Sekolah"
export const MAX_APP_NAME_LENGTH = 40
export const MAX_APP_FULL_NAME_LENGTH = 80

export const APP_LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
/** Logo default ketika admin belum pernah mengunggah logo sendiri. */
export const DEFAULT_APP_LOGO_URL = "/icon.svg"

export type AppLogoMimeType = "image/png" | "image/jpeg" | "image/webp"

/**
 * Deteksi tipe logo dari magic bytes, bukan dari `file.type` atau ekstensi —
 * keduanya dikirim client dan bisa dipalsukan. SVG sengaja tidak didukung
 * karena dapat memuat script sehingga butuh sanitization tersendiri.
 */
export function detectAppLogoType(bytes: Uint8Array): AppLogoMimeType | null {
  const png = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  if (png) return "image/png"

  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (jpeg) return "image/jpeg"

  // WebP: "RIFF" .... "WEBP"
  const webp = bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  return webp ? "image/webp" : null
}

/**
 * URL logo aplikasi. Query `v` memakai timestamp update sehingga browser
 * mengambil ulang logo baru tanpa perlu cache busting manual.
 */
export function appLogoUrl(updatedAt?: string | Date | null): string {
  if (!updatedAt) return DEFAULT_APP_LOGO_URL
  const timestamp = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime()
  return `/app-logo?v=${timestamp}`
}

/** Normalisasi teks branding: kosong/whitespace kembali ke nilai default. */
export function resolveAppName(value?: string | null): string {
  return value?.trim() || DEFAULT_APP_NAME
}

export function resolveAppFullName(value?: string | null): string {
  return value?.trim() || DEFAULT_APP_FULL_NAME
}


export function detectFaviconType(bytes: Uint8Array): "image/png" | "image/x-icon" | null {
  const png = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  if (png) return "image/png"

  const ico = bytes.length >= 6
    && bytes[0] === 0x00
    && bytes[1] === 0x00
    && bytes[2] === 0x01
    && bytes[3] === 0x00
    && bytes[4] > 0
  return ico ? "image/x-icon" : null
}

export function faviconUrl(updatedAt?: string | Date | null): string {
  if (!updatedAt) return "/favicon.ico"
  const timestamp = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime()
  return `/favicon.ico?v=${timestamp}`
}
