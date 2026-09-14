/**
 * Backup set lengkap SISMEPDA — bagian MURNI.
 *
 * Setelah media dipisahkan dari database, dump PostgreSQL saja bukan lagi
 * backup yang lengkap. Berkas ini mendefinisikan apa artinya "satu set
 * pemulihan": satu run id, satu arsip database, satu arsip media, dan satu
 * manifest yang mengikat ketiganya.
 *
 * Tidak ada I/O di sini. Eksekusinya ada di `scripts/backup-production.ts`.
 * Karena itu aturan "set tidak lengkap ditolak" dapat diuji tanpa membuat
 * backup apa pun.
 *
 * Manifest TIDAK BOLEH memuat rahasia: ia hanya mencatat nama berkas, ukuran,
 * jumlah, dan status verifikasi — tidak pernah DATABASE_URL, password, atau
 * isi env.
 */

export const BACKUP_SET_MANIFEST_VERSION = 1

/** Nama berkas manifest di dalam direktori set. */
export const BACKUP_SET_MANIFEST = "manifest.json"

export class BackupSetError extends Error {}

export type BackupComponent = {
  /** Nama berkas relatif terhadap direktori set. */
  file: string
  bytes: number
  /** Sudah diverifikasi isinya, bukan sekadar ada. */
  verified: boolean
}

export type BackupSetManifest = {
  version: number
  /** Pengenal set; sama untuk database dan media. */
  setId: string
  /** ISO 8601 UTC. */
  createdAt: string
  /** Commit aplikasi bila diketahui. */
  commit: string | null
  database: BackupComponent
  media: BackupComponent & { fileCount: number }
  /** Set dianggap utuh hanya bila kedua komponen terverifikasi. */
  complete: boolean
}

// ---------------------------------------------------------------------------
// Penamaan
// ---------------------------------------------------------------------------

/**
 * `backup-YYYY-MM-DDTHHmmssZ` dalam UTC.
 *
 * UTC dan bukan zona sekolah: ini metadata operasional, bukan tanggal bisnis,
 * dan urutan leksikografisnya harus sama dengan urutan waktu sebenarnya.
 */
export function backupSetId(now: Date): string {
  const iso = now.toISOString()
  return `backup-${iso.slice(0, 10)}T${iso.slice(11, 19).replaceAll(":", "")}Z`
}

const SET_ID_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T\d{6}Z$/

export function isBackupSetId(value: string): boolean {
  return SET_ID_PATTERN.test(value)
}

export function assertBackupSetId(value: string): string {
  if (!isBackupSetId(value)) {
    throw new BackupSetError(`Backup set id tidak sah: ${value}`)
  }
  return value
}

/** Nama komponen di dalam direktori set — tetap, supaya restore dapat menebaknya. */
export const DATABASE_ARCHIVE = "database.dump"
export const MEDIA_ARCHIVE = "media.tar.gz"

// ---------------------------------------------------------------------------
// Rahasia
// ---------------------------------------------------------------------------

/**
 * Kunci yang tidak boleh pernah muncul di manifest.
 *
 * Diperiksa sebagai daftar eksplisit, bukan sebagai niat baik: manifest dibuat
 * oleh script yang punya akses ke environment produksi.
 */
export const FORBIDDEN_MANIFEST_KEYS = [
  "password",
  "secret",
  "token",
  "databaseurl",
  "database_url",
  "env",
  "credentials",
] as const

export function assertNoSecrets(value: unknown, path = "manifest"): void {
  if (value === null || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z_]/g, "")
    if (FORBIDDEN_MANIFEST_KEYS.some((forbidden) => normalized.includes(forbidden))) {
      throw new BackupSetError(`Manifest memuat kunci sensitif: ${path}.${key}`)
    }
    assertNoSecrets(child, `${path}.${key}`)
  }
}

// ---------------------------------------------------------------------------
// Pembuatan & validasi
// ---------------------------------------------------------------------------

export function buildManifest(input: {
  setId: string
  createdAt: Date
  commit?: string | null
  database: BackupComponent
  media: BackupComponent & { fileCount: number }
}): BackupSetManifest {
  assertBackupSetId(input.setId)

  const manifest: BackupSetManifest = {
    version: BACKUP_SET_MANIFEST_VERSION,
    setId: input.setId,
    createdAt: input.createdAt.toISOString(),
    commit: input.commit?.trim() || null,
    database: input.database,
    media: input.media,
    complete: input.database.verified && input.media.verified,
  }

  assertNoSecrets(manifest)
  return manifest
}

export function parseBackupSetManifest(raw: unknown): BackupSetManifest {
  if (raw === null || typeof raw !== "object") {
    throw new BackupSetError("Manifest bukan objek JSON.")
  }
  const value = raw as Record<string, unknown>

  if (value.version !== BACKUP_SET_MANIFEST_VERSION) {
    throw new BackupSetError(`Versi manifest tidak dikenal: ${String(value.version)}`)
  }
  assertBackupSetId(String(value.setId ?? ""))

  const database = parseComponent(value.database, "database")
  const mediaBase = parseComponent(value.media, "media")
  const fileCount = (value.media as Record<string, unknown> | undefined)?.fileCount
  if (typeof fileCount !== "number" || !Number.isInteger(fileCount) || fileCount < 0) {
    throw new BackupSetError("media.fileCount tidak sah.")
  }

  return {
    version: BACKUP_SET_MANIFEST_VERSION,
    setId: String(value.setId),
    createdAt: String(value.createdAt ?? ""),
    commit: typeof value.commit === "string" ? value.commit : null,
    database,
    media: { ...mediaBase, fileCount },
    complete: value.complete === true,
  }
}

function parseComponent(raw: unknown, label: string): BackupComponent {
  if (raw === null || typeof raw !== "object") {
    throw new BackupSetError(`Komponen ${label} tidak ada di manifest.`)
  }
  const value = raw as Record<string, unknown>
  if (typeof value.file !== "string" || value.file.length === 0) {
    throw new BackupSetError(`Komponen ${label} tidak menyebutkan berkas.`)
  }
  if (typeof value.bytes !== "number" || !Number.isFinite(value.bytes) || value.bytes <= 0) {
    throw new BackupSetError(`Komponen ${label} berukuran tidak sah.`)
  }
  return { file: value.file, bytes: value.bytes, verified: value.verified === true }
}

export type BackupSetProblem = { code: string; message: string }

/**
 * Sebuah set hanya boleh dianggap dapat dipulihkan bila KEDUA komponennya ada
 * dan terverifikasi. Dump database yang lolos sendirian adalah justru kondisi
 * berbahaya yang phase ini ingin cegah: ia terlihat seperti backup lengkap.
 */
export function verifyBackupSet(manifest: BackupSetManifest): BackupSetProblem[] {
  const problems: BackupSetProblem[] = []

  if (!manifest.database.verified) {
    problems.push({
      code: "database-unverified",
      message: "Arsip database belum lolos verifikasi pg_restore --list.",
    })
  }
  if (!manifest.media.verified) {
    problems.push({
      code: "media-unverified",
      message: "Arsip media belum lolos verifikasi checksum.",
    })
  }
  if (manifest.database.bytes <= 0) {
    problems.push({ code: "database-empty", message: "Arsip database kosong." })
  }
  if (manifest.media.fileCount === 0) {
    problems.push({
      code: "media-empty",
      message:
        "Arsip media tidak memuat satu berkas pun. Bila produksi memang belum punya media\n" +
        "kanonik, ini wajar sebelum migrasi legacy — tetapi set ini tidak boleh dipakai\n" +
        "sebagai bukti media terlindungi.",
    })
  }

  return problems
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const RETENTION_DAILY = 7
export const RETENTION_WEEKLY = 4

/**
 * Pilih set yang boleh dihapus.
 *
 * Sifat yang dijamin, dan yang membuat fungsi ini aman dipakai kelak:
 *   - set TERBARU tidak pernah dipilih untuk dihapus;
 *   - masukan yang tidak dikenali pola namanya tidak pernah dipilih;
 *   - fungsi ini hanya MEMILIH; penghapusannya urusan pemanggil.
 *
 * Belum ada pemanggil yang menghapus apa pun di produksi. Ini sengaja: aturan
 * retention diuji lebih dulu, eksekusinya menyusul di fase terpisah.
 */
export function selectExpiredSets(
  setIds: readonly string[],
  options: { daily?: number; weekly?: number } = {},
): string[] {
  const daily = options.daily ?? RETENTION_DAILY
  const weekly = options.weekly ?? RETENTION_WEEKLY

  const known = setIds.filter(isBackupSetId).sort().reverse()
  if (known.length === 0) return []

  const keep = new Set<string>()
  // Harian: N set terbaru, apa pun tanggalnya.
  for (const id of known.slice(0, daily)) keep.add(id)

  // Mingguan: satu set terbaru per minggu ISO, hingga `weekly` minggu.
  const weeks = new Set<string>()
  for (const id of known) {
    const week = isoWeekOf(id)
    if (week && !weeks.has(week) && weeks.size < weekly) {
      weeks.add(week)
      keep.add(id)
    }
  }

  // Set terbaru selalu dipertahankan, bahkan bila konfigurasi diberi angka 0.
  keep.add(known[0])

  return known.filter((id) => !keep.has(id))
}

function isoWeekOf(setId: string): string | null {
  const match = /^backup-(\d{4})-(\d{2})-(\d{2})T/.exec(setId)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}
