/**
 * Mutasi satu role: ubah profil, ubah permission, hapus.
 *
 * Setiap mutasi menuntut `expectedVersion` sehingga penulisan di atas data
 * basi tertolak 409, bukan menimpa perubahan orang lain diam-diam.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { getAuthorizationContext, requirePermission } from "@/lib/rbac-access"
import {
  deleteRole,
  RoleMutationError,
  updateRolePermissions,
  updateRoleProfile,
  type ServiceActor,
} from "@/lib/rbac-role-service"
import { createRoleStore } from "@/lib/rbac-stores"
import { verifySameOrigin } from "@/lib/same-origin"

const patchPayload = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    permissionKeys: z.array(z.string().min(1)).max(500).optional(),
  })
  .strict()

const deletePayload = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    /** Niat eksplisit mencabut role dari seluruh anggotanya. */
    revokeFromAllMembers: z.boolean().optional(),
  })
  .strict()

async function serviceActor(): Promise<ServiceActor> {
  const context = await getAuthorizationContext()
  return {
    id: context.user.id,
    isSystemAdmin: context.isSystemAdmin,
    grants: context.grants,
  }
}

function failure(error: unknown, fallback: string) {
  if (error instanceof RoleMutationError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.memberCount === undefined ? {} : { memberCount: error.memberCount }),
      },
      { status: error.status },
    )
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Data role tidak valid" }, { status: 400 })
  }
  return authFailureResponse(error, fallback)
}

export async function PATCH(request: Request, context: { params: Promise<{ roleId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    await requirePermission("rbac.roles.manage")
    const actor = await serviceActor()
    const { roleId } = await context.params
    const body = patchPayload.parse(await request.json())

    const role = await prisma.$transaction(async (tx) => {
      const store = createRoleStore(tx, actor.id)

      // Profil dan permission adalah dua kepedulian berbeda, tetapi keduanya
      // dijalankan dalam SATU transaksi sehingga permintaan tidak pernah
      // separuh tersimpan.
      let current = null
      if (body.name !== undefined || body.description !== undefined) {
        // Service menuntut kedua field: perubahan parsial diisi dari nilai
        // yang tersimpan, sehingga mengirim `name` saja tidak menghapus
        // deskripsi yang sudah ada.
        const existing = await store.findRoleById(roleId)
        if (!existing) {
          throw new RoleMutationError(404, "Role tidak ditemukan.")
        }

        current = await updateRoleProfile(store, {
          actor,
          roleId,
          expectedVersion: body.expectedVersion,
          name: body.name ?? existing.name,
          description: body.description === undefined ? existing.description : body.description,
        })
      }

      if (body.permissionKeys !== undefined) {
        // Versi sudah naik bila profil ikut berubah; pakai nilai terkini.
        const expected = current ? current.version : body.expectedVersion
        current = await updateRolePermissions(store, {
          actor,
          roleId,
          expectedVersion: expected,
          permissionKeys: body.permissionKeys,
        })
      }

      if (!current) {
        throw new RoleMutationError(400, "Tidak ada perubahan yang diminta.")
      }
      return current
    })

    return NextResponse.json({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      version: role.version,
      permissionKeys: role.permissionKeys,
    })
  } catch (error) {
    return failure(error, "Role gagal diperbarui")
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ roleId: string }> }) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    await requirePermission("rbac.roles.manage")
    const actor = await serviceActor()
    const { roleId } = await context.params
    const body = deletePayload.parse(await request.json())

    const result = await prisma.$transaction(async (tx) =>
      deleteRole(createRoleStore(tx, actor.id), {
        actor,
        roleId,
        expectedVersion: body.expectedVersion,
        revokeFromAllMembers: body.revokeFromAllMembers,
      }),
    )

    return NextResponse.json({ success: true, revokedMemberCount: result.revokedMemberCount })
  } catch (error) {
    return failure(error, "Role gagal dihapus")
  }
}
