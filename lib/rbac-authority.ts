import { isKnownPermission, isSensitiveAuthority } from "./rbac-permissions"

/**
 * Batas kewenangan pendelegasian RBAC.
 *
 * Modul ini murni: tidak menyentuh database, tidak membaca sesi. Ia menjawab
 * satu pertanyaan — bolehkah aktor ini mengubah kewenangan sebuah role? —
 * sehingga aturannya bisa diuji tanpa infrastruktur dan dipakai kembali oleh
 * route handler mana pun.
 *
 * Prinsip yang ditegakkan:
 *
 * 1. Hanya system admin aktif yang boleh menyentuh kewenangan sensitif
 *    (memberi MAUPUN mencabut). Memegang sebuah kewenangan tidak dengan
 *    sendirinya memberi hak mendelegasikannya.
 * 2. Manager biasa tidak boleh memberi apa yang tidak ia pegang sendiri.
 * 3. Role terproteksi tidak bisa disentuh oleh non-system-admin.
 * 4. Payload yang mengandung satu saja entri terlarang ditolak SELURUHNYA.
 *    Modul ini sengaja tidak punya jalur pengembalian "daftar yang disetujui",
 *    supaya tidak ada pemanggil yang bisa menyimpan sebagian diam-diam.
 */

export type AuthorityActor = {
  /** True hanya bila aktor memegang role `system_admin` yang aktif. */
  isSystemAdmin: boolean
  /** Permission efektif milik aktor (gabungan seluruh role aktifnya). */
  grants: ReadonlySet<string>
}

export type TargetRole = {
  key: string
  name: string
  isProtected: boolean
  isSystem: boolean
}

export type AuthorityDenialReason =
  | "beyond_own_authority"
  | "sensitive_requires_system_admin"
  | "protected_role"
  | "unknown_permission"

export type AuthorityDenial = {
  reason: AuthorityDenialReason
  /** Key yang memicu penolakan, untuk pesan galat dan audit. */
  keys: string[]
}

export type RoleMutationRequest = {
  actor: AuthorityActor
  role: TargetRole
  /** Permission yang akan ditambahkan ke role. */
  addedKeys: readonly string[]
  /** Permission yang akan dicabut dari role. */
  removedKeys: readonly string[]
}

/**
 * Mengevaluasi sebuah perubahan permission role.
 *
 * Mengembalikan `null` bila diizinkan, atau penolakan pertama yang ditemukan.
 * Urutan pemeriksaan dipilih supaya pesan galatnya paling informatif: key tak
 * dikenal lebih dulu (itu bug klien), lalu proteksi role, lalu sensitivitas,
 * lalu batas kewenangan aktor.
 */
export function assertRoleMutationAllowed(request: RoleMutationRequest): AuthorityDenial | null {
  const { actor, role, addedKeys, removedKeys } = request
  const touchedKeys = [...addedKeys, ...removedKeys]

  const unknown = touchedKeys.filter((key) => !isKnownPermission(key))
  if (unknown.length > 0) {
    return { reason: "unknown_permission", keys: unique(unknown) }
  }

  if (actor.isSystemAdmin) {
    return null
  }

  // Role terproteksi/sistem hanya boleh disentuh system admin, apa pun isinya.
  if (role.isProtected || role.isSystem) {
    return { reason: "protected_role", keys: [] }
  }

  // Kewenangan sensitif — baik diberi maupun dicabut — menuntut system admin.
  const sensitive = touchedKeys.filter((key) => isSensitiveAuthority(key))
  if (sensitive.length > 0) {
    return { reason: "sensitive_requires_system_admin", keys: unique(sensitive) }
  }

  // Sisanya: aktor hanya boleh memberikan apa yang ia pegang sendiri.
  const beyond = addedKeys.filter((key) => !actor.grants.has(key))
  if (beyond.length > 0) {
    return { reason: "beyond_own_authority", keys: unique(beyond) }
  }

  return null
}

export type AuthorityFailure = {
  status: 400 | 403
  error: string
  reason: AuthorityDenialReason
  keys: string[]
}

/**
 * Menerjemahkan penolakan menjadi respons API.
 *
 * Key tak dikenal adalah permintaan cacat (400). Sisanya adalah kekurangan
 * hak (403) — dan statusnya memang 403, bukan 400, supaya klien maupun audit
 * tidak salah membaca penyebabnya.
 */
export function describeAuthorityDenial(denial: AuthorityDenial): AuthorityFailure {
  const keys = denial.keys
  const list = keys.join(", ")

  switch (denial.reason) {
    case "unknown_permission":
      return {
        status: 400,
        reason: denial.reason,
        keys,
        error: `Permission tidak dikenal: ${list}.`,
      }
    case "protected_role":
      return {
        status: 403,
        reason: denial.reason,
        keys,
        error: "Role terproteksi hanya dapat diubah oleh Admin Sistem.",
      }
    case "sensitive_requires_system_admin":
      return {
        status: 403,
        reason: denial.reason,
        keys,
        error: `Kewenangan sensitif hanya dapat diatur oleh Admin Sistem: ${list}.`,
      }
    case "beyond_own_authority":
      return {
        status: 403,
        reason: denial.reason,
        keys,
        error: `Anda tidak dapat memberikan permission yang tidak Anda miliki: ${list}.`,
      }
  }
}

function unique(keys: readonly string[]): string[] {
  return [...new Set(keys)]
}
