/**
 * Guard untuk server component (halaman).
 *
 * SERVER-ONLY.
 *
 * Berbeda dari route handler yang mengembalikan status HTTP, halaman
 * mengarahkan ulang: belum login → `/login`, tidak berhak → landing aman.
 * `redirect()` bekerja dengan melempar error kontrol Next, jadi guard ini tidak
 * boleh dipanggil di dalam `try/catch` yang menelan error sembarangan.
 */
import { redirect } from "next/navigation"

import {
  ForbiddenError,
  RbacNotReadyError,
  UnauthorizedError,
  can,
  getAuthorizationContext,
} from "@/lib/rbac-access"
import { hasAnyPermission } from "@/lib/rbac"

/**
 * Tujuan ketika pengguna terautentikasi tetapi tidak berhak atas halaman ini.
 *
 * Root `/` sengaja dipilih: halaman itu menampilkan landing aman tanpa
 * menjalankan query privat apa pun bila pemakainya tidak punya dashboard.
 */
const SAFE_LANDING = "/"

/**
 * Menuntut satu permission untuk membuka halaman.
 *
 * Kegagalan otentikasi → `/login`; kekurangan hak → landing aman. Kegagalan
 * lain (termasuk database tidak terbaca) dibiarkan naik agar tampil sebagai
 * error, bukan diam-diam menjadi halaman kosong.
 */
export async function requirePagePermission(key: string): Promise<void> {
  try {
    const context = await getAuthorizationContext()
    if (!hasAnyPermission(context.subject, [key])) redirect(SAFE_LANDING)
  } catch (error) {
    redirectForAuthError(error)
  }
}

/// Menuntut minimal salah satu permission untuk membuka halaman.
export async function requirePageAnyPermission(keys: readonly string[]): Promise<void> {
  try {
    const context = await getAuthorizationContext()
    if (!hasAnyPermission(context.subject, keys)) redirect(SAFE_LANDING)
  } catch (error) {
    redirectForAuthError(error)
  }
}

/// Pemeriksaan tanpa lempar, untuk menyusun tombol/menu di server component.
export async function pageCan(key: string): Promise<boolean> {
  try {
    return await can(key)
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof RbacNotReadyError) return false
    throw error
  }
}

function redirectForAuthError(error: unknown): never {
  if (error instanceof UnauthorizedError) redirect("/login")
  if (error instanceof ForbiddenError) redirect(SAFE_LANDING)
  // RbacNotReadyError dan kegagalan tak terduga sengaja diteruskan: menutupinya
  // dengan redirect akan menyembunyikan masalah konfigurasi/infrastruktur.
  throw error
}
