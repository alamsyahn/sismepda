/**
 * Resolusi media dengan fallback legacy.
 *
 * SERVER-ONLY: mengimpor lapisan penyimpanan.
 *
 * Selama transisi, satu record bisa berada di salah satu dari tiga keadaan, dan
 * ketiganya harus tetap bekerja:
 *
 *   1. punya kunci media  → byte dibaca dari penyimpanan
 *   2. hanya legacy bytea → byte dibaca dari kolom database seperti sebelumnya
 *   3. tidak keduanya     → perilaku "belum ada gambar" yang sudah ada
 *
 * Fallback ini WAJIB dan tidak boleh dihapus sampai produksi selesai
 * dimigrasikan DAN diverifikasi. Menghapusnya lebih awal akan membuat seluruh
 * gambar yang belum dimigrasikan hilang dari tampilan.
 *
 * Kasus keempat yang juga ditangani: record punya kunci, tetapi berkasnya
 * hilang dari penyimpanan. Itu tidak boleh menjadi error 500 bila byte legacy
 * masih ada — record semacam itu justru masih bisa disajikan dari legacy.
 */

import { isValidMediaKey } from "@/lib/media-keys"
import { mediaStorage } from "@/lib/server-media-storage"

/** Bentuk kolom media pada sebuah record, apa pun nama aslinya. */
export type MediaReference = {
  key?: string | null
  mimeType?: string | null
  /** Byte legacy dari kolom `Bytes`; tetap didukung selama fase transisi. */
  legacyBytes?: Uint8Array | Buffer | null
  legacyMimeType?: string | null
}

export type ResolvedMedia = {
  bytes: Uint8Array
  mimeType: string
  /** Dari mana byte akhirnya berasal; dipakai test dan diagnostik. */
  source: "storage" | "legacy"
}

/**
 * Kembalikan byte media, atau `null` bila record memang belum punya gambar.
 *
 * Tidak pernah melempar karena berkas hilang: pemanggilnya adalah route
 * penyaji gambar yang kontraknya sudah "404 bila tidak ada", dan mengubah itu
 * menjadi 500 akan memecahkan UI yang sekarang menampilkan placeholder.
 */
export async function resolveMedia(reference: MediaReference): Promise<ResolvedMedia | null> {
  const { key, mimeType, legacyBytes, legacyMimeType } = reference

  // Kunci divalidasi sebelum menyentuh penyimpanan. Kunci rusak diperlakukan
  // seperti tidak ada kunci, sehingga jatuh ke legacy alih-alih gagal.
  if (isValidMediaKey(key)) {
    const bytes = await mediaStorage()
      .get(key)
      .catch(() => null)
    if (bytes && mimeType) {
      return { bytes, mimeType, source: "storage" }
    }
  }

  if (legacyBytes && legacyBytes.byteLength > 0) {
    const legacyType = legacyMimeType ?? mimeType
    if (legacyType) {
      return { bytes: new Uint8Array(legacyBytes), mimeType: legacyType, source: "legacy" }
    }
  }

  return null
}
