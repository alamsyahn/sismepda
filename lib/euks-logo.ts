/**
 * Validasi berkas logo hero E-UKS.
 *
 * Terpisah dari `lib/profile.ts` karena logo menerima SVG, sedangkan foto profil
 * dan foto hero tidak. SVG adalah dokumen yang dapat dieksekusi, bukan sekadar
 * piksel, jadi berkas ini menanggung dua tanggung jawab yang tidak dimiliki
 * detektor raster: mengenali SVG tanpa tertipu, dan menolak SVG yang membawa
 * skrip.
 *
 * Berkas ini murni fungsi — tanpa impor Prisma atau Node — sehingga aman
 * dipakai komponen klien maupun route handler.
 */

export const EUKS_LOGO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
] as const

export type EuksLogoType = (typeof EUKS_LOGO_TYPES)[number]

/**
 * Batas ukuran logo. Jauh lebih kecil dari foto hero (2 MB) karena logo
 * institusi yang wajar hanya puluhan sampai ratusan KB; batas ketat sekaligus
 * membatasi biaya pemindaian SVG di bawah.
 */
export const MAX_EUKS_LOGO_BYTES = 512 * 1024

/** Ekstensi untuk atribut `accept` pada input berkas. */
export const EUKS_LOGO_ACCEPT = ".jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml"

/** Label format yang didukung, untuk ditampilkan di form pengaturan. */
export const EUKS_LOGO_FORMAT_LABEL = "JPG, PNG, SVG, atau WebP"

/**
 * Tipe logo dari isi berkas, bukan dari header `Content-Type` kiriman klien.
 *
 * Raster dikenali lewat magic bytes. SVG tidak punya magic bytes — ia teks XML —
 * jadi yang diperiksa adalah keberadaan elemen `<svg` setelah melewati BOM,
 * spasi, deklarasi XML, komentar, dan DOCTYPE. Pemeriksaan dibatasi pada 4 KB
 * pertama supaya berkas besar tidak perlu di-decode seluruhnya.
 */
export function detectEuksLogoType(bytes: Uint8Array): EuksLogoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  if (looksLikeSvg(bytes)) return "image/svg+xml"
  return null
}

/** Decode awal berkas sebagai UTF-8; sisanya tidak relevan untuk deteksi. */
function decodeHead(bytes: Uint8Array, limit = 4096): string {
  const head = bytes.subarray(0, Math.min(bytes.length, limit))
  return new TextDecoder("utf-8", { fatal: false }).decode(head)
}

/**
 * Benarkah ini dokumen SVG?
 *
 * Prolog XML (deklarasi, komentar, DOCTYPE, processing instruction) dilewati
 * satu per satu, lalu elemen pertama harus benar-benar `<svg`. Mencari `<svg`
 * di mana saja akan meloloskan berkas HTML yang menyelipkan `<svg>` di tengah.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  let text = decodeHead(bytes).replace(/^\uFEFF/, "").trimStart()
  if (!text.startsWith("<")) return false

  // Buang prolog berulang kali sampai bertemu elemen sungguhan.
  for (let guard = 0; guard < 20; guard += 1) {
    if (text.startsWith("<?")) {
      const end = text.indexOf("?>")
      if (end === -1) return false
      text = text.slice(end + 2).trimStart()
      continue
    }
    if (text.startsWith("<!--")) {
      const end = text.indexOf("-->")
      if (end === -1) return false
      text = text.slice(end + 3).trimStart()
      continue
    }
    if (/^<!DOCTYPE/i.test(text)) {
      const end = text.indexOf(">")
      if (end === -1) return false
      text = text.slice(end + 1).trimStart()
      continue
    }
    break
  }

  // Elemen pertama harus <svg, diikuti pembatas nama yang sah.
  return /^<svg[\s/>]/i.test(text)
}

/**
 * Pola yang membuat sebuah SVG berbahaya bila pernah dirender sebagai dokumen.
 *
 * Logo disajikan lewat <img src>, yang sudah menempatkan SVG dalam mode aman:
 * peramban tidak menjalankan skrip dan tidak memuat sumber daya luar untuk SVG
 * di dalam <img>. Penolakan ini lapis kedua — supaya berkas yang jelas-jelas
 * bermuatan skrip tidak pernah tersimpan di basis data sekolah, apa pun cara
 * seseorang membukanya kelak (mengunduh lalu membuka langsung, misalnya).
 */
const SVG_DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<script[\s/>]/i, reason: "mengandung elemen <script>" },
  { pattern: /<foreignObject[\s/>]/i, reason: "mengandung <foreignObject>" },
  { pattern: /<iframe[\s/>]/i, reason: "mengandung <iframe>" },
  { pattern: /<embed[\s/>]/i, reason: "mengandung <embed>" },
  { pattern: /<object[\s/>]/i, reason: "mengandung <object>" },
  { pattern: /<use[^>]+href\s*=\s*["']?\s*(?:https?:)?\/\//i, reason: "memuat <use> dari sumber luar" },
  { pattern: /\son\w+\s*=/i, reason: "mengandung atribut event seperti onload" },
  { pattern: /javascript\s*:/i, reason: "mengandung URL javascript:" },
  { pattern: /<!ENTITY/i, reason: "mendefinisikan entitas XML" },
]

export type SvgCheck = { safe: true } | { safe: false; reason: string }

/**
 * Periksa muatan SVG. Seluruh berkas dibaca, bukan hanya kepalanya, karena
 * skrip bisa berada di mana saja. Ukurannya sudah dibatasi 512 KB.
 */
export function checkSvgPayload(bytes: Uint8Array): SvgCheck {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  for (const { pattern, reason } of SVG_DANGEROUS_PATTERNS) {
    if (pattern.test(text)) return { safe: false, reason }
  }
  return { safe: true }
}

/** URL logo hero; aturan cache-busting sama dengan foto pengurus/fasilitas. */
export function euksHeroLogoUrl(
  id: string,
  updatedAt: Date | string | null | undefined,
): string | null {
  if (!updatedAt) return null
  return `/api/e-uks/hero-logos/${id}/logo?v=${new Date(updatedAt).getTime()}`
}
