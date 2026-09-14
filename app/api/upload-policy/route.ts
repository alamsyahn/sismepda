import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { requireUser } from "@/lib/rbac-access"
import { getUploadPolicyConfig } from "@/lib/server-upload-policy"

/**
 * Konfigurasi batas unggah yang berlaku, untuk keperluan tampilan.
 *
 * Cukup terautentikasi: isinya hanya angka batas yang memang sudah tampak di
 * setiap form unggah, bukan data sekolah. Endpoint ini TIDAK memberi wewenang
 * apa pun — nilai di sini dipakai form untuk memberi tahu pengguna lebih awal,
 * sementara penegakannya tetap di route handler masing-masing unggahan.
 */
export async function GET() {
  try {
    await requireUser()
    const config = await getUploadPolicyConfig()
    return NextResponse.json(config, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return authFailureResponse(error, "Batas unggah gagal dimuat")
  }
}
