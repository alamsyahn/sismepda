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

/**
 * `.strict()` disengaja: payload berisi `role`, `roles`, `permissionKeys`, atau
 * `isTeacher` ditolak 400 alih-alih dibuang diam-diam oleh mode strip Zod.
 * Penyerang tidak boleh menerima 200 untuk permintaan yang sebagian diabaikan.
 */
const accountMutation = z
  .object({
    password: z.string().min(8).max(128).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.password !== undefined || value.active !== undefined, {
    message: "Tidak ada perubahan yang diminta",
  })

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    verifySameOrigin(request)

    const { userId } = await context.params
    const body = accountMutation.parse(await request.json())

    // Konteks otorisasi, bukan `requireUser`: `CurrentUser` sengaja tidak memuat
    // role/permission agar tidak ada pemanggil yang memakainya sebagai
    // keputusan akses. Status system admin dibaca dari database saat ini.
    const authorization = await getAuthorizationContext()
    const actor = authorization.user

    // Dipecah per jenis perubahan sebelum menyentuh database.
    if (body.password !== undefined) await requirePermission("accounts.credentials.manage")
    if (body.active !== undefined) await requirePermission("accounts.status.manage")

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
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
      },
    })
    if (!target) throw new ApiError(404, "Akun tidak ditemukan")

    const privilege = resolveAccountTargetPrivilege({
      roles: target.rbacRoles.map((assignment) => ({
        key: assignment.role.key,
        isProtected: assignment.role.isProtected,
        permissionKeys: assignment.role.permissions.map((entry) => entry.permission.key),
      })),
    })

    const actorIsSystemAdmin = authorization.isSystemAdmin

    // Satu intent per permintaan. Menonaktifkan dinilai lebih keras daripada
    // mengaktifkan, karena hanya penonaktifan dapat mengosongkan populasi admin.
    const intent =
      body.password !== undefined
        ? "update_credentials"
        : body.active === false
          ? "deactivate"
          : "update_status"

    const denial = assertAccountMutationAllowed({
      actorId: actor.id,
      actorIsSystemAdmin,
      intent,
      target: {
        id: target.id,
        isSystemAdmin: privilege.isSystemAdmin,
        hasSensitiveAuthority: privilege.sensitiveKeys.length > 0 || privilege.isPrivileged,
        active: target.active,
      },
    })
    if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

    const updated = await prisma.$transaction(async (tx) => {
      // Kunci diambil SEBELUM menulis agar dua penonaktifan bersamaan tidak
      // dapat sama-sama melihat populasi yang masih aman.
      if (intent === "deactivate") await lockSystemAdminPopulation(tx)

      const before = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { active: true },
      })

      const result = await tx.user.update({
        where: { id: userId },
        data: {
          ...(body.password !== undefined
            ? { passwordHash: await hash(body.password, 12) }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
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
            body.password !== undefined
              ? "RBAC_ACCOUNT_CREDENTIAL_CHANGED"
              : "RBAC_ACCOUNT_STATUS_CHANGED",
          entity: "UserAuthority",
          entityId: userId,
          targetUserId: userId,
          // Sandi tidak pernah masuk jejak audit, dalam bentuk apa pun.
          before: { active: before.active },
          after: { active: result.active },
          summary:
            body.password !== undefined
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
    verifySameOrigin(request)

    const { userId } = await context.params
    const body = accountDeletion.parse(await request.json())

    await requirePermission("accounts.delete")
    const authorization = await getAuthorizationContext()
    const actor = authorization.user

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
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
      },
    })
    if (!target) throw new ApiError(404, "Akun tidak ditemukan")

    // Konfirmasi diverifikasi sebelum pemeriksaan mahal apa pun.
    const confirmation = body.confirmationIdentifier.toLowerCase()
    if (confirmation !== target.nip?.toLowerCase() && confirmation !== target.email?.toLowerCase()) {
      throw new ApiError(400, "Konfirmasi NIP/email tidak sesuai")
    }

    const privilege = resolveAccountTargetPrivilege({
      roles: target.rbacRoles.map((assignment) => ({
        key: assignment.role.key,
        isProtected: assignment.role.isProtected,
        permissionKeys: assignment.role.permissions.map((entry) => entry.permission.key),
      })),
    })

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
    if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

    const [attendanceDays, violationPoints] = await Promise.all([
      prisma.attendanceDay.count({ where: { submittedById: userId } }),
      prisma.studentViolationPoint.count({ where: { recordedById: userId } }),
    ])

    const plan = planAccountDeletion({
      actorId: actor.id,
      targetId: userId,
      attendanceDays,
      violationPoints,
    })

    if (plan.blocked) {
      return NextResponse.json(
        { error: plan.message, reason: plan.reason },
        { status: plan.reason === "self_delete" ? 403 : 409 },
      )
    }

    const outcome = await prisma.$transaction(async (tx) => {
      // Kunci diambil sebelum menulis: menghapus seorang admin dapat
      // mengosongkan populasi, sama berbahayanya dengan menonaktifkannya.
      await lockSystemAdminPopulation(tx)

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

      return { reassignedAttendanceDays: reassigned.count }
    })

    return NextResponse.json({ id: userId, ...outcome })
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
