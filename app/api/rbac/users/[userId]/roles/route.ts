/**
 * Penugasan role untuk satu pengguna.
 *
 * Titik paling sensitif di Phase 6: di sinilah keanggotaan Admin Sistem
 * berubah. Transaksi WAJIB mengambil kunci populasi lebih dulu, menulis, lalu
 * memverifikasi invariant — urutan itu yang membuat dua permintaan bersamaan
 * tidak dapat sama-sama menghapus admin terakhir.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { getAuthorizationContext, requirePermission } from "@/lib/rbac-access"
import {
  AssignmentError,
  computeAssignmentRevision,
  updateUserRoles,
  type ServiceActor,
} from "@/lib/rbac-assignment-service"
import {
  assertSystemAdminPopulationIntact,
  InvariantViolationError,
  lockSystemAdminPopulation,
} from "@/lib/rbac-invariants-db"
import { createAssignmentStore } from "@/lib/rbac-stores"
import { verifySameOrigin } from "@/lib/same-origin"

const payload = z
  .object({
    roleIds: z.array(z.string().min(1)).max(100),
    /** Sidik jari himpunan role yang dilihat operator saat membuka formulir. */
    expectedRevision: z.string().min(1).max(64),
    confirmSelfRevoke: z.boolean().optional(),
  })
  .strict()

export async function PUT(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    await requirePermission("rbac.assignments.manage")
    const authorization = await getAuthorizationContext()
    const actor: ServiceActor = {
      id: authorization.user.id,
      isSystemAdmin: authorization.isSystemAdmin,
      grants: authorization.grants,
    }

    const { userId } = await context.params
    const body = payload.parse(await request.json())

    const result = await prisma.$transaction(async (tx) => {
      // Kunci diambil SEBELUM membaca maupun menulis. Tanpa ini dua transaksi
      // dapat sama-sama membaca "masih ada 2 admin" lalu masing-masing
      // menghapus satu, menyisakan nol.
      await lockSystemAdminPopulation(tx)

      const outcome = await updateUserRoles(createAssignmentStore(tx, actor.id), {
        actor,
        userId,
        roleIds: body.roleIds,
        expectedRevision: body.expectedRevision,
        confirmSelfRevoke: body.confirmSelfRevoke,
      })

      // Diverifikasi setelah penulisan: yang dinilai adalah kondisi AKHIR
      // transaksi, bukan kondisi saat permintaan masuk.
      await assertSystemAdminPopulationIntact(tx, { actorId: actor.id, targetId: userId })
      return outcome
    })

    return NextResponse.json({
      added: result.added,
      removed: result.removed,
      revision: result.revision,
    })
  } catch (error) {
    if (error instanceof AssignmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof InvariantViolationError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data penugasan tidak valid" }, { status: 400 })
    }
    return authFailureResponse(error, "Penugasan role gagal disimpan")
  }
}

/** Keanggotaan role terkini beserta revisinya, untuk mengisi formulir. */
export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    await requirePermission("rbac.assignments.manage")
    const { userId } = await context.params

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        active: true,
        rbacRoles: { select: { role: { select: { id: true, key: true, name: true } } } },
      },
    })
    if (!user) {
      return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 })
    }

    const roles = user.rbacRoles.map((entry) => entry.role)
    return NextResponse.json({
      userId: user.id,
      name: user.name,
      active: user.active,
      roles,
      revision: computeAssignmentRevision(roles.map((role) => role.id)),
    })
  } catch (error) {
    return authFailureResponse(error, "Data penugasan gagal dimuat")
  }
}
