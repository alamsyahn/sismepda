/**
 * Preflight rollout media kanonik ke produksi — bagian MURNI.
 *
 * Berkas ini tidak membuka SSH, tidak membaca filesystem, dan tidak menyentuh
 * database. Isinya hanya penilaian: diberi fakta mentah tentang produksi,
 * apakah rollout boleh dilanjutkan?
 *
 * Pemisahan ini disengaja dan sama dengan `lib/deployment.ts`: keputusan
 * "READY / NOT READY" adalah keputusan berbahaya, jadi ia harus dapat diuji
 * tanpa produksi. Pengumpulan faktanya ada di `scripts/rollout-preflight.ts`.
 *
 * Preflight ini SPESIFIK untuk rollout penyimpanan media. Preflight deployment
 * umum (branch, lock, container database) sudah ada di `deploy:check` dan tidak
 * diduplikasi di sini; `deploy:preflight` memanggil keduanya.
 */

import { production } from "@/lib/deployment"

// ---------------------------------------------------------------------------
// Fakta yang dikumpulkan dari produksi (semuanya read-only)
// ---------------------------------------------------------------------------

/** Satu mount yang terpasang pada container aplikasi produksi. */
export type ContainerMount = {
  /** `volume` | `bind` | selainnya (mis. `tmpfs`). */
  type: string
  /** Nama volume bila `type === "volume"`. Kosong untuk bind mount. */
  name: string
  /** Jalur di dalam container. */
  destination: string
  /** Jalur di host bila diketahui. */
  source: string
  readWrite: boolean
}

export type RolloutFacts = {
  /** Nilai MEDIA_STORAGE_ROOT pada konfigurasi compose produksi; null bila tidak diset. */
  mediaStorageRoot: string | null
  /** Mount pada service app menurut `docker inspect`. */
  appMounts: readonly ContainerMount[]
  /** Byte bebas pada filesystem yang menampung app dir. */
  freeDiskBytes: number
  /** Total byte kolom bytea legacy yang akan diduplikasi ke filesystem. */
  legacyMediaBytes: number
  /** Ukuran direktori data PostgreSQL, dipakai mengestimasi ukuran dump. */
  databaseBytes: number
  /** Direktori backup dapat ditulis menurut pemeriksaan read-only. */
  backupDirWritable: boolean
  /** Migrasi yang ada di repo tetapi belum tercatat di produksi. */
  pendingMigrations: readonly string[]
}

// ---------------------------------------------------------------------------
// Estimasi disk
// ---------------------------------------------------------------------------

/**
 * Margin keamanan di atas kebutuhan terhitung.
 *
 * Alasan angkanya, bukan sekadar angkanya: 2× karena selama transisi setiap
 * byte media ada DUA kali (bytea di database dan berkas di volume), lalu
 * ditambah satu set arsip backup. Kelebihan 25% menutup overhead build image
 * dan pertumbuhan data sekolah selama rollout. Ini estimasi konservatif yang
 * dapat dihitung ulang, bukan persentase disk yang dikarang.
 */
export const DISK_SAFETY_FACTOR = 1.25

/** Cadangan tetap untuk layer image Docker hasil build baru. */
export const DOCKER_BUILD_OVERHEAD_BYTES = 3 * 1024 * 1024 * 1024

export type DiskEstimate = {
  databaseBackupBytes: number
  mediaBackupBytes: number
  mediaDuplicationBytes: number
  dockerOverheadBytes: number
  /** Jumlah semua komponen, sebelum margin. */
  subtotalBytes: number
  /** Kebutuhan akhir termasuk margin keamanan. */
  requiredBytes: number
}

/**
 * Estimasi byte yang harus tersedia sebelum rollout dimulai.
 *
 * Media dihitung dua kali dengan sengaja: sekali sebagai salinan filesystem
 * hasil migrasi (duplikasi sementara yang memang jadi tujuan fase EXPAND),
 * sekali lagi sebagai arsip backup media.
 */
export function estimateDiskRequirement(facts: {
  legacyMediaBytes: number
  databaseBytes: number
}): DiskEstimate {
  const databaseBackupBytes = facts.databaseBytes
  const mediaDuplicationBytes = facts.legacyMediaBytes
  const mediaBackupBytes = facts.legacyMediaBytes
  const dockerOverheadBytes = DOCKER_BUILD_OVERHEAD_BYTES

  const subtotalBytes =
    databaseBackupBytes + mediaDuplicationBytes + mediaBackupBytes + dockerOverheadBytes

  return {
    databaseBackupBytes,
    mediaBackupBytes,
    mediaDuplicationBytes,
    dockerOverheadBytes,
    subtotalBytes,
    requiredBytes: Math.ceil(subtotalBytes * DISK_SAFETY_FACTOR),
  }
}

// ---------------------------------------------------------------------------
// Penilaian
// ---------------------------------------------------------------------------

export type CheckStatus = "ok" | "warn" | "blocker"

export type RolloutCheck = {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

/**
 * Apakah mount ini benar-benar membuat media bertahan container recreate?
 *
 * Volume bernama dan bind mount host sama-sama bertahan. Yang TIDAK bertahan
 * adalah tidak adanya mount sama sekali (writable layer) dan `tmpfs`.
 */
export function isPersistentMount(mount: ContainerMount): boolean {
  return (mount.type === "volume" || mount.type === "bind") && mount.readWrite
}

/** Mount yang menampung jalur tertentu di dalam container. */
export function mountCovering(
  mounts: readonly ContainerMount[],
  containerPath: string,
): ContainerMount | null {
  const normalized = containerPath.replace(/\/+$/, "")
  let best: ContainerMount | null = null
  for (const mount of mounts) {
    const destination = mount.destination.replace(/\/+$/, "")
    if (normalized === destination || normalized.startsWith(`${destination}/`)) {
      if (!best || destination.length > best.destination.replace(/\/+$/, "").length) best = mount
    }
  }
  return best
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "?"
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

/**
 * Nilai kesiapan rollout dari fakta produksi.
 *
 * Fungsi ini adalah inti phase ini. Setiap `blocker` di sini adalah alasan sah
 * untuk menolak rollout, dan masing-masing punya test sendiri.
 */
export function evaluateRollout(facts: RolloutFacts): RolloutCheck[] {
  const checks: RolloutCheck[] = []
  const root = facts.mediaStorageRoot?.trim() ?? ""

  // --- Konfigurasi akar media -------------------------------------------
  if (!root) {
    checks.push({
      id: "media-root",
      label: "MEDIA_STORAGE_ROOT",
      status: "blocker",
      detail:
        "Tidak diset pada konfigurasi produksi. Tanpa nilai eksplisit aplikasi menulis media\n" +
        "ke `.media` relatif terhadap direktori kerja container — yaitu writable layer, yang\n" +
        "hilang pada `compose up --force-recreate` berikutnya.",
    })
  } else if (!root.startsWith("/")) {
    checks.push({
      id: "media-root",
      label: "MEDIA_STORAGE_ROOT",
      status: "blocker",
      detail: `Bukan jalur absolut: ${root}. Produksi harus memakai jalur absolut yang dimount.`,
    })
  } else {
    checks.push({
      id: "media-root",
      label: "MEDIA_STORAGE_ROOT",
      status: "ok",
      detail: root,
    })
  }

  // --- Persistensi mount -------------------------------------------------
  if (root.startsWith("/")) {
    const mount = mountCovering(facts.appMounts, root)
    if (!mount) {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "blocker",
        detail:
          `Tidak ada volume/bind mount yang menampung ${root}. Media akan ditulis ke filesystem\n` +
          "ephemeral container dan hilang saat container dibuat ulang.",
      })
    } else if (!isPersistentMount(mount)) {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "blocker",
        detail: `Mount pada ${mount.destination} bertipe "${mount.type}"${
          mount.readWrite ? "" : " (read-only)"
        } — tidak bertahan container recreate.`,
      })
    } else {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "ok",
        detail:
          mount.type === "volume"
            ? `volume "${mount.name}" → ${mount.destination}`
            : `bind ${mount.source} → ${mount.destination}`,
      })
    }
  }

  // --- Disk --------------------------------------------------------------
  const estimate = estimateDiskRequirement(facts)
  if (facts.freeDiskBytes < estimate.requiredBytes) {
    checks.push({
      id: "disk",
      label: "Disk headroom",
      status: "blocker",
      detail:
        `Bebas ${formatBytes(facts.freeDiskBytes)}, dibutuhkan ${formatBytes(estimate.requiredBytes)} ` +
        `(dump ${formatBytes(estimate.databaseBackupBytes)} + duplikasi media ` +
        `${formatBytes(estimate.mediaDuplicationBytes)} + arsip media ` +
        `${formatBytes(estimate.mediaBackupBytes)} + build ` +
        `${formatBytes(estimate.dockerOverheadBytes)}, margin ×${DISK_SAFETY_FACTOR}).`,
    })
  } else {
    checks.push({
      id: "disk",
      label: "Disk headroom",
      status: "ok",
      detail: `bebas ${formatBytes(facts.freeDiskBytes)}, perlu ~${formatBytes(estimate.requiredBytes)}`,
    })
  }

  // --- Tujuan backup -----------------------------------------------------
  checks.push(
    facts.backupDirWritable
      ? {
          id: "backup-dir",
          label: "Backup destination",
          status: "ok",
          detail: production.backupDir,
        }
      : {
          id: "backup-dir",
          label: "Backup destination",
          status: "blocker",
          detail: `${production.backupDir} tidak dapat ditulis. Backup predeploy akan gagal.`,
        },
  )

  // --- Migrasi -----------------------------------------------------------
  checks.push({
    id: "migrations",
    label: "Pending migration",
    status: "ok",
    detail:
      facts.pendingMigrations.length === 0
        ? "tidak ada"
        : `${facts.pendingMigrations.length}: ${facts.pendingMigrations.join(", ")}`,
  })

  // --- Media legacy ------------------------------------------------------
  checks.push({
    id: "legacy-media",
    label: "Legacy media",
    status: "ok",
    detail:
      facts.legacyMediaBytes === 0
        ? "tidak ada byte legacy"
        : `${formatBytes(facts.legacyMediaBytes)} tetap dipertahankan sebagai fallback`,
  })

  return checks
}

export function rolloutReady(checks: readonly RolloutCheck[]): boolean {
  return !checks.some((check) => check.status === "blocker")
}

export function blockersOf(checks: readonly RolloutCheck[]): RolloutCheck[] {
  return checks.filter((check) => check.status === "blocker")
}
