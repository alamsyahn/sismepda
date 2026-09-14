/**
 * Lapisan penyimpanan media kanonik.
 *
 * SERVER-ONLY: mengimpor `node:fs`. Komponen klien tidak boleh mengimpor nilai
 * dari berkas ini (lihat catatan boundary di docs/architecture/overview.md).
 *
 * Seluruh akses berkas media melewati antarmuka `MediaStorage`. Tidak ada
 * pemanggil di luar modul ini yang boleh menyusun jalur filesystem sendiri:
 * itulah satu-satunya cara memastikan validasi kunci dan penahanan direktori
 * benar-benar berlaku di setiap jalur tulis/baca.
 *
 * Backend hari ini adalah filesystem persisten. Antarmukanya sengaja dibuat
 * asinkron dan hanya berbicara dalam istilah kunci logis + byte, sehingga
 * backend object storage kelak cukup mengimplementasikan antarmuka yang sama
 * tanpa menyentuh satu pun pemanggil. Tidak ada S3/R2 di fase ini.
 */

import { constants as fsConstants } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { access } from "node:fs/promises"
import path from "node:path"

import { assertValidMediaKey, type MediaScope, generateMediaKey } from "@/lib/media-keys"

/** Metadata satu objek media sebagaimana disimpan di database. */
export type StoredMedia = {
  key: string
  mimeType: string
  size: number
}

export interface MediaStorage {
  /** Tulis byte pada kunci tertentu; menimpa bila sudah ada. */
  put(key: string, bytes: Uint8Array): Promise<void>
  /** Baca byte; `null` bila objek tidak ada (bukan lemparan, karena hilangnya berkas adalah kondisi normal selama transisi). */
  get(key: string): Promise<Uint8Array | null>
  /** True bila objek ada. */
  exists(key: string): Promise<boolean>
  /** Ukuran byte, atau `null` bila tidak ada. */
  size(key: string): Promise<number | null>
  /** Hapus objek. Tidak melempar bila objek memang sudah tidak ada. */
  delete(key: string): Promise<void>
}

export class MediaStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "MediaStorageError"
  }
}

/**
 * Akar penyimpanan media. Konfigurasi lewat MEDIA_STORAGE_ROOT.
 *
 * Default pengembangan adalah `.media/` di dalam project supaya `npm run dev`
 * bekerja tanpa setup, dan direktori itu masuk .gitignore. Produksi WAJIB
 * mengarahkannya ke bind mount/volume persisten: menulis ke writable layer
 * container berarti seluruh media hilang saat container dibuat ulang.
 */
export function mediaStorageRoot(): string {
  const configured = process.env.MEDIA_STORAGE_ROOT?.trim()
  if (configured && configured.length > 0) return path.resolve(configured)
  return path.resolve(process.cwd(), ".media")
}

/** Backend filesystem lokal/persisten. */
export class FilesystemMediaStorage implements MediaStorage {
  constructor(private readonly root: string) {}

  /**
   * Terjemahkan kunci logis menjadi jalur absolut.
   *
   * Dua lapis pertahanan, bukan satu: kunci divalidasi bentuknya, lalu hasil
   * resolusi diperiksa harus berada di bawah akar. Lapis kedua menangkap kasus
   * yang tidak terduga dari lapis pertama — termasuk akar yang berisi symlink
   * atau perilaku normalisasi jalur khas platform.
   */
  private resolve(key: string): string {
    const safeKey = assertValidMediaKey(key)
    const absolute = path.resolve(this.root, safeKey)
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep
    if (!absolute.startsWith(rootWithSep)) {
      throw new MediaStorageError("Kunci media keluar dari akar penyimpanan")
    }
    return absolute
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const absolute = this.resolve(key)
    /**
     * Tulis ke berkas sementara lalu ganti nama. `rename` dalam satu filesystem
     * bersifat atomik, sehingga pembaca tidak pernah melihat berkas separuh
     * tertulis bila proses mati di tengah penulisan — penting karena database
     * akan mengarah ke kunci ini.
     *
     * Pembuatan direktori ikut dibungkus: disk penuh, izin kurang, dan akar
     * yang ternyata bukan direktori semuanya gagal di sini, dan pemanggil harus
     * menerima satu jenis error yang sama alih-alih errno mentah.
     */
    const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
    try {
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(temporary, bytes)
      await rename(temporary, absolute)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw new MediaStorageError("Media gagal ditulis ke penyimpanan", { cause: error })
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const absolute = this.resolve(key)
    try {
      return new Uint8Array(await readFile(absolute))
    } catch (error) {
      if (isNotFound(error)) return null
      throw new MediaStorageError("Media gagal dibaca dari penyimpanan", { cause: error })
    }
  }

  async exists(key: string): Promise<boolean> {
    const absolute = this.resolve(key)
    try {
      await access(absolute, fsConstants.R_OK)
      return true
    } catch {
      return false
    }
  }

  async size(key: string): Promise<number | null> {
    const absolute = this.resolve(key)
    try {
      const info = await stat(absolute)
      return info.size
    } catch (error) {
      if (isNotFound(error)) return null
      throw new MediaStorageError("Ukuran media gagal dibaca", { cause: error })
    }
  }

  async delete(key: string): Promise<void> {
    const absolute = this.resolve(key)
    // `force` membuat penghapusan idempoten: menghapus objek yang memang sudah
    // hilang bukan kegagalan, dan pemanggil tidak perlu membedakannya.
    await rm(absolute, { force: true })
  }
}

let cached: { root: string; storage: FilesystemMediaStorage } | null = null

/**
 * Instance penyimpanan aktif. Di-cache per akar sehingga perubahan
 * MEDIA_STORAGE_ROOT dalam test (yang memakai direktori sementara) tetap
 * terbaca tanpa perlu me-reset modul.
 */
export function mediaStorage(): MediaStorage {
  const root = mediaStorageRoot()
  if (!cached || cached.root !== root) {
    cached = { root, storage: new FilesystemMediaStorage(root) }
  }
  return cached.storage
}

/**
 * Simpan satu unggahan baru dan kembalikan referensi untuk database.
 *
 * Urutannya disengaja: berkas ditulis DULU, diverifikasi, baru pemanggil
 * menyimpan kuncinya. Jika langkah ini gagal, database belum berubah sama
 * sekali — tidak ada baris yang menunjuk berkas tidak ada.
 */
export async function storeMedia(
  scope: MediaScope,
  bytes: Uint8Array,
  mimeType: string,
): Promise<StoredMedia> {
  const key = generateMediaKey(scope, mimeType)
  const storage = mediaStorage()
  await storage.put(key, bytes)

  // Verifikasi setelah tulis: disk penuh dan tulisan terpotong adalah mode
  // gagal nyata pada VPS kecil, dan keduanya lolos tanpa pemeriksaan ini.
  const written = await storage.size(key)
  if (written !== bytes.byteLength) {
    await storage.delete(key).catch(() => {})
    throw new MediaStorageError("Media tersimpan tidak utuh")
  }

  return { key, mimeType, size: bytes.byteLength }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  )
}
