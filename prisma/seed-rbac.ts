/**
 * Penyemaian katalog permission dan role bawaan.
 *
 * Dipanggil `prisma/seed.ts`, yang dijalankan migrator pada setiap deploy —
 * karena itu seluruh operasi di sini WAJIB idempoten dan tidak merusak.
 *
 * Yang dilakukan:
 *   - menyisipkan/menyegarkan metadata deskriptif katalog permission;
 *   - membuat role bawaan yang belum ada beserta isi awalnya.
 *
 * Yang sengaja TIDAK dilakukan:
 *   - menghapus permission yang tidak lagi ada di registry (baris tersebut bisa
 *     masih tertaut role; pembersihannya butuh keputusan sadar, bukan efek
 *     samping deploy);
 *   - menimpa isi role yang sudah ada (admin boleh menyesuaikannya lewat UI,
 *     dan penyesuaian itu tidak boleh dikembalikan diam-diam setiap deploy);
 *   - memberikan role kepada user mana pun (backfill adalah pekerjaan Phase 3).
 */

import { PERMISSIONS } from "../lib/rbac-permissions"
import { ROLE_TEMPLATES } from "../lib/rbac-templates"

/// Bentuk minimal klien Prisma yang dibutuhkan, supaya modul ini bisa dipakai
/// seed maupun skrip lain tanpa mengikat satu instance tertentu.
type RbacSeedClient = {
  permission: {
    upsert(args: unknown): Promise<{ id: string; key: string }>
    findMany(args: unknown): Promise<{ id: string; key: string }[]>
  }
  role: {
    findUnique(args: unknown): Promise<{ id: string } | null>
    create(args: unknown): Promise<{ id: string }>
  }
  rolePermission: {
    createMany(args: unknown): Promise<unknown>
  }
}

export type RbacSeedResult = {
  readonly permissionsUpserted: number
  readonly rolesCreated: readonly string[]
  readonly rolesUntouched: readonly string[]
}

export async function seedRbac(prisma: RbacSeedClient): Promise<RbacSeedResult> {
  // 1. Katalog permission. Key adalah identitas stabil; metadata deskriptif
  //    (label/description/module) boleh menyusul perubahan kode.
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: {
        resource: permission.resource,
        action: permission.action,
        scope: permission.scope ?? null,
        label: permission.label,
        description: permission.description ?? null,
        module: permission.module,
      },
      create: {
        key: permission.key,
        resource: permission.resource,
        action: permission.action,
        scope: permission.scope ?? null,
        label: permission.label,
        description: permission.description ?? null,
        module: permission.module,
      },
    })
  }

  const permissionRows = await prisma.permission.findMany({ select: { id: true, key: true } })
  const permissionIdByKey = new Map(permissionRows.map((row) => [row.key, row.id]))

  // 2. Role bawaan. Hanya dibuat bila belum ada.
  const rolesCreated: string[] = []
  const rolesUntouched: string[] = []

  for (const template of ROLE_TEMPLATES) {
    const existing = await prisma.role.findUnique({
      where: { key: template.key },
      select: { id: true },
    })

    if (existing) {
      rolesUntouched.push(template.key)
      continue
    }

    const created = await prisma.role.create({
      data: {
        key: template.key,
        name: template.name,
        description: template.description,
        isSystem: template.isSystem,
        isProtected: template.isProtected,
      },
      select: { id: true },
    })

    const links = template.permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: created.id, permissionId }))

    if (links.length > 0) {
      await prisma.rolePermission.createMany({ data: links, skipDuplicates: true })
    }

    rolesCreated.push(template.key)
  }

  return {
    permissionsUpserted: PERMISSIONS.length,
    rolesCreated,
    rolesUntouched,
  }
}
