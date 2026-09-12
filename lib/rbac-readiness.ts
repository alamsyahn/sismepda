/**
 * Kesiapan RBAC.
 *
 * MURNI: tidak mengimpor Prisma. Menerjemahkan baris `RbacMigration` menjadi
 * status kesiapan yang dipakai guard. Semantik fail closed:
 *
 *   ready      → backfill legacy COMPLETED, atau database bootstrap segar yang
 *                terbukti tidak punya akun legacy yang perlu migrasi.
 *   not-ready  → belum pernah/masih berjalan/gagal → guard RBAC menolak.
 *   error      → status tidak terbaca (query gagal) → guard RBAC menolak.
 *
 * Tidak ada jalur "UserRole kosong ⇒ pakai GURU" atau "query gagal ⇒ pakai
 * flag legacy".
 */

import { LEGACY_BACKFILL_KEY } from "@/lib/rbac-legacy"

export type RbacMigrationRow = {
  readonly key: string
  readonly status: "RUNNING" | "FAILED" | "COMPLETED"
}

export type RbacReadiness =
  | { readonly state: "ready"; readonly reason: "backfill-completed" | "fresh-database" }
  | {
      readonly state: "not-ready"
      readonly reason: "backfill-missing" | "backfill-running" | "backfill-failed"
    }
  | { readonly state: "error"; readonly reason: string }

export type ReadinessInput = {
  /// Baris marker backfill legacy, atau null bila belum ada.
  readonly backfill: RbacMigrationRow | null
  /// Jumlah akun yang ada di tabel User (legacy atau bukan).
  readonly userCount: number
}

export function evaluateReadiness(input: ReadinessInput): RbacReadiness {
  const { backfill, userCount } = input

  if (backfill) {
    if (backfill.key !== LEGACY_BACKFILL_KEY) {
      return { state: "error", reason: `marker tidak dikenal: ${backfill.key}` }
    }
    switch (backfill.status) {
      case "COMPLETED":
        return { state: "ready", reason: "backfill-completed" }
      case "RUNNING":
        return { state: "not-ready", reason: "backfill-running" }
      case "FAILED":
        return { state: "not-ready", reason: "backfill-failed" }
    }
  }

  // Tanpa marker: hanya database yang belum punya akun sama sekali yang boleh
  // dianggap siap — tidak ada akun legacy yang bisa kehilangan akses.
  if (userCount === 0) return { state: "ready", reason: "fresh-database" }
  return { state: "not-ready", reason: "backfill-missing" }
}

export function isRbacReady(readiness: RbacReadiness): boolean {
  return readiness.state === "ready"
}
