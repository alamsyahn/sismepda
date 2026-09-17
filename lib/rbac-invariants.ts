/**
 * Invariant keselamatan kewenangan — bagian murni.
 *
 * Dua invariant yang ditegakkan di sini:
 *
 *   1. Sekolah tidak boleh kehabisan Admin Sistem aktif.
 *   2. Akun istimewa (system_admin MAUPUN pemegang kewenangan sensitif lain)
 *      hanya boleh disentuh identitas/status/kredensialnya oleh system admin.
 *      Tanpa poin kedua, melindungi `system_admin` saja masih menyisakan jalur
 *      pengambilalihan: reset password milik manager RBAC.
 *
 * Fungsi di sini tidak membaca database. Pemanggil wajib mengumpulkan fakta
 * (siapa admin aktif yang TERSISA setelah mutasi) di dalam transaksi yang sama
 * dan dengan penguncian — lihat `lib/rbac-invariants-db.ts`. Pemeriksaan murni
 * saja tidak cukup melawan balapan.
 */

export type InvariantDenialReason =
  | "last_system_admin"
  | "self_disable"
  | "self_delete"
  | "privileged_target"
  | "system_admin_grant_requires_system_admin"
  | "self_revoke_requires_confirmation"

export type InvariantDenial = {
  reason: InvariantDenialReason
  error: string
  status: 403 | 409
}

/**
 * Memastikan masih ada system admin aktif SETELAH mutasi.
 *
 * `remainingActiveAdminIds` adalah KONDISI AKHIR: seluruh system admin yang
 * masih aktif setelah perubahan ditulis, dihitung di dalam transaksi yang
 * memegang kunci.
 *
 * Target TIDAK dikecualikan di sini, dan itu disengaja. Pengecualian target
 * pernah ada sebagai penjaga terhadap query yang lupa membuang admin yang baru
 * saja dicabut — tetapi kondisi akhir sudah membuangnya sendiri: akun yang
 * dinonaktifkan gugur lewat `active`, akun yang dihapus tidak punya baris, dan
 * role yang dicabut tidak lagi punya `UserRole`. Yang tersisa dari pengecualian
 * itu hanyalah kerusakan: satu-satunya Admin Sistem menjadi tidak dapat
 * menyunting role miliknya sama sekali — termasuk melepas role Guru legacy yang
 * tidak menyentuh Admin Sistem — karena dirinya sendiri, yang MASIH admin,
 * dibuang dari perhitungan lalu dinyatakan tidak ada.
 *
 * Invariant yang benar adalah pertanyaan global: setelah operasi ini, apakah
 * sekolah masih punya minimal satu Admin Sistem aktif?
 */
export function assertSystemAdminRemains(input: {
  remainingActiveAdminIds: readonly string[]
  actorId: string
  targetId: string
}): InvariantDenial | null {
  if (input.remainingActiveAdminIds.length > 0) return null

  return {
    reason: "last_system_admin",
    status: 409,
    error: "Ditolak: sekolah harus selalu memiliki minimal satu Admin Sistem aktif.",
  }
}

export type AccountMutationIntent =
  | "update_identity"
  | "update_credentials"
  | "update_status"
  | "deactivate"
  | "delete"
  | "grant_system_admin"
  | "revoke_system_admin"
  | "update_roles"

export type AccountTarget = {
  id: string
  isSystemAdmin: boolean
  /** Memegang minimal satu permission dari keluarga sensitif. */
  hasSensitiveAuthority: boolean
  active: boolean
}

export type AccountMutation = {
  actorId: string
  actorIsSystemAdmin: boolean
  target: AccountTarget
  intent: AccountMutationIntent
  /** Wajib true untuk mencabut system_admin milik sendiri. */
  confirmSelfRevoke?: boolean
}

const SELF_PROTECTED_INTENTS: Partial<Record<AccountMutationIntent, InvariantDenialReason>> = {
  deactivate: "self_disable",
  delete: "self_delete",
}

export function assertAccountMutationAllowed(mutation: AccountMutation): InvariantDenial | null {
  const isSelf = mutation.actorId === mutation.target.id

  // Larangan melumpuhkan diri sendiri berlaku bahkan bagi system admin: ia
  // mencegah sekolah kehilangan akses karena satu klik.
  if (isSelf) {
    const selfReason = SELF_PROTECTED_INTENTS[mutation.intent]
    if (selfReason) {
      return {
        reason: selfReason,
        status: 403,
        error:
          selfReason === "self_delete"
            ? "Anda tidak dapat menghapus akun Anda sendiri."
            : "Anda tidak dapat menonaktifkan akun Anda sendiri.",
      }
    }
  }

  if (mutation.intent === "grant_system_admin" || mutation.intent === "revoke_system_admin") {
    if (!mutation.actorIsSystemAdmin) {
      return {
        reason: "system_admin_grant_requires_system_admin",
        status: 403,
        error: "Hanya Admin Sistem yang dapat memberi atau mencabut peran Admin Sistem.",
      }
    }

    if (isSelf && mutation.intent === "revoke_system_admin" && mutation.confirmSelfRevoke !== true) {
      return {
        reason: "self_revoke_requires_confirmation",
        status: 409,
        error:
          "Mencabut peran Admin Sistem dari diri sendiri memerlukan konfirmasi eksplisit.",
      }
    }

    return null
  }

  // Target istimewa hanya boleh disentuh system admin.
  const targetIsPrivileged = mutation.target.isSystemAdmin || mutation.target.hasSensitiveAuthority
  if (targetIsPrivileged && !mutation.actorIsSystemAdmin) {
    return {
      reason: "privileged_target",
      status: 403,
      error: "Akun dengan kewenangan sensitif hanya dapat diubah oleh Admin Sistem.",
    }
  }

  return null
}
