/**
 * Pemetaan error otorisasi → status HTTP untuk route handler.
 *
 * Aturan yang ditegakkan di sini:
 *   * belum terautentikasi / akun nonaktif / akun terhapus → 401
 *   * terautentikasi tetapi tidak berhak                   → 403
 *   * RBAC belum siap                                      → 503 (fail closed)
 *   * sisanya                                              → 500
 *
 * Kegagalan tak terduga TIDAK PERNAH diturunkan menjadi 403. Menyamarkan bug
 * server sebagai "tidak diizinkan" menyembunyikan insiden dan membuat klien
 * salah menyimpulkan bahwa datanya memang terlarang.
 *
 * `redirect()` dan `notFound()` milik Next melempar error kontrol khusus; helper
 * ini tidak dipakai di server component sehingga error tersebut tidak pernah
 * tertelan di sini.
 */
import { NextResponse } from "next/server"

import { ForbiddenError, RbacNotReadyError, UnauthorizedError } from "@/lib/rbac-access"
import { UploadPolicyError } from "@/lib/upload-policy"

export type ApiFailure = {
  readonly status: number
  readonly error: string
}

/// Error yang sudah membawa status HTTP sendiri (validasi, konflik, 404).
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function describeAuthFailure(error: unknown): ApiFailure {
  if (error instanceof UnauthorizedError) {
    return { status: 401, error: "Sesi tidak valid atau akun tidak aktif" }
  }
  if (error instanceof ForbiddenError) {
    return { status: 403, error: "Tidak diizinkan" }
  }
  if (error instanceof RbacNotReadyError) {
    return { status: 503, error: "Otorisasi belum siap" }
  }
  // Pelanggaran kebijakan unggah sudah membawa status (413/415/400) dan pesan
  // yang aman ditampilkan; tidak ada path internal maupun stack di dalamnya.
  if (error instanceof UploadPolicyError) {
    return { status: error.status, error: error.message }
  }
  if (error instanceof ApiError) {
    return { status: error.status, error: error.message }
  }
  return { status: 500, error: "Terjadi kesalahan pada server" }
}

/**
 * Membungkus error menjadi response JSON dengan status yang benar.
 *
 * `fallbackMessage` hanya dipakai untuk kegagalan 500 sehingga tiap endpoint
 * tetap bisa memberi pesan yang sesuai konteksnya tanpa mengubah status.
 */
export function authFailureResponse(error: unknown, fallbackMessage?: string): NextResponse {
  const failure = describeAuthFailure(error)
  const message = failure.status === 500 && fallbackMessage ? fallbackMessage : failure.error
  return NextResponse.json({ error: message }, { status: failure.status })
}
