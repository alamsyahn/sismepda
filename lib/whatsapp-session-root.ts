/**
 * Penentuan lokasi sesi WhatsApp.
 *
 * MURNI: memetakan variabel lingkungan menjadi keputusan jalur. Tidak menyentuh
 * filesystem, sehingga aturan "sesi disimpan di mana" dapat diuji tanpa menulis
 * satu berkas pun — sejalan dengan `lib/media-roots.ts`.
 *
 * Sesi Baileys adalah KREDENSIAL: siapa pun yang memegang isinya dapat mengirim
 * pesan sebagai akun sekolah. Karena itu ia tidak pernah masuk Git, tidak pernah
 * masuk image, dan tidak pernah dikembalikan lewat API.
 */
import type { DatabaseRole } from "@/lib/database-target"

/** Direktori sesi pengembangan, sudah masuk .gitignore. */
export const DEVELOPMENT_SESSION_DIRECTORY = ".whatsapp-session"

/**
 * Pemisahan per peran database.
 *
 * `dev:local` dan `dev:prodclone` menjalankan aplikasi yang sama; tanpa
 * pemisahan ini keduanya berebut satu sesi WhatsApp dan saling memutus koneksi.
 */
export const SESSION_ROLE_DIRECTORIES: Record<DatabaseRole, string> = {
  local: "local",
  prodclone: "prodclone",
}

export type SessionRootDecision = {
  path: string
  source: "configured" | "role-default" | "default"
  role: DatabaseRole | null
}

function normalizeRole(value: string | undefined): DatabaseRole | null {
  if (value === "local" || value === "prodclone") return value
  return null
}

/**
 * Tentukan direktori sesi dari variabel lingkungan.
 *
 * `WHATSAPP_SESSION_DIR` menang mutlak: produksi memasang volume di jalur
 * tetap, dan peran database tidak boleh membajak nilai yang sudah ditetapkan
 * operator.
 */
export function resolveSessionRoot(env: Record<string, string | undefined>): SessionRootDecision {
  const configured = env.WHATSAPP_SESSION_DIR?.trim()
  if (configured) {
    return { path: configured, source: "configured", role: normalizeRole(env.SISMEPDA_DB_ROLE) }
  }

  const role = normalizeRole(env.SISMEPDA_DB_ROLE)
  if (role) {
    return {
      path: `${DEVELOPMENT_SESSION_DIRECTORY}/${SESSION_ROLE_DIRECTORIES[role]}`,
      source: "role-default",
      role,
    }
  }

  return { path: DEVELOPMENT_SESSION_DIRECTORY, source: "default", role: null }
}
