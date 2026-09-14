/**
 * Pembacaan konfigurasi unggah dari database dan penegakannya di server.
 *
 * SERVER-ONLY: mengimpor Prisma. Komponen klien hanya boleh mengimpor TIPE dari
 * berkas ini; mengimpor nilainya akan menarik `pg` ke bundel peramban (lihat
 * catatan boundary di docs/architecture/overview.md). Logika murninya ada di
 * lib/upload-policy.ts dan dipakai bersama oleh klien.
 *
 * Konfigurasi dibaca ulang per request lewat `cache()` React, jadi beberapa
 * pemeriksaan dalam satu request hanya menyentuh database sekali, tetapi
 * perubahan yang disimpan admin langsung berlaku pada request berikutnya —
 * tanpa restart dan tanpa cache lintas-request yang bisa basi.
 */

import { cache } from "react"

import { prisma } from "@/lib/prisma"
import {
  assertUploadAllowed,
  isValidLimitBytes,
  resolveUploadPolicy,
  tooLargeMessage,
  UploadPolicyError,
  type ResolvedUploadPolicy,
  type UploadCandidate,
  type UploadPolicyConfig,
} from "@/lib/upload-policy"

/** Konfigurasi aktif: default global + seluruh override slot. */
export const getUploadPolicyConfig = cache(async (): Promise<UploadPolicyConfig> => {
  const [setting, overrides] = await Promise.all([
    prisma.schoolSetting.findUnique({
      where: { id: "default" },
      select: { uploadImageMaxBytes: true, uploadDocumentMaxBytes: true },
    }),
    prisma.uploadPolicyOverride.findMany({ select: { slotKey: true, maxBytes: true } }),
  ])

  const slotOverrides: Record<string, number> = {}
  for (const row of overrides) {
    // Baris rusak diabaikan, bukan dipakai. Nilai di luar rentang yang sah
    // tidak boleh menjadi kebijakan hanya karena sempat tersimpan.
    if (isValidLimitBytes(row.maxBytes)) slotOverrides[row.slotKey] = row.maxBytes
  }

  return {
    globalLimits: {
      image: setting?.uploadImageMaxBytes ?? undefined,
      document: setting?.uploadDocumentMaxBytes ?? undefined,
    },
    slotOverrides,
  }
})

/** Kebijakan efektif satu slot, dibaca dari konfigurasi aktif. */
export async function getUploadPolicy(slotKey: string): Promise<ResolvedUploadPolicy> {
  return resolveUploadPolicy(slotKey, await getUploadPolicyConfig())
}

/**
 * Gerbang wajib setiap jalur unggah yang dikendalikan pengguna.
 *
 * Dipanggil SEBELUM berkas disimpan. Berkas yang sudah tersimpan tidak pernah
 * melewati fungsi ini, sehingga menurunkan batas tidak membatalkan aset lama;
 * mengganti berkas adalah unggahan baru dan diperiksa dengan kebijakan
 * terkini.
 *
 * @throws {UploadPolicyError}
 */
export async function assertUploadAllowedForSlot(
  slotKey: string,
  candidate: UploadCandidate,
): Promise<ResolvedUploadPolicy> {
  return assertUploadAllowed(slotKey, candidate, await getUploadPolicyConfig())
}

/**
 * Selisih yang ditoleransi antara `Content-Length` dan ukuran berkas: pembatas
 * multipart, nama field, dan header per-bagian ikut terhitung di panjang
 * request. Tanpa kelonggaran ini berkas tepat sebesar batas akan ditolak.
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/**
 * Tolak request kebesaran sebelum body-nya dibaca.
 *
 * Ini penjaga sumber daya, BUKAN otoritas: `Content-Length` dikirim klien dan
 * bisa dipalsukan atau tidak ada. Ukuran berkas yang sebenarnya tetap wajib
 * diperiksa dengan `assertUploadAllowedForSlot` setelah body terbaca.
 *
 * @throws {UploadPolicyError}
 */
export async function assertRequestSizeWithinSlot(
  slotKey: string,
  request: Request,
): Promise<ResolvedUploadPolicy> {
  const policy = await getUploadPolicy(slotKey)
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > policy.maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw new UploadPolicyError("FILE_TOO_LARGE", tooLargeMessage({ size: declared }, policy), 413)
  }
  return policy
}
