/**
 * Administrasi akun: kredensial dan status aktif.
 *
 * Endpoint paling berbahaya di Phase 6. Mereset sandi seseorang setara dengan
 * menjadi orang itu, jadi jalur ini harus menegakkan seluruh proteksi sekaligus:
 *
 *   - kewenangan dipecah per jenis perubahan (kredensial vs status), sehingga
 *     hak mengaktifkan akun tidak otomatis memberi hak mereset sandi;
 *   - target istimewa hanya boleh disentuh system admin — termasuk pemegang
 *     kewenangan sensitif, bukan hanya literal `system_admin`;
 *   - penonaktifan diri sendiri dilarang, bahkan bagi system admin;
 *   - penonaktifan tidak boleh mengosongkan populasi Admin Sistem, diverifikasi
 *     SETELAH penulisan di dalam transaksi yang memegang kunci populasi;
 *   - payload ketat: field otorisasi yang disuntikkan menolak seluruh permintaan.
 */
import { hash } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { requirePermission, getAuthorizationContext } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"
import { resolveAccountTargetPrivilege } from "@/lib/account-privilege"
import { planAccountDeletion } from "@/lib/account-deletion"
import { assertAccountMutationAllowed } from "@/lib/rbac-invariants"
import {
  InvariantViolationError,
  assertSystemAdminPopulationIntact,
  lockSystemAdminPopulation,
} from "@/lib/rbac-invariants-db"
import { recordAuditLog } from "@/lib/audit-log"
import { accountAdminMutationSchema } from "@/lib/account-schemas"

const accountTargetSelect = {
  id: true,
  name: true,
  nip: true,
  email: true,
  active: true,
  rbacRoles: {
    select: {
      role: {
        select: {
          key: true,
          isProtected: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
} as const

function targetPrivilege(target: {
  rbacRoles: Array<{
    role: { key: string; isProtected: boolean; permissions: Array<{ permission: { key: string } }> }
  }>
}) {
  return resolveAccountTargetPrivilege({
    roles: target.rbacRoles.map((assignment) => ({
      key: assignment.role.key,
      isProtected: assignment.role.isProtected,
      permissionKeys: assignment.role.permissions.map((entry) => entry.permission.key),
    })),
  })
}

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    const { userId } = await context.params
    const body = accountAdminMutationSchema.parse(await request.json())
    const password = "password" in body ? body.password : undefined
    const active = "active" in body ? body.active : undefined

    // Konteks otorisasi, bukan `requireUser`: `CurrentUser` sengaja tidak memuat
    // role/permission agar tidak ada pemanggil yang memakainya sebagai
    // keputusan akses. Status system admin dibaca dari database saat ini.
    const authorization = await getAuthorizationContext()
    const actor = authorization.user

    // Dipecah per jenis perubahan sebelum menyentuh database.
    if (password !== undefined) await requirePermission("accounts.credentials.manage")
    if (active !== undefined) await requirePermission("accounts.status.manage")

    const actorIsSystemAdmin = authorization.isSystemAdmin

    // Schema menjamin tepat satu operasi, jadi intent tidak mungkin salah
    // klasifikasi akibat payload gabungan password + status.
    const intent =
      "password" in body
        ? "update_credentials"
        : active === false
          ? "deactivate"
          : "update_status"

    const updated = await prisma.$transaction(async (tx) => {
      // Kunci yang sama juga dipakai penugasan role. Target dibaca SETELAH lock,
      // sehingga ia tidak dapat memperoleh role sensitif di sela pemeriksaan dan
      // reset sandi/status (TOCTOU).
      await lockSystemAdminPopulation(tx)

      const target = await tx.user.findUnique({ where: { id: userId }, select: accountTargetSelect })
      if (!target) throw new ApiError(404, "Akun tidak ditemukan")

      const privilege = targetPrivilege(target)
      const denial = assertAccountMutationAllowed({
        actorId: actor.id,
        actorIsSystemAdmin,
        intent,
        target: {
          id: target.id,
          isSystemAdmin: privilege.isSystemAdmin,
          hasSensitiveAuthority: privilege.isPrivileged,
          active: target.active,
        },
      })
      if (denial) throw new InvariantViolationError(denial)

      const before = { active: target.active }

      const result = await tx.user.update({
        where: { id: userId },
        data: {
          ...(password !== undefined
            ? { passwordHash: await hash(password, 12) }
            : {}),
          ...(active !== undefined ? { active } : {}),
        },
        select: { id: true, name: true, active: true },
      })

      // Diverifikasi setelah penulisan: yang dinilai kondisi AKHIR transaksi.
      if (intent === "deactivate") {
        await assertSystemAdminPopulationIntact(tx, { actorId: actor.id, targetId: userId })
      }

      await recordAuditLog(
        {
          actorId: actor.id,
          action:
            password !== undefined
              ? "RBAC_ACCOUNT_CREDENTIAL_CHANGED"
              : "RBAC_ACCOUNT_STATUS_CHANGED",
          entity: "UserAuthority",
          entityId: userId,
          targetUserId: userId,
          // Sandi tidak pernah masuk jejak audit, dalam bentuk apa pun.
          before: { active: before.active },
          after: { active: result.active },
          summary:
            password !== undefined
              ? "Sandi akun direset oleh administrator."
              : `Status akun diubah menjadi ${result.active ? "aktif" : "nonaktif"}.`,
        },
        tx,
      )

      return result
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      return NextResponse.json({ error: error.denial.error }, { status: error.denial.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 })
    }
    return authFailureResponse(error, "Akun gagal diperbarui")
  }
}

/**
 * Penghapusan akun permanen.
 *
 * Menuntut konfirmasi identifier — bukan sekadar tombol — karena penghapusan
 * tidak dapat dibatalkan. Pola konfirmasi ini mengikuti jalur hapus guru yang
 * sudah ada.
 *
 * Relasi RESTRICT ditangani `lib/account-deletion.ts`: absensi dialihkan ke
 * aktor, sedangkan atribusi poin pelanggaran MENGHALANGI penghapusan karena
 * tidak ada perlakuan otomatis yang benar atas catatan disipliner siswa.
 */
const accountDeletion = z
  .object({
    confirmationIdentifier: z.string().trim().min(1),
  })
  .strict()

export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    const { userId } = await context.params
    const body = accountDeletion.parse(await request.json())

    await requirePermission("accounts.delete")
    const authorization = await getAuthorizationContext()
    const actor = authorization.user

    const outcome = await prisma.$transaction(async (tx) => {
      // Kunci diambil sebelum MEMBACA target. Assignment dan perubahan role
      // memakai kunci yang sama, sehingga privilege tidak dapat berubah di sela
      // pemeriksaan dan penghapusan.
      await lockSystemAdminPopulation(tx)

      const target = await tx.user.findUnique({ where: { id: userId }, select: accountTargetSelect })
      if (!target) throw new ApiError(404, "Akun tidak ditemukan")

      const confirmation = body.confirmationIdentifier.toLowerCase()
      if (confirmation !== target.nip?.toLowerCase() && confirmation !== target.email?.toLowerCase()) {
        throw new ApiError(400, "Konfirmasi NIP/email tidak sesuai")
      }

      const privilege = targetPrivilege(target)
      const denial = assertAccountMutationAllowed({
        actorId: actor.id,
        actorIsSystemAdmin: authorization.isSystemAdmin,
        intent: "delete",
        target: {
          id: target.id,
          isSystemAdmin: privilege.isSystemAdmin,
          hasSensitiveAuthority: privilege.isPrivileged,
          active: target.active,
        },
      })
      if (denial) throw new InvariantViolationError(denial)

      const [attendanceDays, violationPoints] = await Promise.all([
        tx.attendanceDay.count({ where: { submittedById: userId } }),
        tx.studentViolationPoint.count({ where: { recordedById: userId } }),
      ])
      const plan = planAccountDeletion({
        actorId: actor.id,
        targetId: userId,
        attendanceDays,
        violationPoints,
      })
      if (plan.blocked) {
        return {
          blocked: true as const,
          status: plan.reason === "self_delete" ? 403 : 409,
          reason: plan.reason,
          message: plan.message,
        }
      }

      await tx.schoolClass.updateMany({
        where: { homeroomUserId: userId },
        data: { homeroomUserId: null },
      })
      const reassigned = await tx.attendanceDay.updateMany({
        where: { submittedById: userId },
        data: { submittedById: plan.reassignAttendanceTo },
      })

      // Audit ditulis SEBELUM penghapusan. `targetUserId` sengaja tanpa relasi
      // sehingga id-nya bertahan sebagai catatan, tetapi identitas di baris User
      // akan lenyap — karena itu `before` menyimpan nama/NIP/e-mail/role agar
      // jejak tetap bermakna ketika barisnya sudah tidak ada.
      await recordAuditLog(
        {
          actorId: actor.id,
          action: "RBAC_ACCOUNT_DELETED",
          entity: "UserAuthority",
          entityId: userId,
          targetUserId: userId,
          before: {
            name: target.name,
            nip: target.nip,
            email: target.email,
            active: target.active,
            roleKeys: target.rbacRoles.map((assignment) => assignment.role.key),
          },
          summary: `Akun ${target.name} dihapus permanen; ${reassigned.count} hari absensi dialihkan.`,
        },
        tx,
      )

      await tx.user.delete({ where: { id: userId } })

      // Diverifikasi setelah penghapusan: kondisi AKHIR transaksi.
      await assertSystemAdminPopulationIntact(tx, { actorId: actor.id, targetId: userId })

      return { blocked: false as const, reassignedAttendanceDays: reassigned.count }
    })

    if (outcome.blocked) {
      return NextResponse.json(
        { error: outcome.message, reason: outcome.reason },
        { status: outcome.status },
      )
    }
    return NextResponse.json({ id: userId, reassignedAttendanceDays: outcome.reassignedAttendanceDays })
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      return NextResponse.json({ error: error.denial.error }, { status: error.denial.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 })
    }
    return authFailureResponse(error, "Akun gagal dihapus")
  }
}
