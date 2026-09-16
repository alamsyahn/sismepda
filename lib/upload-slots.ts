/**
 * Registry Upload Slot — otoritas tunggal atas "di mana saja aplikasi ini
 * menerima berkas dari pengguna".
 *
 * CLIENT-SAFE: tidak mengimpor Prisma maupun modul server, sehingga komponen
 * klien boleh mengimpornya sebagai value (lihat catatan boundary di
 * docs/architecture/overview.md).
 *
 * Registry ini dipakai serentak oleh tiga pihak:
 *   * route handler  — menentukan batas yang ditegakkan sebelum menyimpan;
 *   * komponen klien — menampilkan batas dan menolak lebih awal demi UX;
 *   * UI Administrasi — menemukan slot secara otomatis, tanpa daftar kedua.
 *
 * Karena ketiganya membaca daftar yang sama, menambah slot baru di sini
 * otomatis memunculkannya di halaman pengaturan. Tidak boleh ada daftar slot
 * lain di mana pun; daftar kedua akan langsung membuat UI dan penegakan
 * berbeda pendapat.
 *
 * `defaultMaxBytes` adalah BATAS BAWAAN SLOT, bukan batas global. Nilainya
 * sengaja menyalin batas yang sudah berlaku di HEAD sebelum kebijakan
 * terpusat ada, supaya mengaktifkan modul ini tidak mengubah satu pun
 * perilaku yang sudah dipakai sekolah. Slot tanpa `defaultMaxBytes` jatuh ke
 * default kategori.
 */

/** Kategori menentukan default global mana yang dipakai saat slot tidak punya batas sendiri. */
export const UPLOAD_CATEGORIES = ["image", "document"] as const

export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number]

export const UPLOAD_CATEGORY_LABELS: Record<UploadCategory, string> = {
  image: "Gambar",
  document: "Dokumen",
}

export type UploadSlot = {
  /// Kunci stabil. Jangan pernah diubah setelah dipakai: override milik admin
  /// tersimpan di database dengan kunci ini.
  readonly key: string
  readonly label: string
  readonly category: UploadCategory
  /// Nama modul untuk pengelompokan di UI. Bebas — UI mengelompokkan dari
  /// metadata ini, tidak dari daftar modul yang ditulis ulang di halaman.
  readonly module: string
  readonly description?: string
  /**
   * Batas bawaan slot dalam byte. Absen berarti "ikut default kategori".
   */
  readonly defaultMaxBytes?: number
  /**
   * Bisakah admin mengubah batas slot ini dari UI? Default `true`.
   * `false` dipakai untuk operasi sistem yang batasnya bagian dari kontrak
   * teknis, bukan preferensi sekolah — dan pengecualian itu tampil eksplisit
   * di UI, bukan disembunyikan.
   */
  readonly configurable?: boolean
  /**
   * Tipe MIME yang diterima, hasil deteksi isi berkas (magic bytes), bukan
   * ekstensi maupun `file.type` kiriman klien. Absen berarti slot ini punya
   * aturan format domain sendiri yang tidak diringkas di sini.
   */
  readonly allowedMimeTypes?: readonly string[]
}

const IMAGE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

/**
 * Katalog lengkap. Setiap entri harus benar-benar punya jalur upload yang
 * memanggilnya; slot tanpa pemakai adalah utang, bukan fitur.
 */
export const UPLOAD_SLOTS: readonly UploadSlot[] = [
  {
    key: "profile.user.photo",
    label: "Foto Profil Pengguna",
    category: "image",
    module: "Profil & Akun",
    description: "Foto yang diunggah pengguna pada halaman profilnya sendiri.",
    defaultMaxBytes: 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "teachers.master.photo",
    label: "Foto Guru (Data Master)",
    category: "image",
    module: "Data Guru",
    description: "Foto guru yang diunggah administrator dari Data Master > Guru.",
    defaultMaxBytes: 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "branding.app.logo",
    label: "Logo Aplikasi",
    category: "image",
    module: "Branding Aplikasi",
    description: "Logo pada sidebar dan halaman masuk.",
    defaultMaxBytes: 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "branding.favicon",
    label: "Favicon Website",
    category: "image",
    module: "Branding Aplikasi",
    description: "Ikon pada tab browser. Hanya PNG atau ICO.",
    defaultMaxBytes: 512 * 1024,
    allowedMimeTypes: ["image/png", "image/x-icon"],
  },
  {
    key: "euks.officer.photo",
    label: "Foto Pengurus UKS",
    category: "image",
    module: "E-UKS",
    defaultMaxBytes: 2 * 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "euks.facility.photo",
    label: "Foto Fasilitas UKS",
    category: "image",
    module: "E-UKS",
    defaultMaxBytes: 2 * 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "euks.hero.image",
    label: "Foto Carousel Hero E-UKS",
    category: "image",
    module: "E-UKS",
    defaultMaxBytes: 2 * 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "euks.hero.logo",
    label: "Logo Hero E-UKS",
    category: "image",
    module: "E-UKS",
    description: "Logo pendamping hero; menerima SVG yang disanitasi.",
    defaultMaxBytes: 512 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
  },
  {
    key: "sarpras.item.photo",
    label: "Foto Barang Sarpras",
    category: "image",
    module: "Sarpras",
    defaultMaxBytes: 2 * 1024 * 1024,
    allowedMimeTypes: IMAGE_PHOTO_TYPES,
  },
  {
    key: "students.import.csv",
    label: "Impor CSV Siswa",
    category: "document",
    module: "Data Siswa",
    description: "Berkas CSV yang dibaca di peramban sebelum barisnya dikirim sebagai JSON.",
    defaultMaxBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["text/csv"],
  },
  {
    key: "teachers.import.csv",
    label: "Impor CSV Guru",
    category: "document",
    module: "Data Guru",
    description: "Berkas CSV yang dibaca di peramban sebelum barisnya dikirim sebagai JSON.",
    defaultMaxBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["text/csv"],
  },
  {
    key: "schedule.asc.xml",
    label: "Impor Jadwal aSc TimeTables (XML)",
    category: "document",
    module: "Jadwal",
    description:
      "Berkas ekspor XML dari aSc TimeTables. Hanya dibaca untuk pratinjau; berkas aslinya tidak disimpan.",
    defaultMaxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ["text/xml", "application/xml"],
  },
  {
    key: "database.restore.archive",
    label: "Berkas Restore Database",
    category: "document",
    module: "Operasi Sistem",
    description:
      "Arsip pemulihan database. Batasnya bagian dari kontrak operasional dan hanya dapat dijalankan System Admin, jadi tidak dibuka untuk konfigurasi.",
    defaultMaxBytes: 200 * 1024 * 1024,
    configurable: false,
  },
]

const BY_KEY = new Map(UPLOAD_SLOTS.map((slot) => [slot.key, slot]))

export const UPLOAD_SLOT_KEYS: readonly string[] = UPLOAD_SLOTS.map((slot) => slot.key)

/** Slot untuk sebuah key, atau `null` bila tidak terdaftar. Tidak pernah melempar. */
export function findUploadSlot(key: string): UploadSlot | null {
  return BY_KEY.get(key) ?? null
}

export function isUploadSlotKey(key: string): boolean {
  return BY_KEY.has(key)
}

/** Slot yang boleh disetel admin; dipakai UI dan endpoint konfigurasi. */
export function configurableUploadSlots(): readonly UploadSlot[] {
  return UPLOAD_SLOTS.filter((slot) => slot.configurable !== false)
}

/**
 * Ukuran manusiawi untuk pesan dan tampilan.
 *
 * Memakai koma desimal sesuai lokal aplikasi, dan menyembunyikan desimal nol
 * supaya "2 MB" tidak tertulis "2,0 MB".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-"
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${trimNumber(kb)} KB`
  return `${trimNumber(kb / 1024)} MB`
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",")
}

/** Konversi tampilan: UI memakai MB, otoritas internal tetap byte. */
export const BYTES_PER_MB = 1024 * 1024

export function mbToBytes(mb: number): number {
  return Math.round(mb * BYTES_PER_MB)
}

export function bytesToMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100
}
