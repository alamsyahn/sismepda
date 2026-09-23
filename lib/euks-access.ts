import { z } from "zod"

import { describeAuthFailure } from "@/lib/api-errors"
import { MediaStorageError } from "@/lib/server-media-storage"
import { requirePermission } from "@/lib/rbac-access"

/**
 * E-UKS permissions are deliberately school-wide. This guard delegates to the
 * DB-current RBAC evaluator and never consults homeroom assignments or legacy
 * User.canViewEuks/User.canEditEuks flags.
 */
export async function requireEuksPermission(permission: string) {
  const context = await requirePermission(permission)
  return { id: context.user.id }
}

/**
 * Compatibility response shape for existing E-UKS route handlers.
 *
 * Tiga kelas kegagalan sengaja dibedakan, karena sebelumnya ketiganya berakhir
 * sebagai 500 "Data E-UKS tidak valid" dan membuat kegagalan server terbaca
 * seolah-olah pengguna salah mengisi formulir:
 *
 *   * ZodError  → 400 (payload memang cacat; ini SATU-SATUNYA kasus yang layak
 *     disebut "tidak valid"). Pesan Zod sendiri tidak diteruskan mentah-mentah
 *     supaya bentuk skema internal tidak bocor ke browser.
 *   * MediaStorageError → 500 dengan pesan yang jujur: berkas gagal disimpan,
 *     bukan salah pengguna. Penyebab aslinya (errno, path filesystem) hanya
 *     ditulis ke log server.
 *   * sisanya → 500 generik.
 */
export function euksErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return { error: "Data E-UKS tidak valid", status: 400 }
  }

  // Penyimpanan media gagal adalah insiden operasional (izin direktori, disk
  // penuh, mount hilang). Tanpa log ini penyebabnya tidak muncul di mana pun,
  // karena respons ke pengguna sengaja tidak membawa detail apa pun.
  if (error instanceof MediaStorageError) {
    console.error("[e-uks] penyimpanan media gagal", error)
    return { error: "Gagal menyimpan berkas. Silakan coba lagi.", status: 500 }
  }

  const failure = describeAuthFailure(error)
  if (failure.status === 500) {
    console.error("[e-uks] kegagalan tak terduga", error)
    return { error: "Terjadi kesalahan pada server. Silakan coba lagi.", status: 500 }
  }
  return { error: failure.error, status: failure.status }
}
