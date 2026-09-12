/**
 * Backfill akses legacy → RBAC (one-time, terpisah dari seed).
 *
 * SERVER-ONLY (menerima klien Prisma). Tidak dipanggil seed, migrasi, build,
 * maupun startup aplikasi. CLI: prisma/rbac-backfill-legacy.ts.
 *
 * Kontrak:
 *   - default dry-run: tidak ada baris yang ditulis;
 *   - apply eksplisit, target database diverifikasi pemanggil (CLI);
 *   - marker `RbacMigration[LEGACY_BACKFILL_KEY]` = idempotency & readiness;
 *   - resumable: setiap akun yang selesai dicatat di RbacMigrationItem, dan
 *     percobaan ulang sebelum COMPLETED melewati akun yang sudah dicatat;
 *   - COMPLETED ditulis HANYA setelah paritas pasca-tulis lulus;
 *   - setelah COMPLETED, apply ulang menolak — grant yang dicabut admin tidak
 *     pernah dipulihkan;
 *   - kegagalan di tengah → status FAILED, readiness tetap not-ready;
 *   - tidak pernah menyentuh password, active, identitas, relasi bisnis.
 */

import {
  LEGACY_BACKFILL_KEY,
  LEGACY_CAPABILITY_FLAGS,
  LEGACY_MAPPING_VERSION,
  UnknownLegacyCapabilityError,
  compareParity,
  findUnmappedCapabilityColumns,
  planLegacyUser,
  subjectFromPlan,
  type LegacyUser,
  type LegacyUserPlan,
  type ParityReport,
} from "@/lib/rbac-legacy"
import type { AuthorizationSubject } from "@/lib/rbac"

/**
 * Permukaan klien yang dibutuhkan. Tipe kembalian sengaja `any` karena bentuk
 * hasil Prisma bergantung pada `select` per panggilan dan tidak bisa
 * diekspresikan struktural tanpa menyalin generics Prisma; setiap hasil
 * dipersempit eksplisit di tempat pemakaian (lihat `toLegacyUser`, dsb.).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type BackfillClient = {
  user: {
    findMany(args: any): Promise<any[]>
    update(args: any): Promise<unknown>
    count(args?: any): Promise<number>
  }
  role: { findMany(args: any): Promise<any[]> }
  userRole: {
    findMany(args: any): Promise<any[]>
    createMany(args: any): Promise<unknown>
  }
  schoolSetting: { findUnique(args: any): Promise<any> }
  rbacMigration: {
    findUnique(args: any): Promise<any>
    upsert(args: any): Promise<unknown>
    update(args: any): Promise<unknown>
  }
  rbacMigrationItem: {
    findMany(args: any): Promise<any[]>
    createMany(args: any): Promise<unknown>
  }
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<any>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type MembershipRow = {
  userId: string
  role: { key: string; permissions: Array<{ permission: { key: string } }> }
}

export type BackfillMode = "dry-run" | "apply"

export type BackfillResult = {
  readonly mode: BackfillMode
  readonly mappingVersion: number
  readonly usersTotal: number
  readonly usersAlreadyDone: number
  readonly usersPlanned: number
  readonly usersWritten: number
  readonly membershipsWritten: number
  readonly parity: ParityReport
  readonly status: "dry-run" | "completed" | "already-completed"
}

export class BackfillAlreadyCompletedError extends Error {
  constructor() {
    super(
      `Backfill ${LEGACY_BACKFILL_KEY} sudah COMPLETED. Apply ulang ditolak agar grant yang dicabut admin tidak dipulihkan. ` +
        `Perubahan akses selanjutnya dilakukan lewat pengelolaan role, bukan backfill.`,
    )
    this.name = "BackfillAlreadyCompletedError"
  }
}

export class BackfillParityError extends Error {
  constructor(readonly parity: ParityReport) {
    super(
      `Paritas gagal: LOST=${parity.lost.length} GAINED=${parity.gained.length}. Marker tidak ditulis COMPLETED.`,
    )
    this.name = "BackfillParityError"
  }
}

const LEGACY_SELECT = {
  id: true,
  role: true,
  active: true,
  ...Object.fromEntries(LEGACY_CAPABILITY_FLAGS.map((flag) => [flag, true])),
} as const

export async function runLegacyBackfill(
  prisma: BackfillClient,
  options: { readonly mode: BackfillMode; readonly userTableName?: string },
): Promise<BackfillResult> {
  const mode = options.mode

  // 0. Marker: COMPLETED → tolak apply; dry-run boleh tetap melapor.
  const marker: { key: string; status: "RUNNING" | "FAILED" | "COMPLETED" } | null =
    await prisma.rbacMigration.findUnique({
      where: { key: LEGACY_BACKFILL_KEY },
      select: { key: true, status: true },
    })
  if (marker?.status === "COMPLETED" && mode === "apply") {
    throw new BackfillAlreadyCompletedError()
  }

  // 1. Kolom kapabilitas tak dikenal → abort sebelum apa pun ditulis.
  const columns: Array<{ column_name: string }> = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND data_type = 'boolean'`,
    options.userTableName ?? "User",
  )
  const unmapped = findUnmappedCapabilityColumns(columns.map((row) => row.column_name))
  if (unmapped.length > 0) {
    throw new UnknownLegacyCapabilityError("(schema)", unmapped.join(", "))
  }

  // 2. Baca akun legacy + setelan global. Password tidak pernah dipilih.
  const rows: Array<Record<string, unknown>> = await prisma.user.findMany({
    select: LEGACY_SELECT,
    orderBy: { id: "asc" },
  })
  const users = rows.map(toLegacyUser)
  const setting: { allowTeachersAccessAllClasses: boolean } | null = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { allowTeachersAccessAllClasses: true },
  })
  const context = { allowTeachersAccessAllClasses: setting?.allowTeachersAccessAllClasses ?? false }

  // 3. Rencana untuk setiap akun (melempar bila ada kapabilitas tak dikenal).
  const plans = new Map<string, LegacyUserPlan>()
  for (const user of users) plans.set(user.id, planLegacyUser(user))

  // 4. Paritas pra-tulis dari rencana murni.
  const planned = users.map((legacy) => ({ legacy, subject: subjectFromPlan(plans.get(legacy.id)!) }))
  const preParity = compareParity(planned, context)

  const doneRows: Array<{ userId: string }> = marker
    ? await prisma.rbacMigrationItem.findMany({
        where: { migrationKey: LEGACY_BACKFILL_KEY },
        select: { userId: true },
      })
    : []
  const done = new Set(doneRows.map((row) => row.userId))
  const pending = users.filter((user) => !done.has(user.id))

  if (mode === "dry-run") {
    return {
      mode,
      mappingVersion: LEGACY_MAPPING_VERSION,
      usersTotal: users.length,
      usersAlreadyDone: done.size,
      usersPlanned: pending.length,
      usersWritten: 0,
      membershipsWritten: 0,
      parity: preParity,
      status: marker?.status === "COMPLETED" ? "already-completed" : "dry-run",
    }
  }

  if (preParity.lost.length > 0 || preParity.gained.length > 0) {
    throw new BackfillParityError(preParity)
  }

  // 5. Apply.
  await prisma.rbacMigration.upsert({
    where: { key: LEGACY_BACKFILL_KEY },
    update: { status: "RUNNING", lastError: null },
    create: { key: LEGACY_BACKFILL_KEY, status: "RUNNING" },
  })

  const roleRows: Array<{ id: string; key: string }> = await prisma.role.findMany({ select: { id: true, key: true } })
  const roleIdByKey = new Map(roleRows.map((row) => [row.key, row.id]))

  let usersWritten = 0
  let membershipsWritten = 0
  try {
    for (const user of pending) {
      const plan = plans.get(user.id)!
      const memberships = plan.roleKeys.map((key) => {
        const roleId = roleIdByKey.get(key)
        if (!roleId) throw new Error(`Role ${key} belum di-seed; jalankan prisma db seed dahulu`)
        return { userId: user.id, roleId }
      })
      if (memberships.length > 0) {
        await prisma.userRole.createMany({ data: memberships, skipDuplicates: true })
        membershipsWritten += memberships.length
      }
      // Hanya isTeacher yang diubah pada User. Tidak ada kolom lain.
      await prisma.user.update({ where: { id: user.id }, data: { isTeacher: plan.isTeacher } })
      await prisma.rbacMigrationItem.createMany({
        data: [{ migrationKey: LEGACY_BACKFILL_KEY, userId: user.id }],
        skipDuplicates: true,
      })
      usersWritten += 1
    }

    // 6. Paritas pasca-tulis dari DATABASE (bukan rencana).
    const postParity = await parityFromDatabase(prisma, users, context)
    if (postParity.lost.length > 0 || postParity.gained.length > 0) {
      throw new BackfillParityError(postParity)
    }

    await prisma.rbacMigration.update({
      where: { key: LEGACY_BACKFILL_KEY },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        lastError: null,
        report: {
          mappingVersion: LEGACY_MAPPING_VERSION,
          usersTotal: users.length,
          usersWritten,
          membershipsWritten,
          intentionalDeltas: postParity.intentionalDeltas,
        },
      },
    })

    return {
      mode,
      mappingVersion: LEGACY_MAPPING_VERSION,
      usersTotal: users.length,
      usersAlreadyDone: done.size,
      usersPlanned: pending.length,
      usersWritten,
      membershipsWritten,
      parity: postParity,
      status: "completed",
    }
  } catch (error) {
    await prisma.rbacMigration.update({
      where: { key: LEGACY_BACKFILL_KEY },
      data: { status: "FAILED", lastError: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }
}

/// Paritas dari keanggotaan yang benar-benar tersimpan di database.
export async function parityFromDatabase(
  prisma: BackfillClient,
  users: readonly LegacyUser[],
  context: { allowTeachersAccessAllClasses: boolean },
): Promise<ParityReport> {
  const memberships: MembershipRow[] = await prisma.userRole.findMany({
    where: { userId: { in: users.map((user) => user.id) } },
    select: {
      userId: true,
      role: {
        select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
      },
    },
  })
  const teacherRows: Array<{ id: string; isTeacher: boolean }> = await prisma.user.findMany({
    where: { id: { in: users.map((user) => user.id) } },
    select: { id: true, isTeacher: true },
  })
  const isTeacherById = new Map(teacherRows.map((row) => [row.id, row.isTeacher]))

  const rolesByUser = new Map<string, AuthorizationSubject["roles"][number][]>()
  for (const membership of memberships) {
    const list = rolesByUser.get(membership.userId) ?? []
    list.push({
      id: `db:${membership.role.key}`,
      key: membership.role.key,
      name: membership.role.key,
      permissionKeys: membership.role.permissions.map((entry) => entry.permission.key),
    })
    rolesByUser.set(membership.userId, list)
  }

  return compareParity(
    users.map((legacy) => ({
      legacy,
      subject: {
        userId: legacy.id,
        roles: rolesByUser.get(legacy.id) ?? [],
        isTeacher: isTeacherById.get(legacy.id) ?? false,
      },
    })),
    context,
  )
}

function toLegacyUser(row: Record<string, unknown>): LegacyUser {
  const flags = Object.fromEntries(
    LEGACY_CAPABILITY_FLAGS.map((flag) => [flag, row[flag] === true]),
  ) as { [K in (typeof LEGACY_CAPABILITY_FLAGS)[number]]: boolean }
  return {
    id: String(row.id),
    role: row.role as LegacyUser["role"],
    active: row.active === true,
    ...flags,
  }
}
