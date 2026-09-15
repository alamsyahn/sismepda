import { requirePermission, type AuthorizationContext } from "@/lib/rbac-access"

/**
 * Guard halaman Development.
 *
 * Tidak ada pemeriksaan nama role di sini. Keputusan diambil evaluator kanonik
 * `hasPermission`, yang sekaligus memuat satu-satunya bypass system admin yang
 * terkendali — sehingga halaman ini tidak menambah special-case baru.
 */
export function requireDevelopmentViewer(): Promise<AuthorizationContext> {
  return requirePermission("development.read")
}
