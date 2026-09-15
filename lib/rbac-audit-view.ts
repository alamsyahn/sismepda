const ACTION_LABELS: Readonly<Record<string, string>> = {
  RBAC_ROLE_CREATED: "Role dibuat",
  RBAC_ROLE_UPDATED: "Role diperbarui",
  RBAC_ROLE_DELETED: "Role dihapus",
  RBAC_ROLE_PERMISSIONS_CHANGED: "Permission role diubah",
  RBAC_USER_ROLES_CHANGED: "Penugasan role diubah",
  RBAC_USER_ROLES_BULK_CHANGED: "Penugasan role massal diubah",
  RBAC_ACCOUNT_CREATED: "Akun dibuat",
  RBAC_ACCOUNT_IDENTITY_CHANGED: "Identitas akun diubah",
  RBAC_ACCOUNT_STATUS_CHANGED: "Status akun diubah",
  RBAC_ACCOUNT_CREDENTIAL_CHANGED: "Kredensial akun diubah",
  RBAC_ACCOUNT_TEACHER_FLAG_CHANGED: "Status guru akun diubah",
  RBAC_ACCOUNT_DELETED: "Akun dihapus",
  RBAC_LEGACY_BACKFILL: "Backfill legacy dijalankan",
  TEACHER_PROFILE_UPDATED: "Profil guru diubah",
  TEACHER_PHOTO_UPDATED: "Foto guru diubah",
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditTargetLabel(target: { targetUserId: string | null; targetUserName: string | null }): string {
  if (target.targetUserName) return target.targetUserName
  if (target.targetUserId) return `Akun terhapus (${target.targetUserId})`
  return "—"
}
