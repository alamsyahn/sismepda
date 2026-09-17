/**
 * Pembacaan template pesan dari kolom JSON.
 *
 * MENGAPA BERKAS INI ADA
 *
 * `WhatsAppConfiguration.messageTemplates` adalah `Json?`, sehingga isinya
 * tidak dijamin oleh tipe apa pun: baris bisa ditulis versi aplikasi lama,
 * disunting tangan, atau rusak sebagian. Berkas ini adalah satu-satunya pintu
 * masuk data itu, dan ia SELALU memvalidasi.
 *
 * ATURAN JATUH KEMBALI (fallback) bersifat per-kondisi, bukan per-baris:
 * kondisi yang tersimpan dan sah memakai template admin, kondisi yang tidak
 * memakai template bawaan. Satu template rusak karena itu tidak pernah
 * membungkam tiga kondisi lain — dan tidak pernah membuat pesan menjadi kosong.
 *
 * MURNI: tanpa Prisma. Menerima nilai JSON yang sudah dibaca pemanggil.
 */
import { z } from "zod"

import { defaultTemplate } from "@/lib/whatsapp-template-defaults"
import {
  collectionsFor,
  TEMPLATE_KEYS,
  validateTemplate,
  type WhatsAppCollectionKey,
  type WhatsAppTemplate,
  type WhatsAppTemplateKey,
  type WhatsAppTemplateSet,
} from "@/lib/whatsapp-template"

const itemSchema = z.object({
  format: z.string(),
  separator: z.enum(["NEWLINE", "BLANK_LINE"]),
})

const templateSchema = z.object({
  body: z.string(),
  items: z.record(z.string(), itemSchema).default({}),
})

/**
 * Seluruh kunci bersifat opsional: admin mungkin baru menyunting satu kondisi,
 * dan versi berikutnya mungkin menambah kondisi baru yang belum ada di baris
 * lama.
 */
const storedSchema = z.record(z.string(), templateSchema)

export type StoredTemplates = Partial<Record<WhatsAppTemplateKey, WhatsAppTemplate>>

/**
 * Menormalkan satu template: hanya koleksi yang memang milik kondisi itu yang
 * dipertahankan, dan koleksi yang formatnya belum diisi mewarisi format bawaan.
 */
function normalizeTemplate(key: WhatsAppTemplateKey, template: WhatsAppTemplate): WhatsAppTemplate {
  const fallback = defaultTemplate(key)
  const items: WhatsAppTemplate["items"] = {}
  for (const collection of collectionsFor(key)) {
    items[collection] = template.items[collection] ?? fallback.items[collection]
  }
  return { body: template.body, items }
}

/**
 * Membaca kolom JSON menjadi template yang sah.
 *
 * Template yang GAGAL divalidasi dibuang diam-diam di sini dan digantikan
 * bawaan. Itu disengaja: jalur ini dipakai saat mengirim pesan, dan menggagalkan
 * pengiriman karena satu placeholder salah ketik akan membuat sekolah kehilangan
 * laporan hariannya. Kesalahan template dicegah lebih awal — di titik SIMPAN,
 * tempat admin masih melihat layarnya.
 */
export function parseStoredTemplates(value: unknown): StoredTemplates {
  if (value === null || value === undefined) return {}
  const parsed = storedSchema.safeParse(value)
  if (!parsed.success) return {}

  const result: StoredTemplates = {}
  for (const key of TEMPLATE_KEYS) {
    const candidate = parsed.data[key]
    if (!candidate) continue
    const normalized = normalizeTemplate(key, candidate as WhatsAppTemplate)
    if (validateTemplate(key, normalized).length > 0) continue
    result[key] = normalized
  }
  return result
}

/** Template efektif untuk satu kondisi: milik admin bila ada, selain itu bawaan. */
export function effectiveTemplate(
  key: WhatsAppTemplateKey,
  stored: StoredTemplates,
): WhatsAppTemplate {
  return stored[key] ?? defaultTemplate(key)
}

/** Set lengkap untuk ditampilkan di editor. */
export function effectiveTemplateSet(stored: StoredTemplates): WhatsAppTemplateSet {
  return {
    MISSING_PENDING: effectiveTemplate("MISSING_PENDING", stored),
    MISSING_COMPLETE: effectiveTemplate("MISSING_COMPLETE", stored),
    ABSENT_PRESENT: effectiveTemplate("ABSENT_PRESENT", stored),
    ABSENT_NONE: effectiveTemplate("ABSENT_NONE", stored),
    ABSENT_INCOMPLETE: effectiveTemplate("ABSENT_INCOMPLETE", stored),
  }
}

/** Kondisi mana yang benar-benar disimpan admin — dipakai UI menandai "bawaan". */
export function customizedKeys(stored: StoredTemplates): WhatsAppTemplateKey[] {
  return TEMPLATE_KEYS.filter((key) => stored[key] !== undefined)
}

/**
 * Menyiapkan nilai yang akan ditulis ke kolom JSON.
 *
 * Mengembalikan `null` bila tidak ada satu pun template tersisa, sehingga
 * "kembalikan semua ke bawaan" benar-benar mengembalikan baris ke keadaan
 * belum pernah disunting, bukan menyimpan salinan bawaan.
 */
export function serializeTemplates(stored: StoredTemplates): StoredTemplates | null {
  const keys = customizedKeys(stored)
  if (keys.length === 0) return null
  const result: StoredTemplates = {}
  for (const key of keys) result[key] = stored[key]
  return result
}

export type { WhatsAppCollectionKey }
