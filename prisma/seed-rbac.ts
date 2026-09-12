/**
 * Penyemaian katalog permission, role bawaan, dan bundle kompatibilitas.
 *
 * Dipanggil `prisma/seed.ts`, yang dijalankan migrator pada setiap deploy —
 * karena itu seluruh operasi di sini WAJIB idempoten dan tidak merusak.
 *
 * Yang dilakukan:
 *   - menyisipkan/menyegarkan metadata deskriptif katalog permission
 *     (label/description/module); key adalah identitas stabil;
 *   - membuat role bawaan (template) dan bundle kompatibilitas legacy yang
 *     BELUM ADA, beserta isi awalnya.
 *
 * Yang sengaja TIDAK dilakukan:
 *   - menghapus permission yang tidak lagi ada di registry;
 *   - menimpa RolePermission role yang sudah ada (admin boleh mencabut lewat
 *     UI; seed ulang tidak boleh mengembalikannya);
 *   - memberi permission baru rilis mendatang ke role kustom mana pun;
 *   - memberikan/mencabut role pada user;
 *   - menjalankan backfill legacy — itu tooling one-time terpisah
 *     (prisma/rbac-backfill-legacy.ts).
 */

import { COMPATIBILITY_BUNDLES } from "../lib/rbac-legacy"
import { PERMISSIONS } from "../lib/rbac-permissions"
import { ROLE_TEMPLATES } from "../lib/rbac-templates"

/// Bentuk minimal klien Prisma yang dibutuhkan, supaya modul ini bisa dipakai
/// seed maupun test tanpa mengikat satu instance tertentu.
export type RbacSeedClient = {
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

type RoleSeedSpec = {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly isSystem: boolean
  readonly isProtected: boolean
  readonly permissionKeys: readonly string[]
}

function roleSpecs(): readonly RoleSeedSpec[] {
  const templates: RoleSeedSpec[] = ROLE_TEMPLATES.map((template) => ({ ...template }))
  const bundles: RoleSeedSpec[] = COMPATIBILITY_BUNDLES.map((bundle) => ({
    key: bundle.key,
    name: bundle.name,
    description: bundle.description,
    // Bundle kompatibilitas bukan role sistem: admin boleh mengubah atau
    // menghapusnya setelah cutover, dan seed tidak akan memulihkannya.
    isSystem: false,
    isProtected: false,
    permissionKeys: bundle.permissionKeys,
  }))
  return [...templates, ...bundles]
}

export async function seedRbac(prisma: RbacSeedClient): Promise<RbacSeedResult> {
  // 1. Katalog permission.
  for (const permission of PERMISSIONS) {
    const data = {
      resource: permission.resource,
      action: permission.action,
      scope: permission.scope ?? null,
      label: permission.label,
      description: permission.description ?? null,
      module: permission.module,
    }
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: data,
      create: { key: permission.key, ...data },
    })
  }

  const permissionRows = await prisma.permission.findMany({ select: { id: true, key: true } })
  const permissionIdByKey = new Map(permissionRows.map((row) => [row.key, row.id]))

  // 2. Role bawaan + bundle kompatibilitas. Hanya dibuat bila belum ada.
  const rolesCreated: string[] = []
  const rolesUntouched: string[] = []

  for (const spec of roleSpecs()) {
    const existing = await prisma.role.findUnique({
      where: { key: spec.key },
      select: { id: true },
    })

    if (existing) {
      rolesUntouched.push(spec.key)
      continue
    }

    const created = await prisma.role.create({
      data: {
        key: spec.key,
        name: spec.name,
        description: spec.description,
        isSystem: spec.isSystem,
        isProtected: spec.isProtected,
      },
      select: { id: true },
    })

    const links = spec.permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: created.id, permissionId }))

    if (links.length > 0) {
      await prisma.rolePermission.createMany({ data: links, skipDuplicates: true })
    }

    rolesCreated.push(spec.key)
  }

  return {
    permissionsUpserted: PERMISSIONS.length,
    rolesCreated,
    rolesUntouched,
  }
}
