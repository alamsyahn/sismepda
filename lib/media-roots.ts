/**
 * Pemilihan akar penyimpanan media per lingkungan.
 *
 * Modul MURNI: tidak menyentuh filesystem maupun `process.env` secara langsung,
 * sehingga keputusan "media ini ditulis ke mana" dapat diuji tanpa menulis satu
 * berkas pun.
 *
 * Alasan file ini ada: `dev:local` dan `dev:prodclone` menjalankan aplikasi yang
 * sama dengan database berbeda. Bila keduanya berbagi satu direktori media,
 * media hasil sinkronisasi produksi akan bercampur dengan media uji lokal, dan
 * tidak ada cara memisahkannya lagi setelah tercampur. Pemisahan dilakukan di
 * sini, bukan dengan mengandalkan operator mengingat mengekspor variabel.
 */

import type { DatabaseRole } from "@/lib/database-target"

/** Subdirektori per peran, relatif terhadap akar media pengembangan. */
export const MEDIA_ROLE_DIRECTORIES: Record<DatabaseRole, string> = {
  local: "local",
  prodclone: "prodclone",
}

/** Akar media pengembangan bila tidak ada konfigurasi eksplisit. */
export const DEVELOPMENT_MEDIA_DIRECTORY = ".media"

export type MediaRootDecision = {
  /** Jalur relatif terhadap cwd, atau nilai konfigurasi apa adanya. */
  path: string
  /** Dari mana keputusan berasal — dipakai untuk pesan diagnostik. */
  source: "configured" | "role-default" | "default"
  role: DatabaseRole | null
}

/**
 * Tentukan akar media dari variabel lingkungan.
 *
 * Urutan sengaja menempatkan MEDIA_STORAGE_ROOT paling atas: produksi dan test
 * mengandalkannya, dan peran database tidak boleh pernah membajak nilai yang
 * sudah ditetapkan operator secara eksplisit.
 */
export function decideMediaRoot(env: {
  MEDIA_STORAGE_ROOT?: string
  SISMEPDA_DB_ROLE?: string
}): MediaRootDecision {
  const configured = env.MEDIA_STORAGE_ROOT?.trim()
  if (configured) return { path: configured, source: "configured", role: null }

  const role = env.SISMEPDA_DB_ROLE?.trim()
  if (role === "local" || role === "prodclone") {
    return {
      path: `${DEVELOPMENT_MEDIA_DIRECTORY}/${MEDIA_ROLE_DIRECTORIES[role]}`,
      source: "role-default",
      role,
    }
  }

  // Tanpa peran (mis. `npm run dev` telanjang, script satuan, build) akar dasar
  // dipakai apa adanya. Ia tetap ter-gitignore dan tetap terpisah dari kedua
  // direktori peran, jadi tidak ada yang tertukar diam-diam.
  return { path: DEVELOPMENT_MEDIA_DIRECTORY, source: "default", role: null }
}

/** Akar media untuk peran tertentu, dipakai script prodclone/backup. */
export function mediaRootForRole(role: DatabaseRole): string {
  return `${DEVELOPMENT_MEDIA_DIRECTORY}/${MEDIA_ROLE_DIRECTORIES[role]}`
}
