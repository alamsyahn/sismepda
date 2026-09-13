/**
 * Administrasi role RBAC.
 *
 * Aturan dijalankan `lib/rbac-role-service.ts`; handler ini hanya
 * memverifikasi origin, mengotorisasi pemanggil, memvalidasi bentuk payload,
 * lalu menjalankan service di dalam satu transaksi bersama baris auditnya.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { prisma } from "@/lib/prisma"
import { getAuthorizationContext, requirePermission } from "@/lib/rbac-access"
import { createRole, RoleMutationError, type ServiceActor } from "@/lib/rbac-role-service"
import { createRoleStore } from "@/lib/rbac-stores"
import { verifySameOrigin } from "@/lib/same-origin"

/**
 * `.strict()` di seluruh payload RBAC: field asing menggagalkan permintaan
 * alih-alih dibuang diam-diam. Lihat lib/account-schemas.ts untuk alasannya.
 */
const createPayload = z
  .object({
    key: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    permissionKeys: z.array(z.string().min(1)).max(500).default([]),
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

/** Daftar role beserta jumlah anggota dan penanda sistem. */
export async function GET() {
  try {
    await requirePermission("rbac.roles.read")

    const roles = await prisma.role.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isProtected: true,
        version: true,
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
      orderBy: [{ isProtected: "desc" }, { name: "asc" }],
    })

    return NextResponse.json({
      roles: roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        isProtected: role.isProtected,
        version: role.version,
        memberCount: role._count.users,
        permissionKeys: role.permissions.map((entry) => entry.permission.key),
      })),
    })
  } catch (error) {
    return authFailureResponse(error, "Daftar role gagal dimuat")
  }
}

export async function POST(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    await requirePermission("rbac.roles.manage")
    const actor = await serviceActor()
    const body = createPayload.parse(await request.json())

    const role = await prisma.$transaction(async (tx) =>
      createRole(createRoleStore(tx, actor.id), {
        actor,
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        permissionKeys: body.permissionKeys,
      }),
    )

    return NextResponse.json(
      {
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        version: role.version,
        permissionKeys: role.permissionKeys,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof RoleMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Data role tidak valid" }, { status: 400 })
    }
    return authFailureResponse(error, "Role gagal dibuat")
  }
}
