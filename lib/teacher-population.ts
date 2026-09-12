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

/**
 * Filter Prisma untuk populasi guru.
 *
 * Catatan transisi: baris legacy yang belum di-backfill masih memiliki
 * `role = "GURU"` dengan `isTeacher = false`. Backfill identitas dijadwalkan
 * Phase 3/5; sampai itu terjadi, keduanya diterima agar direktori tidak
 * mendadak kosong. Kolom legacy TIDAK dipakai untuk keputusan otorisasi —
 * hanya untuk menentukan keanggotaan populasi.
 */
export function teacherPopulationWhere(): { OR: Array<{ isTeacher: boolean } | { role: "GURU" }> } {
  return { OR: [{ isTeacher: true }, { role: "GURU" }] }
}

/**
 * Menolak operasi akun terhadap target yang memegang role TERPROTEKSI,
 * kecuali pemanggilnya system admin.
 *
 * Hanya `isProtected` yang dipakai sebagai penanda istimewa. `isSystem` berarti
 * "role bawaan seed" — `guru`, `pengawas`, dan lainnya ikut bertanda itu, jadi
 * memakainya di sini akan mengunci hampir semua akun guru biasa.
 *
 * Tanpa proteksi ini, siapa pun yang diberi `teachers.accounts.update` atau
 * `accounts.credentials.manage` bisa mengambil alih akun administrator dengan
 * mereset sandinya — eskalasi hak yang sepenuhnya sah menurut permission-nya.
 */
export async function assertTargetNotPrivileged(targetUserId: string): Promise<void> {
  const context = await getAuthorizationContext()
  if (context.isSystemAdmin) return

  const target = await prisma.userRole.findFirst({
    where: {
      userId: targetUserId,
      role: { isProtected: true },
    },
    select: { roleId: true },
  })

  if (target) {
    throw new ApiError(403, "Akun ini hanya dapat dikelola oleh administrator sistem")
  }
}
