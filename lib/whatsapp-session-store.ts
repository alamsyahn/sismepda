/**
 * Penyimpanan sesi WhatsApp di disk: pemeriksaan dan pembersihan.
 *
 * MENGAPA TERPISAH DARI ADAPTER
 *
 * Ini adalah bagian paling penting dari "Keluar & hapus sesi" — dan satu-satunya
 * bagian yang harus tetap bekerja ketika WhatsApp sudah tidak dapat dihubungi.
 * Di dalam adapter ia tidak dapat diuji: mengimpor adapter berarti mengimpor
 * Baileys beserta binding nativenya.
 *
 * Modul ini TIDAK mengimpor Baileys. Ia hanya berurusan dengan berkas.
 */
import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"

/**
 * Berkas yang keberadaannya menandakan sesi pernah ditautkan.
 *
 * Baileys menulis banyak berkas ke direktori sesi, tetapi hanya berkas inilah
 * yang memuat identitas perangkat. Berkas lain (kunci sinkronisasi, sesi per
 * lawan bicara) tidak berarti apa-apa tanpanya.
 */
export const CREDENTIALS_FILE = "creds.json"

/** Apakah ada kredensial tertaut di direktori ini. */
export function sessionExistsIn(sessionDir: string): boolean {
  return existsSync(join(sessionDir, CREDENTIALS_FILE))
}

/**
 * Hapus seluruh kredensial sesi. IDEMPOTENT.
 *
 * Mengembalikan `true` bila direktori berakhir tanpa kredensial — termasuk
 * ketika memang sudah tidak ada sejak awal, karena hasil akhirnyalah yang
 * dijanjikan, bukan jumlah berkas yang terhapus.
 *
 * TUNTAS DENGAN SENGAJA: sesi separuh terhapus adalah keadaan terburuk dari
 * ketiganya — Baileys memuatnya, WhatsApp menolaknya, dan admin melihat
 * "tertaut" yang tidak pernah terhubung.
 */
export async function discardSessionCredentials(sessionDir: string): Promise<boolean> {
  try {
    await rm(sessionDir, { recursive: true, force: true })
  } catch {
    // Titik mount volume tidak dapat di-unlink. Bukan kegagalan: isinya
    // dikosongkan di bawah, dan itu sudah memenuhi janji operasi ini.
  }

  if (existsSync(sessionDir)) {
    try {
      for (const entry of await readdir(sessionDir)) {
        await rm(join(sessionDir, entry), { recursive: true, force: true })
      }
    } catch {
      return false
    }
  }

  return !sessionExistsIn(sessionDir)
}
