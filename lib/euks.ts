/** Pure E-UKS logic — no Prisma imports so it stays unit-testable. */

/** The two E-UKS rights. Each maps to one boolean column on User. */
export type EuksPermission = "euks.view" | "euks.edit"

export type EuksUserRights = {
  role: "ADMIN" | "GURU"
  canViewEuks?: boolean
  canEditEuks?: boolean
}

/** Permission -> the User column that grants it. */
export const euksPermissionColumns = {
  "euks.view": "canViewEuks",
  "euks.edit": "canEditEuks",
} as const satisfies Record<EuksPermission, keyof EuksUserRights>

export const euksPermissionLabels: Record<EuksPermission, string> = {
  "euks.view": "Lihat E-UKS",
  "euks.edit": "Kelola E-UKS",
}

/**
 * Single source of truth for E-UKS authorization. ADMIN always passes.
 * euks.edit implies euks.view — a petugas who records visits must be able to
 * open the module, so the two rights can never drift out of sync.
 */
export function hasEuksPermission(user: EuksUserRights, permission: EuksPermission): boolean {
  if (user.role === "ADMIN") return true
  if (user[euksPermissionColumns[permission]] === true) return true
  if (permission !== "euks.view") return false
  return user.canEditEuks === true
}

/** Convenience wrapper used by the nav filter and the page guards. */
export function canViewEuks(user: EuksUserRights): boolean {
  return hasEuksPermission(user, "euks.view")
}

/** Every right the viewer holds, for handing capabilities down to the client. */
export function euksCapabilities(user: EuksUserRights) {
  return {
    canView: hasEuksPermission(user, "euks.view"),
    canEdit: hasEuksPermission(user, "euks.edit"),
  }
}

export type EuksCapabilities = ReturnType<typeof euksCapabilities>
