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
  /**
   * Volume media menurut KONFIGURASI compose yang berlaku (bukan menurut
   * container yang sedang hidup), dalam bentuk `nama:tujuan`. `null` bila
   * konfigurasi tidak mendeklarasikan mount media sama sekali.
   *
   * Dipisahkan dari `appMounts` karena keduanya menjawab pertanyaan berbeda:
   * `appMounts` = apa yang berlaku SEKARANG, `configuredMediaMount` = apa yang
   * akan berlaku setelah `compose up` berikutnya. Sebelum deploy pertama yang
   * membawa volume media, yang kedua inilah yang menentukan.
   */
  configuredMediaMount: string | null
  /** Nama volume yang dideklarasikan konfigurasi compose. */
  configuredVolumes: readonly string[]
  /**
   * Nama volume Docker sebenarnya hasil `name:` eksplisit, bila ada.
   *
   * Tanpa `name:` Docker menurunkan nama dari nama project (`<project>_media`),
   * sehingga rename direktori deploy atau perubahan nama project diam-diam
   * menghasilkan volume BARU yang kosong sementara media lama tetap tertinggal
   * di disk. Identitas yang dapat diprediksi adalah syarat rollout.
   */
  resolvedMediaVolumeName: string | null
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

/**
 * Baca `nama_volume:/tujuan` (opsional `:ro`) dari konfigurasi compose.
 *
 * Bentuk yang tidak dikenali menghasilkan `null`, bukan tebakan. Mount media
 * yang tidak dapat dibaca lebih baik dianggap tidak ada — itu memicu blocker —
 * daripada dianggap persisten secara keliru. Jalur absolut di posisi sumber
 * berarti bind mount, yang di produksi ini bukan bentuk yang diharapkan untuk
 * media dan karenanya juga ditolak.
 */
export function parseConfiguredMount(
  value: string | null,
): { volume: string; destination: string; readOnly: boolean } | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  const parts = trimmed.split(":")
  if (parts.length < 2) return null
  const [volume, destination, mode] = parts
  if (!volume || !destination || !destination.startsWith("/")) return null
  if (volume.startsWith("/") || volume.startsWith(".")) return null
  return {
    volume,
    destination: destination.replace(/\/+$/, ""),
    readOnly: mode === "ro",
  }
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
  //
  // Dua sumber dinilai, dan KONFIGURASI yang menentukan. Container yang sedang
  // berjalan boleh saja belum punya volume media — itulah keadaan normal
  // sebelum deploy pertama yang membawanya. Yang tidak boleh adalah konfigurasi
  // yang tidak mendeklarasikan mount media, karena `compose up` berikutnya akan
  // menghasilkan container tanpa penyimpanan persisten.
  if (root.startsWith("/")) {
    const configured = parseConfiguredMount(facts.configuredMediaMount)
    const runtime = mountCovering(facts.appMounts, root)

    if (!configured) {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "blocker",
        detail:
          `Konfigurasi compose tidak mendeklarasikan mount media untuk ${root}. Media akan\n` +
          "ditulis ke filesystem ephemeral container dan hilang saat container dibuat ulang.",
      })
    } else if (configured.destination !== root) {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "blocker",
        detail:
          `Mount dan akar media tidak cocok: volume "${configured.volume}" dipasang di\n` +
          `${configured.destination}, sedangkan MEDIA_STORAGE_ROOT adalah ${root}.`,
      })
    } else if (!facts.configuredVolumes.includes(configured.volume)) {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "blocker",
        detail:
          `Volume "${configured.volume}" dipasang tetapi tidak dideklarasikan pada bagian\n` +
          "`volumes:`. Identitas volume menjadi tidak dapat diprediksi antar deployment.",
      })
    } else if (runtime && !isPersistentMount(runtime)) {
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "blocker",
        detail: `Container berjalan memount ${runtime.destination} bertipe "${runtime.type}"${
          runtime.readWrite ? "" : " (read-only)"
        } — tidak bertahan container recreate.`,
      })
    } else {
      const active = runtime && isPersistentMount(runtime)
      checks.push({
        id: "media-mount",
        label: "Persistent media mount",
        status: "ok",
        detail: active
          ? `volume "${configured.volume}" → ${configured.destination} (aktif)`
          : `volume "${configured.volume}" → ${configured.destination} (dikonfigurasi; aktif setelah deploy)`,
      })
    }

    // Identitas volume harus dapat diprediksi, terpisah dari keberadaannya.
    // Mount yang benar tetapi bernama turunan project akan berpindah identitas
    // begitu nama project berubah — media lama tertinggal di volume lama.
    if (parseConfiguredMount(facts.configuredMediaMount)) {
      if (!facts.resolvedMediaVolumeName) {
        checks.push({
          id: "media-volume-identity",
          label: "Media volume identity",
          status: "blocker",
          detail:
            "Volume media tidak memakai `name:` eksplisit, sehingga namanya diturunkan dari\n" +
            "nama project Compose. Perubahan nama project atau direktori deploy akan membuat\n" +
            "volume baru yang kosong, dan media lama tidak lagi ter-mount.",
        })
      } else {
        checks.push({
          id: "media-volume-identity",
          label: "Media volume identity",
          status: "ok",
          detail: `nama eksplisit "${facts.resolvedMediaVolumeName}"`,
        })
      }
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
