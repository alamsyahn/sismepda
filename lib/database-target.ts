/**
 * Aturan murni untuk memilih database lokal mana yang dipakai sebuah perintah.
 *
 * Tidak ada import Prisma, `pg`, `fs`, atau proses anak di sini supaya:
 * 1. seluruh guard dapat diuji sebagai fungsi murni, dan
 * 2. keputusan "boleh menulis atau tidak" diambil SEBELUM koneksi dibuka —
 *    pola yang sama dengan `lib/local-test-user.ts` dan `lib/euks-test-data.ts`.
 *
 * Setiap guard fail-closed. Nilai tak dikenal, URL gagal parse, atau nama
 * database di luar allowlist membatalkan perintah, bukan jatuh ke nilai
 * permisif.
 */

import { localDatabaseHosts } from "@/lib/local-test-user"

/**
 * Nama database produksi. Hanya dipakai sebagai daftar TOLAK: tidak satu pun
 * workflow lokal boleh menargetkannya, bahkan jika host terbaca lokal karena
 * SSH tunnel, port-forward, atau override /etc/hosts.
 */
export const productionDatabaseNames = ["sismepda"] as const

/** Dua peran database lokal yang dikenal workflow ini. */
export type DatabaseRole = "local" | "prodclone"

export type DatabaseTargetSpec = {
  /** Peran yang diminta operator lewat nama skrip npm. */
  role: DatabaseRole
  /** File environment yang memuat DATABASE_URL untuk peran itu. */
  envFile: string
  /** Nama database yang WAJIB dilayani; pembanding untuk seluruh guard. */
  expectedDatabase: string
  /** Label untuk pesan manusia. */
  label: string
}

/**
 * Peta peran → target. Disimpan sebagai konstanta, bukan dihitung dari
 * environment, supaya nama database tujuan tidak dapat digeser oleh env var.
 */
export const databaseTargets: Record<DatabaseRole, DatabaseTargetSpec> = {
  local: {
    role: "local",
    envFile: ".env",
    expectedDatabase: "sismepda_dev",
    label: "database development lokal",
  },
  prodclone: {
    role: "prodclone",
    envFile: ".env.prodclone",
    expectedDatabase: "sismepda_prodclone",
    label: "clone lokal data produksi",
  },
}

export function isDatabaseRole(value: string): value is DatabaseRole {
  return value === "local" || value === "prodclone"
}

export type ParsedDatabaseUrl = {
  host: string
  port: number
  database: string
  schema: string
}

export type DatabaseTargetDecision =
  | { ok: true; parsed: ParsedDatabaseUrl }
  | { ok: false; reason: string }

/** Prefiks penolakan; sengaja seragam agar mudah dicari di log. */
export const TARGET_REFUSAL_PREFIX = "ABORT:"

function deny(reason: string): DatabaseTargetDecision {
  return { ok: false, reason }
}

/**
 * Mengurai DATABASE_URL tanpa pernah mengembalikan kredensial.
 *
 * Nilai yang dikembalikan sengaja hanya berisi host, port, nama database, dan
 * schema: itu satu-satunya bagian yang perlu dicetak ke terminal, sehingga
 * tidak ada jalur kode yang bisa membocorkan password ke log.
 */
export function parseDatabaseUrl(rawUrl: string | undefined): DatabaseTargetDecision {
  const trimmed = rawUrl?.trim()
  if (!trimmed) return deny("DATABASE_URL belum dikonfigurasi.")

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return deny("DATABASE_URL tidak dapat diparse sebagai URL. Dibatalkan tanpa operasi apa pun.")
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return deny(`Protokol DATABASE_URL "${parsed.protocol}" bukan PostgreSQL.`)
  }

  const host = parsed.hostname.toLowerCase()
  if (!host) return deny("DATABASE_URL tidak memiliki host. Dibatalkan.")

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).trim()
  if (!database) return deny("Nama database tidak ada pada DATABASE_URL. Dibatalkan.")

  return {
    ok: true,
    parsed: {
      host,
      port: parsed.port ? Number(parsed.port) : 5432,
      database,
      schema: parsed.searchParams.get("schema")?.trim() || "public",
    },
  }
}

/**
 * Memutuskan apakah `url` sah dipakai untuk peran `spec`.
 *
 * Empat lapis, seluruhnya wajib lolos:
 * A. URL dapat diparse sebagai PostgreSQL.
 * B. Host adalah mesin developer sendiri. Nama service Docker dan host remote
 *    ditolak: seluruh deployment produksi proyek ini memakai host service
 *    Docker, sehingga menerimanya justru menghapus pembeda terpenting.
 * C. Nama database BUKAN nama database produksi.
 * D. Nama database sama persis dengan yang dipatok untuk peran tersebut, jadi
 *    `dev:prodclone` tidak mungkin berjalan di atas `sismepda_dev` dan
 *    sebaliknya.
 */
export function planDatabaseTarget(
  spec: DatabaseTargetSpec,
  url: string | undefined,
): DatabaseTargetDecision {
  const decision = parseDatabaseUrl(url)
  if (!decision.ok) return decision

  const { host, database } = decision.parsed

  if (!(localDatabaseHosts as readonly string[]).includes(host)) {
    return deny(
      `Host database "${host}" bukan host lokal. Diizinkan hanya: ${localDatabaseHosts.join(", ")}.`,
    )
  }

  if ((productionDatabaseNames as readonly string[]).includes(database)) {
    return deny(
      `Database "${database}" adalah nama database PRODUKSI. Workflow lokal tidak boleh menargetkannya.`,
    )
  }

  if (database !== spec.expectedDatabase) {
    return deny(
      `Peran "${spec.role}" wajib memakai database "${spec.expectedDatabase}", tetapi ${spec.envFile} menunjuk "${database}".`,
    )
  }

  return decision
}

/**
 * Guard tambahan khusus operasi destruktif terhadap clone (drop/recreate).
 *
 * Dipisahkan dari `planDatabaseTarget` karena syaratnya lebih keras: selain
 * harus benar-benar prodclone, target juga harus dibuktikan BUKAN database
 * development persisten. `sismepda_dev` memuat data dummy dan akun lokal yang
 * dibangun berhari-hari, jadi kehilangannya tidak dapat dipulihkan dari
 * produksi.
 */
export function assertDestroyableClone(parsed: ParsedDatabaseUrl): void {
  const problems: string[] = []

  if (!(localDatabaseHosts as readonly string[]).includes(parsed.host)) {
    problems.push(`host "${parsed.host}" bukan host lokal`)
  }
  if ((productionDatabaseNames as readonly string[]).includes(parsed.database)) {
    problems.push(`"${parsed.database}" adalah database produksi`)
  }
  if (parsed.database === databaseTargets.local.expectedDatabase) {
    problems.push(
      `"${parsed.database}" adalah database development persisten dan tidak boleh dihapus oleh workflow ini`,
    )
  }
  if (parsed.database !== databaseTargets.prodclone.expectedDatabase) {
    problems.push(`"${parsed.database}" bukan "${databaseTargets.prodclone.expectedDatabase}"`)
  }

  if (problems.length > 0) {
    throw new Error(
      `${TARGET_REFUSAL_PREFIX} Operasi destruktif ditolak karena ${problems.join("; ")}. Tidak ada perubahan yang dilakukan.`,
    )
  }
}

/**
 * Pemeriksaan lapis terakhir setelah koneksi terbuka: nama database yang
 * benar-benar dilayani server harus sama dengan yang direncanakan. Menahan
 * kasus di mana URL dibaca berbeda oleh driver (alias, tunnel, pgbouncer).
 */
export function verifyServedDatabase(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      `${TARGET_REFUSAL_PREFIX} Server melayani database "${actual}", bukan "${expected}". Dibatalkan.`,
    )
  }
}

/** Ringkasan aman untuk dicetak: tanpa user, tanpa password. */
export function describeTarget(parsed: ParsedDatabaseUrl): string {
  return `${parsed.host}:${parsed.port}/${parsed.database} (schema ${parsed.schema})`
}

/**
 * Parser dotenv minimal untuk membaca file environment peran.
 *
 * Sengaja tanpa dependency: kebutuhannya hanya `KEY=value` dengan tanda kutip
 * opsional, dan menambah paket untuk itu memperluas permukaan supply-chain
 * pada jalur yang memegang kredensial. Ditaruh di modul murni ini supaya dapat
 * diuji tanpa menjalankan runner yang punya efek samping proses.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (key) result[key] = value
  }
  return result
}
