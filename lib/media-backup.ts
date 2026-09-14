/**
 * Kontrak backup media — bagian MURNI.
 *
 * Keputusan yang perlu diuji tanpa menyentuh disk: penamaan arsip, bentuk
 * manifest, dan yang terpenting — entri arsip mana yang boleh diekstrak.
 *
 * Eksekusi tar/checksum ada di `scripts/media-backup.ts`.
 */

/** Versi format manifest. Naik bila bentuknya berubah tidak kompatibel. */
export const MEDIA_MANIFEST_VERSION = 1

/** Nama manifest di dalam arsip. Di luar pohon media agar tidak pernah bentrok. */
export const MEDIA_MANIFEST_ENTRY = "manifest.json"

/** Direktori berisi pohon media di dalam arsip. */
export const MEDIA_ARCHIVE_PREFIX = "media"

export class MediaBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaBackupError"
  }
}

export type MediaManifestFile = {
  /** Kunci media logis, relatif terhadap akar. Selalu memakai `/`. */
  key: string
  size: number
  sha256: string
}

export type MediaManifest = {
  version: number
  /** ISO-8601 UTC. Dipakai operator memasangkan backup DB dengan backup media. */
  createdAt: string
  /**
   * Pengenal run: dipakai memasangkan arsip media dengan dump database dari
   * periode yang sama. Bukan snapshot atomik — lihat dokumentasi.
   */
  runId: string
  /**
   * Identitas akar media. Hanya nama basis + hash pendek, BUKAN jalur absolut:
   * jalur absolut membocorkan struktur server tanpa menambah nilai audit.
   */
  sourceId: string
  fileCount: number
  totalBytes: number
  files: MediaManifestFile[]
}

/**
 * Nama arsip: `media_<YYYY-MM-DD_HH-MM-SS>.tar.gz`.
 *
 * Waktu UTC, dan bentuknya sengaja menyerupai penamaan backup database yang
 * sudah ada agar keduanya berurut secara leksikografis saat di-`ls`.
 */
export function backupRunId(now: Date): string {
  const iso = now.toISOString()
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, "-")}`
}

export function archiveNameFor(runId: string): string {
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(runId)) {
    throw new MediaBackupError(`Run ID backup tidak sah: ${runId}`)
  }
  return `media_${runId}.tar.gz`
}

/**
 * Entri arsip yang aman diekstrak.
 *
 * Arsip tar dapat memuat jalur absolut, `..`, dan symlink yang menunjuk ke luar
 * direktori ekstraksi. Verifikasi yang hanya membaca daftar berkas tanpa
 * memeriksa bentuknya akan meloloskan arsip yang merusak filesystem saat
 * direstore. Pemeriksaan dilakukan di sini agar berlaku untuk pembuatan maupun
 * verifikasi.
 */
export function isSafeArchiveEntry(entry: unknown): entry is string {
  if (typeof entry !== "string" || entry.length === 0) return false
  if (entry.length > 1024) return false
  if (entry.includes("\0")) return false
  if (entry.startsWith("/") || /^[A-Za-z]:/.test(entry)) return false
  if (entry.includes("\\")) return false
  const segments = entry.split("/")
  if (segments.some((segment) => segment === "..")) return false
  // Hanya dua puncak yang sah: manifest dan pohon media.
  return entry === MEDIA_MANIFEST_ENTRY || entry.startsWith(`${MEDIA_ARCHIVE_PREFIX}/`)
}

export function assertSafeArchiveEntry(entry: unknown): string {
  if (!isSafeArchiveEntry(entry)) {
    // Nilainya tidak ikut dicetak: pesan error bisa berakhir di log bersama.
    throw new MediaBackupError("Arsip memuat entri dengan jalur tidak aman")
  }
  return entry
}

/** Bentuk manifest, diperiksa sebelum isinya dipercaya. */
export function parseManifest(raw: unknown): MediaManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new MediaBackupError("Manifest bukan objek JSON")
  }
  const value = raw as Record<string, unknown>
  const files = value.files
  if (!Array.isArray(files)) throw new MediaBackupError("Manifest tidak memuat daftar berkas")

  const parsedFiles: MediaManifestFile[] = files.map((file) => {
    if (typeof file !== "object" || file === null) {
      throw new MediaBackupError("Entri manifest bukan objek")
    }
    const record = file as Record<string, unknown>
    if (typeof record.key !== "string" || typeof record.sha256 !== "string") {
      throw new MediaBackupError("Entri manifest tidak lengkap")
    }
    if (typeof record.size !== "number" || !Number.isFinite(record.size) || record.size < 0) {
      throw new MediaBackupError("Ukuran pada entri manifest tidak sah")
    }
    if (!/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new MediaBackupError("Checksum pada entri manifest tidak sah")
    }
    assertSafeArchiveEntry(`${MEDIA_ARCHIVE_PREFIX}/${record.key}`)
    return { key: record.key, size: record.size, sha256: record.sha256 }
  })

  if (typeof value.fileCount !== "number" || value.fileCount !== parsedFiles.length) {
    throw new MediaBackupError("fileCount pada manifest tidak cocok dengan jumlah entri")
  }
  const totalBytes = parsedFiles.reduce((sum, file) => sum + file.size, 0)
  if (typeof value.totalBytes !== "number" || value.totalBytes !== totalBytes) {
    throw new MediaBackupError("totalBytes pada manifest tidak cocok dengan jumlah ukuran entri")
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new MediaBackupError("createdAt pada manifest tidak sah")
  }
  if (typeof value.runId !== "string" || typeof value.sourceId !== "string") {
    throw new MediaBackupError("Identitas run/sumber pada manifest tidak sah")
  }
  if (typeof value.version !== "number") {
    throw new MediaBackupError("Versi manifest tidak sah")
  }

  return {
    version: value.version,
    createdAt: value.createdAt,
    runId: value.runId,
    sourceId: value.sourceId,
    fileCount: value.fileCount,
    totalBytes: value.totalBytes,
    files: parsedFiles,
  }
}

/**
 * Tolak arsip yang akan disimpan DI DALAM direktori sumbernya.
 *
 * Arsip yang ditulis ke dalam pohon media akan membackup dirinya sendiri pada
 * jalannya yang berikutnya, dan tumbuh setiap kali. Ini kegagalan senyap, jadi
 * dicegah di depan.
 */
export function assertArchiveOutsideSource(archivePath: string, sourceRoot: string): void {
  const archive = archivePath.replace(/\\/g, "/")
  const source = sourceRoot.replace(/\\/g, "/").replace(/\/+$/, "")
  if (archive === source || archive.startsWith(`${source}/`)) {
    throw new MediaBackupError("Arsip backup tidak boleh berada di dalam direktori media sumber")
  }
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
