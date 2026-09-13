/**
 * Preflight kompatibilitas arsip sebelum restore destruktif.
 *
 * MURNI: tidak menyentuh database, filesystem, atau proses anak. Menerima
 * daftar tabel yang sudah diekstrak dari `pg_restore --list` dan memutuskan
 * apakah arsip boleh dipulihkan.
 *
 * Alasan keberadaannya: restore menjalankan
 * `TRUNCATE <tabel arsip> RESTART IDENTITY CASCADE`. Karena `UserRole`
 * mereferensikan `User` dengan `onDelete: Cascade`, me-restore arsip pra-RBAC
 * (yang hanya memuat `User`) akan mengosongkan seluruh keanggotaan role tanpa
 * memulihkannya — termasuk system_admin. Kompatibilitas karena itu diputuskan
 * SEBELUM perintah destruktif pertama dijalankan, dan dievaluasi menyeluruh
 * atas semua tabel wajib sekaligus, bukan satu tabel sebagai sampel.
 *
 * Nama tabel diverifikasi terhadap `pg_tables`, bukan diturunkan dari nama
 * model Prisma: hanya model `Role` yang di-`@@map` ke `RbacRole`.
 */

/** Format arsip yang dihasilkan `GET /api/admin/database` saat ini. */
export const SUPPORTED_BACKUP_FORMAT = "postgresql-data-v1"

/**
 * Tabel yang wajib hadir di arsip pasca-RBAC.
 *
 * Kehilangan salah satu dari tabel ini membuat restore menghancurkan akses
 * secara diam-diam:
 *   User           — identitas dan state aktif
 *   RbacRole       — definisi role (termasuk system_admin)
 *   Permission     — katalog permission
 *   UserRole       — keanggotaan; hilang = tidak ada admin tersisa
 *   RolePermission — isi kewenangan tiap role
 *   RbacMigration  — marker readiness; hilang = guard fail closed
 */
export const REQUIRED_RBAC_TABLES: readonly string[] = [
  "User",
  "RbacRole",
  "Permission",
  "UserRole",
  "RolePermission",
  "RbacMigration",
]

export type RestorePreflightInput = {
  /** Nama tabel yang terdaftar di arsip (hasil parse `pg_restore --list`). */
  readonly archiveTables: readonly string[]
  /**
   * Penanda format yang menyertai unggahan, bila ada.
   *
   * Nilai ini berasal dari client dan karena itu TIDAK tepercaya: ia dipakai
   * hanya untuk menolak lebih awal, tidak pernah untuk meloloskan. Keputusan
   * menerima selalu bersandar pada isi arsip. Arsip PostgreSQL sendiri tidak
   * membawa metadata versi aplikasi, sehingga ketiadaan penanda bukan alasan
   * menolak arsip yang isinya terbukti lengkap.
   */
  readonly formatHeader?: string | null
}

export type RestorePreflightResult =
  | { readonly compatible: true }
  | {
      readonly compatible: false
      readonly reason:
        | "format-unsupported"
        | "no-table-data"
        | "migration-table-present"
        | "rbac-tables-missing"
      /** Tabel wajib yang tidak ditemukan; kosong untuk alasan non-kelengkapan. */
      readonly missingTables: readonly string[]
      /** Penjelasan siap tampil untuk operator. Tidak memuat kredensial. */
      readonly message: string
    }

function reject(
  reason: Exclude<RestorePreflightResult, { compatible: true }>["reason"],
  message: string,
  missingTables: readonly string[] = [],
): RestorePreflightResult {
  return { compatible: false, reason, missingTables, message }
}

/**
 * Memutuskan apakah arsip boleh dipulihkan. Fail closed: apa pun yang tidak
 * terbukti kompatibel ditolak.
 */
export function evaluateRestorePreflight(input: RestorePreflightInput): RestorePreflightResult {
  const { archiveTables, formatHeader } = input

  if (formatHeader != null && formatHeader !== "" && formatHeader !== SUPPORTED_BACKUP_FORMAT) {
    return reject(
      "format-unsupported",
      `Format arsip "${formatHeader}" tidak didukung. Restore hanya menerima ${SUPPORTED_BACKUP_FORMAT}.`,
    )
  }

  if (archiveTables.length === 0) {
    return reject("no-table-data", "Arsip tidak memuat data tabel SISMEPDA.")
  }

  if (archiveTables.includes("_prisma_migrations")) {
    return reject(
      "migration-table-present",
      "Arsip memuat tabel migrasi. Restore data-only tidak boleh menimpa riwayat migrasi.",
    )
  }

  const present = new Set(archiveTables)
  const missingTables = REQUIRED_RBAC_TABLES.filter((table) => !present.has(table))
  if (missingTables.length > 0) {
    return reject(
      "rbac-tables-missing",
      `Arsip tidak kompatibel dengan skema pasca-RBAC. Tabel wajib tidak ditemukan: ${missingTables.join(", ")}. ` +
        "Memulihkannya akan menghapus keanggotaan role yang ada tanpa menggantinya. Database tidak diubah.",
      missingTables,
    )
  }

  return { compatible: true }
}
