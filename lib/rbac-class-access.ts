/**
 * Resolver scope kelas yang sadar-operasi.
 *
 * SERVER-ONLY (mengimpor `lib/prisma.ts` lewat `lib/rbac-access.ts`).
 *
 * Menggantikan boolean global `allClasses` lama. Perbedaan pentingnya: scope
 * diselesaikan PER OPERASI (`attendance.read` ≠ `attendance.write` ≠
 * `attendance.export`), sehingga satu grant lebar pada satu operasi tidak
 * pernah ikut melebarkan operasi lain.
 *
 * Bentuk `where` sengaja dipertahankan kompatibel dengan pemanggil lama
 * (`{ homeroomUserId }`), tetapi TIDAK PERNAH menghasilkan `{}` kecuali scope
 * yang benar-benar `all`. Himpunan kelas kosong tetap menjadi filter yang
 * mempersempit, bukan query tanpa batas.
 */
import { prisma } from "@/lib/prisma"
import { ForbiddenError, getAuthorizationContext } from "@/lib/rbac-access"
import { resolveClassScope, type ScopeDecision } from "@/lib/rbac"

export type ClassScope = {
  /// Scope efektif operasi ini pada permintaan sekarang.
  readonly scope: "all" | "assigned_classes"
  /// Filter Prisma untuk `SchoolClass`. `{}` hanya untuk scope `all`.
  readonly where: { homeroomUserId?: string }
  /// Identitas pemanggil, supaya pemeriksaan per-baris tidak perlu membaca ulang.
  readonly userId: string
}

/**
 * Scope kelas untuk satu operasi, atau lempar `ForbiddenError`.
 *
 * `SchoolSetting.allowTeachersAccessAllClasses` dibaca per permintaan dan hanya
 * melebarkan operasi yang memang ada di `CLASS_WIDENING_FAMILIES` serta hanya
 * untuk akun ber-`isTeacher`. Setelan tidak pernah memberi permission baru.
 */
export async function requireClassScopeFor(resource: string, action: string): Promise<ClassScope> {
  const context = await getAuthorizationContext()
  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { allowTeachersAccessAllClasses: true },
  })

  const decision = resolveClassScope({
    subject: context.subject,
    resource,
    action,
    allowTeachersAccessAllClasses: setting?.allowTeachersAccessAllClasses ?? false,
  })

  if (!decision.allowed) throw new ForbiddenError()
  return toClassScope(decision, context.user.id)
}

/**
 * Varian tanpa lempar, untuk menyusun menu/tombol dan halaman yang punya
 * landing aman. Mengembalikan `null` bila operasi tidak diizinkan.
 */
export async function getClassScopeFor(resource: string, action: string): Promise<ClassScope | null> {
  try {
    return await requireClassScopeFor(resource, action)
  } catch (error) {
    if (error instanceof ForbiddenError) return null
    throw error
  }
}

function toClassScope(decision: ScopeDecision, userId: string): ClassScope {
  if (!decision.allowed) throw new ForbiddenError()
  if (decision.scope === "all") return { scope: "all", where: {}, userId }
  return { scope: "assigned_classes", where: { homeroomUserId: userId }, userId }
}

/**
 * Apakah satu kelas konkret termasuk scope ini.
 *
 * Dipakai setelah membaca kelas dari database — relasi wali kelas selalu
 * berasal dari DB, tidak pernah dari payload permintaan.
 */
export function classInScope(
  scope: ClassScope,
  schoolClass: { homeroomUserId: string | null },
): boolean {
  return scope.scope === "all" || schoolClass.homeroomUserId === scope.userId
}
