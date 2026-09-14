/**
 * Aturan penghitungan verifikasi media — bagian MURNI.
 *
 * Dipisahkan dari `scripts/verify-media-migration.ts` supaya aturan "apa yang
 * dianggap valid, hilang, tidak cocok, atau yatim" dapat diuji tanpa database
 * dan tanpa filesystem.
 */

export type VerificationTally = {
  total: number
  migrated: number
  valid: number
  missing: number
  mismatch: number
  legacyRetained: number
  /** Record tanpa kunci DAN tanpa byte legacy: tidak dapat ditampilkan sama sekali. */
  orphaned: number
}

/**
 * Hitung tally dari hasil pemeriksaan per baris.
 *
 * Dipisahkan sebagai fungsi murni agar aturan penghitungan dapat diuji tanpa
 * database maupun filesystem.
 */
export function tally(
  rows: readonly {
    key: string | null
    hasLegacy: boolean
    fileExists: boolean
    sizeMatches: boolean
  }[],
): VerificationTally {
  const result: VerificationTally = {
    total: rows.length,
    migrated: 0,
    valid: 0,
    missing: 0,
    mismatch: 0,
    legacyRetained: 0,
    orphaned: 0,
  }

  for (const row of rows) {
    if (row.hasLegacy) result.legacyRetained += 1
    if (row.key) {
      result.migrated += 1
      if (!row.fileExists) result.missing += 1
      else if (!row.sizeMatches) result.mismatch += 1
      else result.valid += 1
    } else if (!row.hasLegacy) {
      result.orphaned += 1
    }
  }

  return result
}
