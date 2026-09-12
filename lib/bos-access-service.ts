export const BOS_BUNDLE_PERMISSION_SETS = {
  legacy_bos_view: ["bos.read"],
  legacy_bos_create: ["bos.read", "bos.entries.create", "bos.categories.create"],
  legacy_bos_edit: ["bos.read", "bos.entries.update", "bos.budget.update"],
  legacy_bos_categories: ["bos.read", "bos.categories.update"],
  legacy_bos_access: ["bos.read", "bos.access.manage"],
} as const

export type BosBundleKey = keyof typeof BOS_BUNDLE_PERMISSION_SETS

export type BosBundleStore = {
  findBundleRole(key: string): Promise<{ id: string; key: string; permissionKeys: string[] } | null>
  findTarget(userId: string): Promise<{ id: string; hasProtectedRole: boolean } | null>
  hasMembership(userId: string, roleId: string): Promise<boolean>
  createMembership(userId: string, roleId: string): Promise<void>
  deleteMembership(userId: string, roleId: string): Promise<void>
}

export class BosBundleAssignmentError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "BosBundleAssignmentError"
  }
}

export type BosBundleAssignment = {
  userId: string
  bundleKey: string
  assigned: boolean
}

function sameSet(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((key) => expected.includes(key))
}

export async function assignBosBundle(store: BosBundleStore, input: BosBundleAssignment) {
  const expected = BOS_BUNDLE_PERMISSION_SETS[input.bundleKey as BosBundleKey]
  if (!expected) throw new BosBundleAssignmentError(400, "Bundle BOS tidak diizinkan")

  const [role, target] = await Promise.all([
    store.findBundleRole(input.bundleKey),
    store.findTarget(input.userId),
  ])
  if (!target) throw new BosBundleAssignmentError(404, "Pengguna tidak ditemukan")
  if (target.hasProtectedRole) {
    throw new BosBundleAssignmentError(403, "Akses pengguna dengan role terlindungi tidak dapat diubah")
  }
  if (!role || role.key !== input.bundleKey) {
    throw new BosBundleAssignmentError(409, "Bundle BOS tidak tersedia")
  }
  if (!sameSet(role.permissionKeys, expected)) {
    throw new BosBundleAssignmentError(409, "Bundle BOS terkontaminasi")
  }

  const assigned = await store.hasMembership(target.id, role.id)
  if (input.assigned && !assigned) await store.createMembership(target.id, role.id)
  if (!input.assigned && assigned) await store.deleteMembership(target.id, role.id)

  return { userId: target.id, bundleKey: input.bundleKey as BosBundleKey, assigned: input.assigned }
}
