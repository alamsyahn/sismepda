/**
 * Populasi guru dan proteksi target istimewa.
 *
 * SERVER-ONLY (mengimpor `lib/prisma.ts`).
 *
 * Dua hal yang dipisahkan di sini:
 *
 * 1. SIAPA yang termasuk "guru". Sejak Phase 2 ini adalah `User.isTeacher`,
 *    bukan `role === "GURU"`. Selama Phase 4 kolom legacy masih ada, tetapi
 *    tidak lagi menjadi sumber populasi direktori/akun guru.
 *
 * 2. SIAPA yang tidak boleh disentuh operasi akun biasa. Sistem lama melindungi
 *    superadmin; proteksi itu dipertahankan dan diperkuat: target yang memegang
 *    role sistem/terproteksi hanya boleh disentuh oleh system admin.
 */
import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/api-errors"
import { getAuthorizationContext } from "@/lib/rbac-access"
import { resolveAccountTargetPrivilege } from "@/lib/account-privilege"

/**
 * Filter Prisma untuk populasi guru.
 *
 * Sumber tunggal: `User.isTeacher`. Backfill identitas legacy sudah COMPLETED,
 * sehingga cabang `role = "GURU"` tidak lagi menjangkau baris mana pun —
 * mempertahankannya hanya menyisakan sumber kebenaran kedua yang bisa
 * menyimpang diam-diam.
 *
 * Kolom `User.role` sengaja TIDAK di-drop (Phase 6 menunda kontraksi skema);
 * ia sekadar berhenti dibaca.
 */
export function teacherPopulationWhere(): { isTeacher: boolean } {
  return { isTeacher: true }
}

/**
 * Menolak operasi akun terhadap target ISTIMEWA, kecuali pemanggilnya system
 * admin.
 *
 * Keistimewaan dinilai `lib/account-privilege.ts` dari kuasa NYATA target:
 * key `system_admin`, flag `isProtected`, ATAU kepemilikan permission keluarga
 * sensitif (`rbac.*`, `accounts.*`, `database.*`, dan dua key khusus).
 *
 * Flag `isProtected` saja tidak cukup. Ia menandai role bawaan seed, bukan
 * kuasa; role kustom tanpa flag apa pun yang memegang
 * `accounts.credentials.manage` tetap dapat mereset sandi orang lain. Tanpa
 * penilaian berbasis permission, pemegang `teachers.accounts.update` dapat
 * mereset sandi manager RBAC dan mengambil alih akunnya — eskalasi hak yang
 * tampak sepenuhnya sah menurut permission-nya sendiri.
 *
 * `isSystem` tetap TIDAK dipakai: `guru`, `pengawas`, dan role seed lain ikut
 * bertanda itu, sehingga memakainya akan mengunci hampir semua akun guru biasa.
 */
export async function assertTargetNotPrivileged(targetUserId: string): Promise<void> {
  const context = await getAuthorizationContext()
  if (context.isSystemAdmin) return

  const assignments = await prisma.userRole.findMany({
    where: { userId: targetUserId },
    select: {
      role: {
        select: {
          key: true,
          isProtected: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  })

  const privilege = resolveAccountTargetPrivilege({
    roles: assignments.map((assignment) => ({
      key: assignment.role.key,
      isProtected: assignment.role.isProtected,
      permissionKeys: assignment.role.permissions.map((entry) => entry.permission.key),
    })),
  })

  if (privilege.isPrivileged) {
    throw new ApiError(403, "Akun ini hanya dapat dikelola oleh administrator sistem")
  }
}
