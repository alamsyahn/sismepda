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

/**
 * Mode sebuah set backup.
 *
 * `complete` — database DAN media terverifikasi. Satu-satunya mode yang boleh
 * dipakai sebagai bukti media terlindungi.
 *
 * `pre-media-bootstrap` — dibuat sebelum canonical media storage aktif, ketika
 * seluruh media masih berada di kolom bytea PostgreSQL. Set semacam ini utuh
 * SEBAGAI DATA, tetapi tidak pernah boleh disebut `complete`: begitu media
 * storage aktif, set ini tidak lagi mewakili seluruh media.
 */
export type BackupMode = "complete" | "pre-media-bootstrap"

export type BackupSetManifest = {
  version: number
  /** Pengenal set; sama untuk database dan media. */
  setId: string
  /** ISO 8601 UTC. */
  createdAt: string
  /** Commit aplikasi bila diketahui. */
  commit: string | null
  /** Mode set; menentukan arti ketiadaan arsip media. */
  backupMode: BackupMode
  database: BackupComponent
  /**
   * Komponen media. `null` hanya sah pada mode `pre-media-bootstrap`.
   */
  media: (BackupComponent & { fileCount: number }) | null
  /**
   * Alasan media tidak ada, pada mode bootstrap. Bukan hiasan: manifest yang
   * kelak dibaca operator lain harus menjelaskan dirinya sendiri.
   */
  mediaNotApplicableReason: string | null
  /**
   * Set dianggap utuh hanya bila mode `complete` dan kedua komponen
   * terverifikasi. Set bootstrap SELALU `false`.
   */
  complete: boolean
}

/** Alasan baku untuk set bootstrap. */
export const BOOTSTRAP_MEDIA_REASON =
  "canonical media storage belum aktif; seluruh media yang ada masih tersimpan di kolom bytea PostgreSQL"

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
  /** Baku `complete`; pemanggil bootstrap harus menyatakannya eksplisit. */
  backupMode?: BackupMode
  database: BackupComponent
  media?: (BackupComponent & { fileCount: number }) | null
}): BackupSetManifest {
  assertBackupSetId(input.setId)

  const backupMode: BackupMode = input.backupMode ?? "complete"
  const media = input.media ?? null

  // Mode dan isi tidak boleh saling membantah. Sebuah set yang menyebut
  // dirinya lengkap tanpa arsip media adalah persis kebohongan yang seluruh
  // fase ini berusaha cegah, jadi ia ditolak di tempat pembuatannya.
  if (backupMode === "complete" && media === null) {
    throw new BackupSetError(
      "Set bermode complete wajib memuat arsip media. Bila media storage belum aktif, " +
        'gunakan mode "pre-media-bootstrap".',
    )
  }
  if (backupMode === "pre-media-bootstrap" && media !== null) {
    throw new BackupSetError(
      "Set bootstrap tidak boleh memuat arsip media: keberadaannya membuktikan media storage " +
        "sudah aktif, sehingga set harus bermode complete.",
    )
  }

  const manifest: BackupSetManifest = {
    version: BACKUP_SET_MANIFEST_VERSION,
    setId: input.setId,
    createdAt: input.createdAt.toISOString(),
    commit: input.commit?.trim() || null,
    backupMode,
    database: input.database,
    media,
    mediaNotApplicableReason: backupMode === "pre-media-bootstrap" ? BOOTSTRAP_MEDIA_REASON : null,
    // Set bootstrap tidak pernah lengkap, betapapun mulus pembuatannya.
    complete: backupMode === "complete" && input.database.verified && (media?.verified ?? false),
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

  // Mode tidak boleh ditebak dari ada/tidaknya media: manifest lama (sebelum
  // bootstrap dikenal) selalu punya media, sedangkan manifest tanpa mode yang
  // juga tanpa media adalah berkas rusak, bukan bootstrap.
  const rawMode = value.backupMode
  const backupMode: BackupMode =
    rawMode === undefined || rawMode === "complete"
      ? "complete"
      : rawMode === "pre-media-bootstrap"
        ? "pre-media-bootstrap"
        : (() => {
            throw new BackupSetError(`Mode backup tidak dikenal: ${String(rawMode)}`)
          })()

  let media: (BackupComponent & { fileCount: number }) | null = null
  if (backupMode === "pre-media-bootstrap") {
    if (value.media !== null && value.media !== undefined) {
      throw new BackupSetError("Set bootstrap tidak boleh memuat komponen media.")
    }
  } else {
    const mediaBase = parseComponent(value.media, "media")
    const fileCount = (value.media as Record<string, unknown> | undefined)?.fileCount
    if (typeof fileCount !== "number" || !Number.isInteger(fileCount) || fileCount < 0) {
      throw new BackupSetError("media.fileCount tidak sah.")
    }
    media = { ...mediaBase, fileCount }
  }

  return {
    version: BACKUP_SET_MANIFEST_VERSION,
    setId: String(value.setId),
    createdAt: String(value.createdAt ?? ""),
    commit: typeof value.commit === "string" ? value.commit : null,
    backupMode,
    database,
    media,
    mediaNotApplicableReason:
      typeof value.mediaNotApplicableReason === "string" ? value.mediaNotApplicableReason : null,
    // Set bootstrap tidak pernah lengkap, bahkan bila berkasnya mengaku begitu.
    complete: backupMode === "complete" && value.complete === true,
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
  if (manifest.database.bytes <= 0) {
    problems.push({ code: "database-empty", message: "Arsip database kosong." })
  }

  // Pada mode bootstrap, ketiadaan arsip media BUKAN cacat: seluruh media
  // memang masih ada di dalam dump database itu sendiri. Yang harus dijaga
  // adalah agar set ini tidak pernah menyamar sebagai set lengkap.
  if (manifest.backupMode === "pre-media-bootstrap") {
    if (manifest.complete) {
      problems.push({
        code: "bootstrap-mislabeled",
        message: "Set bootstrap ditandai lengkap. Itu tidak pernah benar.",
      })
    }
    return problems
  }

  if (manifest.media === null) {
    problems.push({
      code: "media-missing",
      message: "Set bermode complete tetapi tidak memuat arsip media sama sekali.",
    })
    return problems
  }
  if (!manifest.media.verified) {
    problems.push({
      code: "media-unverified",
      message: "Arsip media belum lolos verifikasi checksum.",
    })
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

/**
 * Bolehkah migrasi media legacy dijalankan dengan berbekal set ini?
 *
 * Migrasi legacy MENULIS berkas ke media storage. Bila terjadi kesalahan
 * sesudahnya, pemulihan hanya mungkin bila ada satu set yang memuat database
 * DAN media pada keadaan setelah media storage aktif.
 *
 * Set bootstrap tidak memenuhi syarat itu, dan justru berbahaya bila dikira
 * memenuhi: ia dibuat ketika volume media belum ada, sehingga tidak memuat satu
 * pun berkas yang lahir setelah aktivasi.
 */
export function authorizeLegacyMediaMigration(
  manifest: BackupSetManifest | null,
): BackupSetProblem[] {
  if (manifest === null) {
    return [
      {
        code: "no-backup",
        message:
          "Tidak ada set backup yang dapat diperiksa. Migrasi media legacy tidak diizinkan " +
          "tanpa set lengkap yang terverifikasi.",
      },
    ]
  }

  if (manifest.backupMode === "pre-media-bootstrap") {
    return [
      {
        code: "bootstrap-not-sufficient",
        message:
          `Set ${manifest.setId} bermode pre-media-bootstrap: ia dibuat SEBELUM media storage ` +
          "aktif dan tidak memuat arsip media. Buat set lengkap baru setelah aktivasi, " +
          "lalu ulangi.",
      },
    ]
  }

  const problems = verifyBackupSet(manifest)
  if (problems.length > 0) return problems

  if (!manifest.complete) {
    return [
      {
        code: "not-complete",
        message: `Set ${manifest.setId} tidak ditandai lengkap.`,
      },
    ]
  }

  return []
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
