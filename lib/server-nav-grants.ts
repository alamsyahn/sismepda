/**
 * Grant efektif untuk menyusun navigasi.
 *
 * SERVER-ONLY. Dipakai root layout lalu diturunkan ke sidebar sebagai prop,
 * sehingga menu tidak pernah menyimpulkan hak dari sesi/JWT di browser.
 *
 * Kegagalan otentikasi/kesiapan sengaja menghasilkan daftar KOSONG, bukan
 * lemparan: layout juga merender halaman login, dan menu kosong adalah
 * kegagalan yang menutup, bukan membuka.
 */
import { prisma } from "@/lib/prisma"
import { canReadOwnMenstruation } from "@/lib/menstruation-access"
import { deriveNavGrants } from "@/lib/nav-grants"
import { RbacNotReadyError, UnauthorizedError, getAuthorizationContext } from "@/lib/rbac-access"

export type NavIdentity = {
  readonly grants: string[]
  readonly canReadOwnMenstruation: boolean
  /// Nama semua role yang dipegang; kosong berarti "Tanpa role".
  readonly roleNames: string[]
}

export async function readNavGrants(): Promise<NavIdentity> {
  try {
    const context = await getAuthorizationContext()
    const account = context.grants.has("euks.menstruation.read.own")
      ? await prisma.user.findUnique({
          where: { id: context.user.id },
          select: { linkedStudent: { select: { active: true, gender: true } } },
        })
      : null
    return {
      canReadOwnMenstruation: canReadOwnMenstruation(context.grants, account?.linkedStudent ?? null),
      // `context.grants` sudah merupakan grant EFEKTIF (lihat
      // `lib/rbac.ts#effectiveGrants`), jadi bypass system admin ikut
      // tercermin tanpa memateralisasi satu pun baris RolePermission.
      grants: [...deriveNavGrants(context.subject)],
      roleNames: context.roles.map((role) => role.name),
    }
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof RbacNotReadyError) {
      return { grants: [], roleNames: [], canReadOwnMenstruation: false }
    }
    throw error
  }
}
