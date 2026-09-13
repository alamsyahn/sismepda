/**
 * Pure guards for the development-only test account.
 *
 * No Prisma/bcrypt imports so the safety rules stay unit-testable, and so the
 * decision to write is taken before any database connection is opened.
 * Every rule is fail-closed: an unparsable DATABASE_URL, an unknown host, or an
 * unknown database name aborts instead of falling back to a permissive value.
 */

/** Hosts accepted as "the developer's own machine". */
export const localDatabaseHosts = ["localhost", "127.0.0.1", "::1", "[::1]"] as const

/**
 * Database names accepted for the local test account. The production database
 * (`sismepda`) is deliberately absent, so pointing DATABASE_URL at production
 * aborts even when the host somehow resolves as local (SSH tunnel, port
 * forward, /etc/hosts override).
 *
 * `sismepda_prodclone` ada di sini karena clone produksi tetap database lokal
 * yang disposable: akun uji harus dapat dibuat ulang setiap kali clone
 * direfresh. Nama produksi tetap tidak pernah masuk daftar ini.
 */
export const localDatabaseNames = [
  "sismepda_dev",
  "sismepda_local",
  "sismepda_test",
  "sismepda_prodclone",
] as const

/** Email domains reserved for test accounts (RFC 6761 reserved TLD). */
export const localTestEmailDomains = [".test", ".invalid", ".localhost"] as const

export type LocalTestUserEnv = {
  ALLOW_LOCAL_TEST_USER?: string
  DATABASE_URL?: string
  DEV_TEST_USER_EMAIL?: string
  DEV_TEST_USER_PASSWORD?: string
  DEV_TEST_USER_NAME?: string
  NODE_ENV?: string
}

export type LocalTestUserPlan = {
  email: string
  password: string
  name: string
  databaseName: string
  databaseHost: string
}

export type LocalTestUserDecision =
  | { ok: true; plan: LocalTestUserPlan }
  | { ok: false; reason: string }

export const minimumTestPasswordLength = 12

function deny(reason: string): LocalTestUserDecision {
  return { ok: false, reason }
}

/**
 * Decides whether the local test account may be written. Returns the full plan
 * only when every guard passes; otherwise a single human-readable reason.
 */
export function planLocalTestUser(env: LocalTestUserEnv): LocalTestUserDecision {
  if (env.NODE_ENV === "production") {
    return deny("NODE_ENV=production: akun uji lokal tidak boleh dibuat pada runtime produksi.")
  }

  if (env.ALLOW_LOCAL_TEST_USER !== "true") {
    return deny('ALLOW_LOCAL_TEST_USER harus bernilai persis "true" untuk mengizinkan penulisan akun uji lokal.')
  }

  const rawUrl = env.DATABASE_URL?.trim()
  if (!rawUrl) return deny("DATABASE_URL belum dikonfigurasi.")

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return deny("DATABASE_URL tidak dapat diparse sebagai URL. Dibatalkan tanpa penulisan apa pun.")
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return deny(`Protokol DATABASE_URL "${parsed.protocol}" bukan PostgreSQL.`)
  }

  const host = parsed.hostname.toLowerCase()
  if (!host) return deny("DATABASE_URL tidak memiliki host. Dibatalkan.")
  if (!(localDatabaseHosts as readonly string[]).includes(host)) {
    return deny(
      `Host database "${host}" bukan host lokal. Diizinkan hanya: ${localDatabaseHosts.join(", ")}.`,
    )
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).trim()
  if (!databaseName) return deny("Nama database tidak ada pada DATABASE_URL. Dibatalkan.")
  if (!(localDatabaseNames as readonly string[]).includes(databaseName)) {
    return deny(
      `Nama database "${databaseName}" bukan database development. Diizinkan hanya: ${localDatabaseNames.join(", ")}.`,
    )
  }

  const email = env.DEV_TEST_USER_EMAIL?.trim().toLowerCase()
  if (!email) return deny("DEV_TEST_USER_EMAIL wajib diisi.")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return deny(`DEV_TEST_USER_EMAIL "${email}" bukan email yang valid.`)
  if (!localTestEmailDomains.some((suffix) => email.endsWith(suffix))) {
    return deny(
      `DEV_TEST_USER_EMAIL harus memakai domain khusus pengujian (${localTestEmailDomains.join(", ")}) agar tidak mungkin bertabrakan dengan akun nyata.`,
    )
  }

  const password = env.DEV_TEST_USER_PASSWORD
  if (!password) return deny("DEV_TEST_USER_PASSWORD wajib diisi (jangan pernah di-hardcode di source code).")
  if (password.length < minimumTestPasswordLength) {
    return deny(`DEV_TEST_USER_PASSWORD minimal ${minimumTestPasswordLength} karakter.`)
  }

  return {
    ok: true,
    plan: {
      email,
      password,
      name: env.DEV_TEST_USER_NAME?.trim() || "Akun Uji Lokal",
      databaseName,
      databaseHost: host,
    },
  }
}
