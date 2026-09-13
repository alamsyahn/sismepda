/**
 * Membuat key stabil untuk role baru; server tetap memvalidasi pola/keunikan.
 *
 * Dipotong pada 64 karakter karena `POST /api/rbac/roles` menolak key yang
 * lebih panjang — UI tidak boleh menghasilkan payload yang pasti ditolak.
 */
export function roleKeyFromName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (!normalized) return ""
  const prefixed = /^[a-z]/.test(normalized) ? normalized : `role_${normalized}`
  return prefixed.slice(0, 64).replace(/_+$/g, "")
}
