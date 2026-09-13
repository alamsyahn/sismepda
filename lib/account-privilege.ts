/**
 * Menilai apakah sebuah akun adalah target istimewa.
 *
 * Bagian MURNI: tidak membaca database, sehingga aturannya dapat diuji penuh.
 *
 * Mengapa ada: proteksi sebelumnya hanya melihat flag `isProtected`. Flag itu
 * menandai role bawaan seed, bukan kuasa nyata. Role kustom bernama apa pun yang
 * memegang `accounts.credentials.manage` dapat mereset sandi orang lain — tanpa
 * flag apa pun. Siapa pun yang memiliki `teachers.accounts.update` karena itu
 * bisa mereset sandi manager RBAC dan mengambil alih akunnya, eskalasi hak yang
 * tampak sah menurut permission-nya sendiri.
 *
 * Keistimewaan karena itu diputuskan dari tiga hal, dalam urutan ini:
 *   1. key `system_admin` — bukan nama tampilan, yang tidak pernah memberi kuasa;
 *   2. flag `isProtected` — dipertahankan demi kompatibilitas role seed;
 *   3. kepemilikan nyata minimal satu permission keluarga sensitif.
 */
import { SYSTEM_ADMIN_ROLE_KEY, isKnownPermission, isSensitiveAuthority } from "@/lib/rbac-permissions"

export type AccountTargetRole = {
  key: string
  isProtected: boolean
  permissionKeys: readonly string[]
}

export type AccountTargetPrivilege = {
  isPrivileged: boolean
  isSystemAdmin: boolean
  /** Permission sensitif yang benar-benar dipegang target, untuk pesan audit. */
  sensitiveKeys: readonly string[]
}

export function resolveAccountTargetPrivilege(input: {
  roles: readonly AccountTargetRole[]
}): AccountTargetPrivilege {
  const isSystemAdmin = input.roles.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEY)
  const holdsProtectedRole = input.roles.some((role) => role.isProtected)

  // Hanya permission yang dikenal registry yang dinilai. Kunci asing (sisa data
  // lama atau salah tulis) tidak boleh diam-diam mengunci sebuah akun; fail
  // closed adalah aturan saat MEMBERI kewenangan, bukan saat menilai apa yang
  // sudah dipegang.
  const sensitiveKeys = [
    ...new Set(
      input.roles
        .flatMap((role) => role.permissionKeys)
        .filter((key) => isKnownPermission(key) && isSensitiveAuthority(key)),
    ),
  ]

  return {
    isPrivileged: isSystemAdmin || holdsProtectedRole || sensitiveKeys.length > 0,
    isSystemAdmin,
    sensitiveKeys,
  }
}
