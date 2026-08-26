export const DEFAULT_WEBSITE_TITLE = "SISMEPDA — Dashboard Absensi Sekolah"
export const MAX_FAVICON_BYTES = 512 * 1024
export const FAVICON_ACCEPT = ".png,.ico,image/png,image/x-icon,image/vnd.microsoft.icon"

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
