/**
 * Aturan MURNI untuk tahap bootstrap RBAC pada refresh prodclone.
 *
 * Latar belakang yang sama dengan TD-014: langkah bootstrap ditulis ketika dump
 * produksi masih berasal dari schema PRA-RBAC, sehingga clone selalu tiba tanpa
 * role, permission, maupun keanggotaan, dan backfill legacy wajib dijalankan.
 *
 * Sejak backfill diterapkan ke produksi, dump produksi sudah membawa
 * keanggotaan RBAC **beserta** marker `RbacMigration[legacy-access-backfill-v1]`
 * berstatus COMPLETED. Menjalankan `--apply` lagi terhadap clone semacam itu
 * ditolak oleh kontrak backfill sendiri — dan penolakan itu benar: memulihkan
 * grant yang sudah dicabut admin justru merusak kesetaraan clone dengan
 * produksi.
 *
 * Karena itu keputusannya dibaca dari MARKER NYATA di clone, bukan diasumsikan,
 * dan bukan pula ditelan sebagai kegagalan yang diabaikan.
 */

/** Status marker backfill sebagaimana tercatat di tabel `RbacMigration`. */
export const LEGACY_BACKFILL_MARKER_KEY = "legacy-access-backfill-v1"

export type BackfillMarkerStatus = "COMPLETED" | "RUNNING" | "FAILED" | "ABSENT"

export type LegacyBackfillPlan =
  /** Marker belum COMPLETED: backfill `--apply` masih merupakan jalur forward. */
  | { action: "apply"; reason: string }
  /** Sudah COMPLETED di sumber dump: keanggotaan ikut terbawa, apply ditolak. */
  | { action: "skip"; reason: string }
  /** Keadaan di luar dua di atas. Tidak pernah ditebak. */
  | { action: "abort"; reason: string }

/** SQL read-only untuk membaca status marker backfill di clone. */
export function legacyBackfillMarkerQuery(): string {
  return (
    "select coalesce((select status::text from \"RbacMigration\" " +
    `where key = '${LEGACY_BACKFILL_MARKER_KEY}'), 'ABSENT')`
  )
}

/**
 * Mengurai keluaran `psql -At` menjadi status marker.
 *
 * Fail-closed: nilai di luar himpunan yang dikenal mengembalikan `null` supaya
 * pemanggil membatalkan alih-alih memperlakukannya sebagai "belum pernah jalan".
 */
export function parseBackfillMarkerStatus(stdout: string): BackfillMarkerStatus | null {
  const value = stdout.trim().toUpperCase()
  if (value === "COMPLETED" || value === "RUNNING" || value === "FAILED" || value === "ABSENT") {
    return value
  }
  return null
}

/**
 * Memutuskan apa yang harus dilakukan tahap backfill legacy.
 *
 * `RUNNING` dan `FAILED` sengaja tetap `apply`: kontrak backfill memang
 * resumable untuk kedua status itu, dan melewatinya akan meninggalkan clone
 * dengan keanggotaan setengah jadi.
 */
export function planLegacyRbacBackfill(status: BackfillMarkerStatus): LegacyBackfillPlan {
  if (status === "COMPLETED") {
    return {
      action: "skip",
      reason:
        `Marker \`${LEGACY_BACKFILL_MARKER_KEY}\` sudah COMPLETED di dump produksi, ` +
        "sehingga keanggotaan RBAC ikut terbawa restore. Apply ulang ditolak kontrak backfill " +
        "agar grant yang sudah dicabut admin tidak dipulihkan.",
    }
  }

  if (status === "ABSENT") {
    return {
      action: "apply",
      reason:
        `Marker \`${LEGACY_BACKFILL_MARKER_KEY}\` belum ada: dump berasal dari schema pra-RBAC, ` +
        "jadi backfill legacy masih merupakan jalur forward.",
    }
  }

  return {
    action: "apply",
    reason:
      `Marker \`${LEGACY_BACKFILL_MARKER_KEY}\` berstatus ${status}: backfill resumable dilanjutkan ` +
      "sampai paritas lulus.",
  }
}

/**
 * Verifikasi read-only untuk jalur `skip`: melewati backfill tidak boleh berarti
 * melewati pemeriksaan. Clone yang diklaim sudah ter-backfill harus benar-benar
 * memiliki registry role dan keanggotaan; nol pada salah satunya berarti
 * aplikasi akan boot tanpa satu pun izin, dan itu wajib membatalkan refresh.
 */
export function rbacReadinessQuery(): string {
  return "select (select count(*) from \"RbacRole\") || '|' || (select count(*) from \"UserRole\")"
}

export type RbacReadiness =
  | { ok: true; roles: number; memberships: number }
  | { ok: false; reason: string }

export function evaluateRbacReadiness(stdout: string): RbacReadiness {
  const parts = stdout.trim().split("|")
  if (parts.length !== 2) {
    return { ok: false, reason: `Hasil pemeriksaan kesiapan RBAC tidak terbaca: "${stdout.trim()}".` }
  }

  const roles = Number(parts[0])
  const memberships = Number(parts[1])
  if (!Number.isInteger(roles) || !Number.isInteger(memberships)) {
    return { ok: false, reason: `Hasil pemeriksaan kesiapan RBAC bukan bilangan: "${stdout.trim()}".` }
  }

  if (roles === 0 || memberships === 0) {
    return {
      ok: false,
      reason:
        `Clone tidak siap dipakai: ${roles} role, ${memberships} keanggotaan. ` +
        "Aplikasi akan dapat login tetapi tanpa satu pun izin.",
    }
  }

  return { ok: true, roles, memberships }
}
