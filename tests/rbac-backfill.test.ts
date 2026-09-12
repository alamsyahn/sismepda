import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  BackfillAlreadyCompletedError,
  BackfillParityError,
  runLegacyBackfill,
  type BackfillClient,
} from "../lib/rbac-backfill"
import {
  LEGACY_BACKFILL_KEY,
  COMPATIBILITY_BUNDLES,
  LEGACY_CAPABILITY_FLAGS,
  UnknownLegacyCapabilityError,
  compareParity,
  findUnmappedCapabilityColumns,
  legacyEffectiveDecisions,
  planLegacyUser,
  subjectFromPlan,
  type LegacyUser,
} from "../lib/rbac-legacy"
import { evaluateReadiness } from "../lib/rbac-readiness"
import { ROLE_TEMPLATES, getRoleTemplate } from "../lib/rbac-templates"
import { PERMISSION_KEYS, SYSTEM_ADMIN_ROLE_KEY } from "../lib/rbac-permissions"
import { hasPermission } from "../lib/rbac"

// ---------------------------------------------------------------------------
// Fixture: Prisma tiruan in-memory yang menyimpan tabel-tabel yang disentuh
// backfill. Tidak ada koneksi database, tidak ada produksi.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

type LegacyInput = Partial<LegacyUser> & { id: string; role: "ADMIN" | "GURU"; workbookSupervised?: boolean }

function legacy(partial: LegacyInput): LegacyUser & { workbookSupervised?: boolean } {
  const flags = Object.fromEntries(LEGACY_CAPABILITY_FLAGS.map((flag) => [flag, false])) as Record<
    (typeof LEGACY_CAPABILITY_FLAGS)[number],
    boolean
  >
  return { active: true, ...flags, ...partial }
}

function makeFixture(options: {
  users: Array<LegacyUser & { passwordHash?: string; homeroomOf?: string }>
  allowAll?: boolean
  extraBooleanColumns?: string[]
  failAfterUsers?: number
}) {
  const users: Row[] = options.users.map((user) => ({
    passwordHash: "hash-" + user.id,
    isTeacher: false,
    ...user,
  }))
  const roles: Array<{ id: string; key: string; permissionKeys: string[] }> = [
    ...ROLE_TEMPLATES,
    ...COMPATIBILITY_BUNDLES,
  ].map((t) => ({ id: "role_" + t.key, key: t.key, permissionKeys: [...t.permissionKeys] }))
  const userRoles: Array<{ userId: string; roleId: string }> = []
  let migration: Row | null = null
  const items: Array<{ migrationKey: string; userId: string }> = []
  let writes = 0
  let userUpdates = 0

  const columns = ["active", ...LEGACY_CAPABILITY_FLAGS, "isTeacher", ...(options.extraBooleanColumns ?? [])]

  const client: BackfillClient = {
    user: {
      async findMany(args: { where?: { id?: { in: string[] } }; select?: Row }) {
        const list = args?.where?.id?.in ? users.filter((u) => args.where!.id!.in.includes(u.id as string)) : users
        return list.map((u) => {
          if (!args?.select) return { ...u }
          const out: Row = {}
          for (const key of Object.keys(args.select)) out[key] = u[key]
          return out
        })
      },
      async update(args: { where: { id: string }; data: Row }) {
        writes += 1
        userUpdates += 1
        const u = users.find((row) => row.id === args.where.id)!
        assert.deepEqual(Object.keys(args.data), ["isTeacher"], "backfill hanya boleh mengubah isTeacher")
        Object.assign(u, args.data)
        if (options.failAfterUsers !== undefined && userUpdates > options.failAfterUsers) {
          throw new Error("simulated failure halfway")
        }
        return u
      },
      async count() {
        return users.length
      },
    },
    role: { async findMany() { return roles.map((r) => ({ id: r.id, key: r.key })) } },
    userRole: {
      async findMany(args: { where: { userId: { in: string[] } } }) {
        return userRoles
          .filter((ur) => args.where.userId.in.includes(ur.userId))
          .map((ur) => {
            const role = roles.find((r) => r.id === ur.roleId)!
            return {
              userId: ur.userId,
              role: { key: role.key, permissions: role.permissionKeys.map((key) => ({ permission: { key } })) },
            }
          })
      },
      async createMany(args: { data: Array<{ userId: string; roleId: string }> }) {
        writes += 1
        for (const row of args.data) {
          if (!userRoles.some((ur) => ur.userId === row.userId && ur.roleId === row.roleId)) userRoles.push(row)
        }
        return { count: args.data.length }
      },
    },
    schoolSetting: { async findUnique() { return { allowTeachersAccessAllClasses: options.allowAll ?? false } } },
    rbacMigration: {
      async findUnique() { return migration ? { key: migration.key, status: migration.status } : null },
      async upsert(args: { update: Row; create: Row }) {
        writes += 1
        migration = migration ? { ...migration, ...args.update } : { ...args.create }
        return migration
      },
      async update(args: { data: Row }) {
        writes += 1
        migration = { ...(migration ?? {}), ...args.data }
        return migration
      },
    },
    rbacMigrationItem: {
      async findMany() { return items.map((i) => ({ userId: i.userId })) },
      async createMany(args: { data: Array<{ migrationKey: string; userId: string }> }) {
        writes += 1
        for (const row of args.data) if (!items.some((i) => i.userId === row.userId)) items.push(row)
        return { count: args.data.length }
      },
    },
    async $queryRawUnsafe() { return columns.map((column_name) => ({ column_name })) },
  }

  return {
    client,
    state: { users, roles, userRoles, items, get migration() { return migration }, get writes() { return writes } },
    revoke(userId: string, roleKey: string) {
      const role = roles.find((r) => r.key === roleKey)!
      const idx = userRoles.findIndex((ur) => ur.userId === userId && ur.roleId === role.id)
      if (idx >= 0) userRoles.splice(idx, 1)
    },
    revokePermission(roleKey: string, permissionKey: string) {
      const role = roles.find((r) => r.key === roleKey)!
      role.permissionKeys = role.permissionKeys.filter((k) => k !== permissionKey)
    },
    snapshotUsers() { return JSON.stringify(users.map((u) => ({ id: u.id, passwordHash: u.passwordHash, active: u.active, role: u.role, homeroomOf: u.homeroomOf, workbookSupervised: u.workbookSupervised }))) },
  }
}

const admin = legacy({ id: "u_admin_1", role: "ADMIN" })
const admin2 = legacy({ id: "u_admin_2", role: "ADMIN", active: false })
const admin3 = legacy({ id: "u_admin_3", role: "ADMIN" })
const guru = legacy({ id: "u_guru", role: "GURU" })
const guruInactive = legacy({ id: "u_guru_off", role: "GURU", active: false, canViewBos: true })
const guruBos = legacy({ id: "u_guru_bos", role: "GURU", canViewBos: true, canManageBosCategories: true })
const guruCombo = legacy({
  id: "u_guru_combo",
  role: "GURU",
  canEditEuks: true,
  canEditSarpras: true,
  canSuperviseWorkbooks: true,
  canManageTeacherProfiles: true,
  workbookSupervised: true,
})

// ---------------------------------------------------------------------------
// A. Template
// ---------------------------------------------------------------------------

test("template: setiap role bawaan hanya memakai key registry", () => {
  for (const t of ROLE_TEMPLATES) {
    for (const key of t.permissionKeys) assert.ok(PERMISSION_KEYS.includes(key), `${t.key}: ${key}`)
    assert.equal(new Set(t.permissionKeys).size, t.permissionKeys.length, `${t.key}: duplikat`)
  }
  assert.equal(new Set(ROLE_TEMPLATES.map((t) => t.key)).size, ROLE_TEMPLATES.length)
})

test("template: Guru tidak otomatis BOS/Sarpras/E-UKS/supervisi/WhatsApp", () => {
  const guruT = getRoleTemplate("guru")!
  for (const key of guruT.permissionKeys) {
    assert.ok(!/^(bos|sarpras|euks|workbook\.supervision|reports\.whatsapp)\./.test(key), key)
  }
})

test("template: Pengawas & Kepala Sekolah tanpa write/export/health; Kepala Sekolah bukan bypass", () => {
  for (const roleKey of ["pengawas", "kepala_sekolah"]) {
    const t = getRoleTemplate(roleKey)!
    assert.equal(t.isProtected, false)
    for (const key of t.permissionKeys) {
      assert.ok(!/\.(create|update|delete|write|manage|export)/.test(key) && !key.startsWith("euks."), `${roleKey}: ${key}`)
    }
  }
  assert.ok(getRoleTemplate("kepala_sekolah")!.permissionKeys.includes("bos.read"))
  assert.ok(getRoleTemplate("pengawas")!.permissionKeys.includes("workbook.supervision.read"))
  assert.ok(!getRoleTemplate("pengawas")!.permissionKeys.includes("bos.read"))
})

test("template: Pengurus UKS/BOS/Sarpras tidak mendapat delete/config destruktif", () => {
  const uks = getRoleTemplate("pengurus_uks")!.permissionKeys
  assert.ok(uks.includes("euks.visits.write") && uks.includes("euks.complaint_options.read"))
  assert.ok(!uks.some((k) => k.endsWith(".manage")), "profil/pengurus/fasilitas/opsi keluhan bukan bawaan")
  const bos = getRoleTemplate("pengurus_bos")!.permissionKeys
  // bos.entries.create menutup POST /api/bos/categories di HEAD (hak bos.create yang sama).
  assert.deepEqual([...bos].sort(), ["bos.entries.create", "bos.entries.update", "bos.read"])
  assert.ok(!bos.includes("bos.access.manage") && !bos.includes("bos.budget.write"))
  const sarpras = getRoleTemplate("pengurus_sarpras")!.permissionKeys
  assert.ok(sarpras.includes("sarpras.photos.write") && !sarpras.includes("sarpras.access.manage"))
})

test("template: Siswa & Wali Murid tanpa grant sensitif; hanya system_admin yang protected", () => {
  assert.deepEqual(getRoleTemplate("siswa")!.permissionKeys, [])
  assert.deepEqual(getRoleTemplate("wali_murid")!.permissionKeys, [])
  assert.deepEqual(ROLE_TEMPLATES.filter((t) => t.isProtected).map((t) => t.key), [SYSTEM_ADMIN_ROLE_KEY])
})

// ---------------------------------------------------------------------------
// B. Mapping legacy
// ---------------------------------------------------------------------------

test("mapping: ADMIN → system_admin + legacy_guru, isTeacher=true; semua ADMIN, bukan satu", () => {
  for (const u of [admin, admin2, admin3]) {
    const plan = planLegacyUser(u)
    assert.ok(plan.roleKeys.includes(SYSTEM_ADMIN_ROLE_KEY), u.id)
    assert.ok(plan.roleKeys.includes("legacy_guru"), u.id)
    assert.equal(plan.isTeacher, true)
  }
})

test("mapping: GURU → legacy_guru saja, isTeacher=true", () => {
  const plan = planLegacyUser(guru)
  assert.deepEqual(plan.roleKeys, ["legacy_guru"])
  assert.equal(plan.isTeacher, true)
})

test("mapping: setiap flag legacy dipetakan ke bundle spesifiknya", () => {
  const expected: Record<string, string> = {
    canManageTeacherProfiles: "legacy_teacher_manager",
    canViewWorkbookSupervision: "legacy_workbook_viewer",
    canSuperviseWorkbooks: "legacy_workbook_supervisor",
    canViewBos: "legacy_bos_view",
    canCreateBos: "legacy_bos_create",
    canEditBos: "legacy_bos_edit",
    canManageBosCategories: "legacy_bos_categories",
    canManageBosAccess: "legacy_bos_access",
    canViewSarpras: "legacy_sarpras_view",
    canEditSarpras: "legacy_sarpras_edit",
    canViewEuks: "legacy_euks_view",
    canEditEuks: "legacy_euks_edit",
  }
  for (const [flag, bundle] of Object.entries(expected)) {
    const plan = planLegacyUser(legacy({ id: "x", role: "GURU", [flag]: true } as Partial<LegacyUser> & { id: string; role: "GURU" }))
    assert.deepEqual(plan.roleKeys, ["legacy_guru", bundle], flag)
  }
})

test("mapping: kombinasi flag menghasilkan gabungan bundle tanpa duplikat", () => {
  const plan = planLegacyUser(guruCombo)
  assert.deepEqual([...plan.roleKeys].sort(), [
    "legacy_euks_edit",
    "legacy_guru",
    "legacy_sarpras_edit",
    "legacy_teacher_manager",
    "legacy_workbook_supervisor",
  ])
  assert.equal(new Set(plan.roleKeys).size, plan.roleKeys.length)
})

test("mapping: pengecualian kategori BOS — canManageBosCategories tidak memberi categories.create", () => {
  const subject = subjectFromPlan(planLegacyUser(guruBos))
  assert.equal(hasPermission(subject, "bos.categories.manage"), true)
  assert.equal(hasPermission(subject, "bos.entries.create"), false, "pembuatan kategori = bos.create di HEAD, bukan manage")
  assert.equal(hasPermission(subject, "bos.read"), true)
})

test("mapping: WhatsApp school-wide & E-UKS school-wide adalah kompatibilitas eksplisit", () => {
  const g = subjectFromPlan(planLegacyUser(guru))
  assert.equal(hasPermission(g, "reports.whatsapp.read"), true, "HEAD: WA hanya requireUser")
  const e = subjectFromPlan(planLegacyUser(legacy({ id: "e", role: "GURU", canViewEuks: true })))
  assert.equal(hasPermission(e, "euks.visits.read"), true)
  assert.equal(hasPermission(e, "euks.profile.manage"), false)
  assert.equal(hasPermission(e, "euks.visits.write"), false)
  const ee = subjectFromPlan(planLegacyUser(legacy({ id: "ee", role: "GURU", canEditEuks: true })))
  assert.equal(hasPermission(ee, "euks.visits.write"), true)
  assert.equal(hasPermission(ee, "euks.profile.manage"), false)
  assert.equal(hasPermission(ee, "euks.complaint_options.manage"), false)
})

test("mapping: workbookSupervised tetap flag bisnis, tidak jadi grant", () => {
  const a = planLegacyUser(legacy({ id: "a", role: "GURU", workbookSupervised: true }))
  const b = planLegacyUser(legacy({ id: "b", role: "GURU", workbookSupervised: false }))
  assert.deepEqual(a.roleKeys, b.roleKeys)
})

test("mapping: kapabilitas legacy tak dikenal → abort, bukan admin", () => {
  assert.deepEqual(findUnmappedCapabilityColumns(["active", "canDoMystery", ...LEGACY_CAPABILITY_FLAGS]), ["canDoMystery"])
  assert.throws(
    () => planLegacyUser({ ...guru, role: "SUPER" as never }),
    (err: unknown) => err instanceof UnknownLegacyCapabilityError && /SUPER/.test((err as Error).message),
  )
})

// ---------------------------------------------------------------------------
// C. Paritas
// ---------------------------------------------------------------------------

test("paritas: seluruh kombinasi flag & role menghasilkan LOST=0 GAINED=0 pada dua setelan global", () => {
  const flags = LEGACY_CAPABILITY_FLAGS
  const users: LegacyUser[] = []
  for (const role of ["ADMIN", "GURU"] as const) {
    users.push(legacy({ id: `${role}_none`, role }))
    for (const flag of flags) users.push(legacy({ id: `${role}_${flag}`, role, [flag]: true } as Partial<LegacyUser> & { id: string; role: typeof role }))
    for (let i = 0; i < flags.length; i += 1) {
      for (let j = i + 1; j < flags.length; j += 1) {
        users.push(legacy({ id: `${role}_${flags[i]}_${flags[j]}`, role, [flags[i]]: true, [flags[j]]: true } as Partial<LegacyUser> & { id: string; role: typeof role }))
      }
    }
    users.push(legacy({ id: `${role}_all`, role, ...Object.fromEntries(flags.map((f) => [f, true])) } as Partial<LegacyUser> & { id: string; role: typeof role }))
  }
  for (const allowAll of [false, true]) {
    const report = compareParity(
      users.map((u) => ({ legacy: u, subject: subjectFromPlan(planLegacyUser(u)) })),
      { allowTeachersAccessAllClasses: allowAll },
    )
    assert.deepEqual(report.lost, [], `allowAll=${allowAll} LOST`)
    assert.deepEqual(report.gained, [], `allowAll=${allowAll} GAINED`)
    assert.equal(report.usersCompared, users.length)
    assert.ok(report.intentionalDeltas.length >= 3)
  }
})

test("paritas: melaporkan LOST dan GAINED dua arah", () => {
  const full = subjectFromPlan(planLegacyUser(guruBos))
  const stripped = { ...full, roles: full.roles.filter((r) => r.key !== "legacy_bos_view" && r.key !== "legacy_bos_categories") }
  const lostReport = compareParity([{ legacy: guruBos, subject: stripped }], { allowTeachersAccessAllClasses: false })
  assert.ok(lostReport.lost.some((d) => d.decision === "bos.read"))
  assert.deepEqual(lostReport.gained, [])

  const base = subjectFromPlan(planLegacyUser(guru))
  const widened = { ...base, roles: [...base.roles, { id: "extra", key: "custom", name: "custom", permissionKeys: ["sarpras.items.write"] }] }
  const gainedReport = compareParity([{ legacy: guru, subject: widened }], { allowTeachersAccessAllClasses: false })
  assert.ok(gainedReport.gained.some((d) => d.decision.startsWith("sarpras.items.write")))
  assert.deepEqual(gainedReport.lost, [])
})

test("paritas: setelan allowTeachersAccessAllClasses on/off dipertahankan untuk guru", () => {
  const off = legacyEffectiveDecisions(guru, { allowTeachersAccessAllClasses: false })
  const on = legacyEffectiveDecisions(guru, { allowTeachersAccessAllClasses: true })
  assert.ok(off.has("attendance.read@assigned_classes") && !off.has("attendance.read@all"))
  assert.ok(on.has("attendance.read@all"))
})

// ---------------------------------------------------------------------------
// D/E. Backfill tooling + readiness
// ---------------------------------------------------------------------------

test("backfill: dry-run tidak menulis satu baris pun", async () => {
  const fx = makeFixture({ users: [admin, guru, guruBos] })
  const before = fx.snapshotUsers()
  const result = await runLegacyBackfill(fx.client, { mode: "dry-run" })
  assert.equal(result.status, "dry-run")
  assert.equal(result.usersPlanned, 3)
  assert.equal(fx.state.writes, 0)
  assert.equal(fx.state.userRoles.length, 0)
  assert.equal(fx.state.migration, null)
  assert.equal(fx.snapshotUsers(), before)
  assert.equal(evaluateReadiness({ backfill: null, userCount: 3 }).state, "not-ready")
})

test("backfill: apply memetakan semua ADMIN, mempertahankan aktif/nonaktif, password, identitas, relasi", async () => {
  const fx = makeFixture({ users: [admin, admin2, admin3, guru, guruInactive, guruCombo] })
  const before = fx.snapshotUsers()
  const result = await runLegacyBackfill(fx.client, { mode: "apply" })
  assert.equal(result.status, "completed")
  assert.deepEqual(result.parity.lost, [])
  assert.deepEqual(result.parity.gained, [])
  assert.equal(fx.snapshotUsers(), before, "id/password/active/role/homeroom/workbookSupervised tidak berubah")

  const sysAdminId = fx.state.roles.find((r) => r.key === SYSTEM_ADMIN_ROLE_KEY)!.id
  const admins = fx.state.userRoles.filter((ur) => ur.roleId === sysAdminId).map((ur) => ur.userId).sort()
  assert.deepEqual(admins, ["u_admin_1", "u_admin_2", "u_admin_3"])

  const offUser = fx.state.users.find((u) => u.id === "u_guru_off")!
  assert.equal(offUser.active, false)
  assert.ok(fx.state.userRoles.some((ur) => ur.userId === "u_guru_off"), "akun nonaktif tetap dapat role potensial")
  for (const u of fx.state.users) assert.equal(u.isTeacher, true)

  assert.equal(evaluateReadiness({ backfill: fx.state.migration as never, userCount: fx.state.users.length }).state, "ready")
})

test("backfill: retry sebelum selesai hanya mengerjakan akun tersisa; gagal di tengah → readiness not-ready", async () => {
  const fx = makeFixture({ users: [admin, guru, guruBos, guruCombo], failAfterUsers: 2 })
  await assert.rejects(runLegacyBackfill(fx.client, { mode: "apply" }), /simulated failure/)
  assert.equal((fx.state.migration as Row).status, "FAILED")
  assert.equal(evaluateReadiness({ backfill: fx.state.migration as never, userCount: fx.state.users.length }).state, "not-ready")
  const doneBefore = fx.state.items.length
  assert.ok(doneBefore >= 2 && doneBefore < 4)

  const fx2 = fx // pakai state yang sama, hilangkan kegagalan
  ;(fx2 as unknown as { client: BackfillClient }).client = fx.client
  // hilangkan simulasi kegagalan dengan mengganti update user ke versi bersih
  const originalUpdate = fx.client.user.update
  fx.client.user.update = async (args: { where: { id: string }; data: Row }) => {
    const u = fx.state.users.find((row) => row.id === args.where.id)!
    Object.assign(u, args.data)
    return u
  }
  const result = await runLegacyBackfill(fx2.client, { mode: "apply" })
  fx.client.user.update = originalUpdate
  assert.equal(result.status, "completed")
  assert.equal(result.usersAlreadyDone, doneBefore)
  assert.equal(result.usersWritten, 4 - doneBefore)
  assert.equal(fx.state.items.length, 4)
  assert.equal(evaluateReadiness({ backfill: fx.state.migration as never, userCount: fx.state.users.length }).state, "ready")
})

test("backfill: setelah COMPLETED, apply ulang ditolak dan akses yang dicabut tidak dipulihkan", async () => {
  const fx = makeFixture({ users: [admin, guruBos] })
  await runLegacyBackfill(fx.client, { mode: "apply" })
  fx.revoke("u_guru_bos", "legacy_bos_view")
  const membershipsAfterRevoke = fx.state.userRoles.length
  await assert.rejects(runLegacyBackfill(fx.client, { mode: "apply" }), BackfillAlreadyCompletedError)
  assert.equal(fx.state.userRoles.length, membershipsAfterRevoke)
  const dry = await runLegacyBackfill(fx.client, { mode: "dry-run" })
  assert.equal(dry.status, "already-completed")
  assert.equal(dry.usersWritten, 0)
})

test("backfill: paritas gagal pasca-tulis → tidak COMPLETED", async () => {
  const fx = makeFixture({ users: [guruBos] })
  // Paritas pra-tulis dihitung dari katalog murni dan lulus; baris role di
  // database dirusak tepat saat penulisan pertama, sehingga hanya paritas
  // pasca-tulis (dari database) yang bisa menangkapnya.
  const originalCreateMany = fx.client.userRole.createMany
  fx.client.userRole.createMany = async (args) => {
    fx.revokePermission("legacy_bos_view", "bos.read")
    fx.revokePermission("legacy_bos_categories", "bos.read")
    return originalCreateMany(args)
  }
  await assert.rejects(runLegacyBackfill(fx.client, { mode: "apply" }), BackfillParityError)
  assert.equal((fx.state.migration as Row).status, "FAILED")
  assert.equal(evaluateReadiness({ backfill: fx.state.migration as never, userCount: fx.state.users.length }).state, "not-ready")
})

test("backfill: kolom kapabilitas boolean tak dikenal di schema → abort sebelum menulis", async () => {
  const fx = makeFixture({ users: [guru], extraBooleanColumns: ["canApproveBudget"] })
  await assert.rejects(runLegacyBackfill(fx.client, { mode: "apply" }), /canApproveBudget/)
  assert.equal(fx.state.writes, 0)
})


test("readiness: tanpa marker hanya database kosong yang ready; RUNNING/FAILED/marker asing bukan ready", () => {
  const key = LEGACY_BACKFILL_KEY
  assert.equal(evaluateReadiness({ backfill: null, userCount: 5 }).state, "not-ready")
  assert.equal(evaluateReadiness({ backfill: null, userCount: 0 }).state, "ready")
  assert.equal(evaluateReadiness({ backfill: { key, status: "RUNNING" }, userCount: 5 }).state, "not-ready")
  assert.equal(evaluateReadiness({ backfill: { key, status: "FAILED" }, userCount: 5 }).state, "not-ready")
  assert.equal(evaluateReadiness({ backfill: { key, status: "COMPLETED" }, userCount: 5 }).state, "ready")
  assert.equal(evaluateReadiness({ backfill: { key: "other", status: "COMPLETED" }, userCount: 5 }).state, "error")
})

// ---------------------------------------------------------------------------
// F. Seed behavior (fixture in-memory untuk seedRbac)
// ---------------------------------------------------------------------------

test("seed: rerun tidak mengembalikan permission yang dicabut admin dan tidak menyentuh akun", async () => {
  const { seedRbac } = await import("../prisma/seed-rbac")
  const perms: Array<Row> = []
  const roles: Array<Row> = []
  const rolePerms: Array<{ roleId: string; permissionId: string }> = []
  const users: Array<Row> = [{ id: "u1", passwordHash: "h", active: false }]
  const client = {
    permission: {
      async upsert(args: { where: { key: string }; create: Row; update: Row }) {
        const found = perms.find((p) => p.key === args.where.key)
        if (found) Object.assign(found, args.update)
        else perms.push({ id: "perm_" + args.where.key, ...args.create })
      },
      async findMany() { return perms.map((p) => ({ id: p.id, key: p.key })) },
    },
    role: {
      async findUnique(args: { where: { key: string } }) {
        const found = roles.find((r) => r.key === args.where.key)
        return found ? { id: found.id } : null
      },
      async create(args: { data: Row }) {
        const row = { id: "role_" + args.data.key, ...args.data }
        roles.push(row)
        return { id: row.id }
      },
    },
    rolePermission: {
      async createMany(args: { data: Array<{ roleId: string; permissionId: string }> }) {
        for (const d of args.data) if (!rolePerms.some((rp) => rp.roleId === d.roleId && rp.permissionId === d.permissionId)) rolePerms.push(d)
      },
    },
    user: { async update() { throw new Error("seed tidak boleh menyentuh User") } },
  }
  const first = await seedRbac(client as never)
  assert.ok(first.rolesCreated.length >= 9 + COMPATIBILITY_BUNDLES.length)
  const guruRoleId = roles.find((r) => r.key === "guru")!.id
  const before = rolePerms.filter((rp) => rp.roleId === guruRoleId).length
  const target = rolePerms.find((rp) => rp.roleId === guruRoleId)!
  rolePerms.splice(rolePerms.indexOf(target), 1)

  const second = await seedRbac(client as never)
  assert.equal(second.rolesCreated.length, 0)
  assert.equal(rolePerms.filter((rp) => rp.roleId === guruRoleId).length, before - 1, "permission yang dicabut tidak kembali")
  assert.deepEqual(users, [{ id: "u1", passwordHash: "h", active: false }], "password & active tidak berubah")
})
