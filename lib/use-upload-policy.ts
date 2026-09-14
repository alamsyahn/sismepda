"use client"

import { useEffect, useState } from "react"

import {
  formatBytes,
  type UploadSlot,
} from "@/lib/upload-slots"
import {
  describeFormats,
  resolveUploadPolicy,
  tooLargeMessage,
  UploadPolicyError,
  type ResolvedUploadPolicy,
  type UploadPolicyConfig,
} from "@/lib/upload-policy"

/**
 * Batas unggah untuk komponen klien.
 *
 * Ini murni UX: menolak berkas kebesaran sebelum jaringan terpakai dan
 * menyebutkan angkanya dengan jelas. Otoritasnya tetap di server — route
 * handler memeriksa ulang setiap unggahan, sehingga menonaktifkan JavaScript
 * atau memanggil endpoint langsung tidak melewati batas apa pun.
 *
 * Konfigurasi diambil dari endpoint publik-untuk-pengguna-terautentikasi di
 * bawah; bila gagal dimuat, `resolveUploadPolicy` tetap memberi batas bawaan
 * slot, jadi form tidak pernah kehilangan batas.
 */
export function useUploadPolicy(slotKey: string): ResolvedUploadPolicy {
  const [config, setConfig] = useState<UploadPolicyConfig>({})

  useEffect(() => {
    let active = true
    fetch("/api/upload-policy", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) setConfig(data as UploadPolicyConfig)
      })
      .catch(() => {
        // Diam di sini disengaja: gagal memuat konfigurasi hanya berarti form
        // memakai batas bawaan slot untuk pratinjau, bukan kegagalan yang
        // perlu ditampilkan. Server tetap menjadi penentu.
      })
    return () => {
      active = false
    }
  }, [])

  return resolveUploadPolicy(slotKey, config)
}

/**
 * Pesan penolakan untuk berkas pilihan pengguna, atau `null` bila ukurannya
 * masih dalam batas. Hanya memeriksa ukuran: format ditentukan dari isi berkas
 * dan itu hanya bisa dipastikan di server.
 */
export function describeOversizeFile(
  file: File,
  policy: ResolvedUploadPolicy,
): string | null {
  if (file.size <= policy.maxBytes) return null
  return tooLargeMessage({ size: file.size, fileName: file.name }, policy)
}

/** Teks bantuan di bawah input: batas dan, bila slot mendeklarasikannya, format. */
export function describeUploadPolicy(policy: ResolvedUploadPolicy): string {
  const size = `Maksimum ${formatBytes(policy.maxBytes)}`
  return policy.allowedMimeTypes
    ? `${size}. Format ${describeFormats(policy.allowedMimeTypes)}.`
    : `${size}.`
}

export type { ResolvedUploadPolicy, UploadSlot }
export { UploadPolicyError }
