/**
 * Kompresi foto di sisi klien sebelum diunggah.
 *
 * Foto dari kamera HP sering 3–8 MB dan 4000 px — jauh di atas yang dibutuhkan
 * kartu pengurus atau fasilitas. Menyusutkannya di browser membuat unggahan
 * lolos batas ukuran server tanpa meminta pengguna mengedit file sendiri.
 *
 * Murni browser API (createImageBitmap + canvas), tanpa dependensi baru dan
 * tanpa impor server, sehingga aman dipakai komponen klien.
 */

export type ResizeOptions = {
  /** Rasio target lebar/tinggi, mis. 9 / 16. Gambar dipotong cover ke rasio ini. */
  aspect: number
  /** Sisi terpanjang hasil, dalam piksel. */
  maxEdge: number
  /** Kualitas JPEG/WebP 0–1. */
  quality?: number
}

/**
 * Potong "cover" ke rasio target lalu perkecil.
 *
 * Cover dipilih supaya hasilnya dapat diprediksi: bagian tengah gambar selalu
 * terisi penuh, sama dengan `object-cover` yang dipakai untuk menampilkannya —
 * pratinjau dan hasil akhir tidak pernah berbeda bingkai.
 */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sourceAspect = sourceWidth / sourceHeight
  if (sourceAspect > aspect) {
    // Sumber terlalu lebar: potong kiri-kanan.
    const sw = Math.round(sourceHeight * aspect)
    return { sx: Math.round((sourceWidth - sw) / 2), sy: 0, sw, sh: sourceHeight }
  }
  // Sumber terlalu tinggi (atau pas): potong atas-bawah.
  const sh = Math.round(sourceWidth / aspect)
  return { sx: 0, sy: Math.round((sourceHeight - sh) / 2), sw: sourceWidth, sh }
}

/** Ukuran keluaran setelah dibatasi sisi terpanjang. */
export function outputSize(aspect: number, maxEdge: number): { width: number; height: number } {
  if (aspect >= 1) {
    const width = maxEdge
    return { width, height: Math.max(1, Math.round(width / aspect)) }
  }
  const height = maxEdge
  return { width: Math.max(1, Math.round(height * aspect)), height }
}

/**
 * Hasilkan File JPEG baru berukuran wajar. Bila apa pun gagal (browser lama,
 * gambar rusak), file asli dikembalikan apa adanya sehingga unggahan tetap
 * jalan dan validasi server yang menentukan.
 */
export async function resizeImageFile(file: File, options: ResizeOptions): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file

  try {
    const bitmap = await createImageBitmap(file)
    const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height, options.aspect)
    const { width, height } = outputSize(options.aspect, options.maxEdge)

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return file
    }
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", options.quality ?? 0.85),
    )
    if (!blob) return file

    const name = file.name.replace(/\.[^.]+$/, "") || "foto"
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() })
  } catch {
    return file
  }
}
