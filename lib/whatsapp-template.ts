/**
 * Mesin template pesan WhatsApp — MURNI dan CLIENT-SAFE.
 *
 * MENGAPA BERKAS INI ADA
 *
 * Teks pesan otomatis dahulu hidup sebagai string literal di
 * `whatsapp-messages.ts`, sehingga sekolah yang ingin mengubah satu kata pun
 * harus menunggu rilis baru. Berkas ini memindahkan bentuk pesan menjadi data
 * yang dapat disunting admin, TANPA memindahkan keputusan bisnis: sistem tetap
 * yang menentukan kondisi mana yang berlaku (lihat `WhatsAppTemplateKey`),
 * admin hanya menentukan bagaimana kondisi itu ditampilkan.
 *
 * MENGAPA BUKAN MESIN TEMPLATE UMUM
 *
 * Tidak ada `eval`, tidak ada ekspresi, tidak ada penelusuran properti bebas,
 * dan tidak ada conditional yang ditulis pengguna. Teks dari admin tidak pernah
 * dieksekusi; ia hanya dipindai untuk nama placeholder yang SUDAH terdaftar di
 * registry di bawah. Placeholder yang tidak terdaftar ditolak pada saat simpan,
 * sehingga pesan rusak tidak pernah sampai ke grup.
 *
 * MURNI: tanpa Prisma, tanpa jaringan, tanpa jam sistem — aman diimpor
 * komponen klien untuk preview maupun validasi.
 */

/** Empat kondisi yang ditentukan SISTEM, bukan ditulis admin. */
export type WhatsAppTemplateKey =
  /** A — masih ada kelas yang belum merekap. */
  | "MISSING_PENDING"
  /** B — seluruh kelas sudah merekap. */
  | "MISSING_COMPLETE"
  /** C — terdapat siswa tidak hadir. */
  | "ABSENT_PRESENT"
  /** D — tidak ada siswa tidak hadir (NIHIL). */
  | "ABSENT_NONE"

export const TEMPLATE_KEYS: readonly WhatsAppTemplateKey[] = [
  "MISSING_PENDING",
  "MISSING_COMPLETE",
  "ABSENT_PRESENT",
  "ABSENT_NONE",
]

export const TEMPLATE_LABELS: Record<WhatsAppTemplateKey, string> = {
  MISSING_PENDING: "Pengingat — Belum Semua Rekap",
  MISSING_COMPLETE: "Pengingat — Semua Sudah Rekap",
  ABSENT_PRESENT: "Rekap Kehadiran — Ada yang Tidak Hadir",
  ABSENT_NONE: "Rekap Kehadiran — NIHIL",
}

export const TEMPLATE_DESCRIPTIONS: Record<WhatsAppTemplateKey, string> = {
  MISSING_PENDING:
    "Dikirim pada jam pengingat bila pada saat itu masih ada kelas yang belum merekap absensi.",
  MISSING_COMPLETE:
    "Dikirim pada jam pengingat bila seluruh kelas sudah merekap. Pesan tetap dikirim sebagai konfirmasi, karena diam tidak dapat dibedakan dari worker yang mati.",
  ABSENT_PRESENT:
    "Dikirim pada jam rekap kehadiran bila terdapat siswa dengan status tidak hadir.",
  ABSENT_NONE:
    "Dikirim pada jam rekap kehadiran bila tidak ada satu pun siswa tercatat tidak hadir.",
}

/**
 * Daftar koleksi yang dapat dirender sebagai daftar.
 *
 * Setiap koleksi punya template ITEM tersendiri, karena bentuk satu barisnya
 * memang milik admin juga, bukan hanya teks di sekelilingnya.
 */
export type WhatsAppCollectionKey = "daftar_kelas_belum_rekap" | "daftar_siswa_tidak_hadir"

export const COLLECTION_LABELS: Record<WhatsAppCollectionKey, string> = {
  daftar_kelas_belum_rekap: "Daftar kelas belum rekap",
  daftar_siswa_tidak_hadir: "Daftar siswa tidak hadir",
}

/** Placeholder yang berlaku di dalam template ITEM `daftar_kelas_belum_rekap`. */
export const CLASS_ITEM_PLACEHOLDERS = {
  no: "Nomor urut item, mulai dari 1",
  nama_kelas: "Nama kelas, misalnya 7A",
  wali_kelas: "Nama wali kelas; berisi tanda hubung bila kelas belum punya wali",
  jumlah_siswa_belum_diisi: "Banyak siswa di kelas itu yang statusnya masih kosong",
} as const

/** Placeholder yang berlaku di dalam template ITEM `daftar_siswa_tidak_hadir`. */
export const STUDENT_ITEM_PLACEHOLDERS = {
  no: "Nomor urut item, mulai dari 1",
  nama_siswa: "Nama siswa",
  nama_kelas: "Nama kelas siswa tersebut",
  status: "SAKIT, IZIN, ALFA, atau DISPENSASI",
  keterangan: "Keterangan dari wali kelas; berisi tanda hubung bila kosong",
} as const

export type ClassItemPlaceholder = keyof typeof CLASS_ITEM_PLACEHOLDERS
export type StudentItemPlaceholder = keyof typeof STUDENT_ITEM_PLACEHOLDERS

export const ITEM_PLACEHOLDERS: Record<WhatsAppCollectionKey, Record<string, string>> = {
  daftar_kelas_belum_rekap: CLASS_ITEM_PLACEHOLDERS,
  daftar_siswa_tidak_hadir: STUDENT_ITEM_PLACEHOLDERS,
}

/**
 * Registry placeholder global, dikelompokkan agar UI dapat menampilkannya
 * dengan rapi tanpa menebak-nebak.
 *
 * Hanya berisi nilai yang benar-benar DAPAT dihitung dari data laporan yang
 * sudah ada. Placeholder yang datanya tidak tersedia sengaja tidak dibuat,
 * karena placeholder yang selalu kosong lebih menyesatkan daripada tidak ada.
 */
export type PlaceholderGroup = {
  label: string
  entries: { name: string; description: string }[]
}

const SCALAR_PLACEHOLDERS: Record<string, string> = {
  tanggal: "Tanggal laporan, misalnya Senin, 16 September 2026",
  waktu: "Jam pengiriman, misalnya 08.00",
  nama_sekolah: "Nama sekolah dari Pengaturan Sekolah",
  jumlah_kelas: "Total kelas",
  jumlah_kelas_sudah_rekap: "Banyak kelas yang sudah merekap lengkap",
  jumlah_kelas_belum_rekap: "Banyak kelas yang belum merekap",
  jumlah_siswa: "Total siswa aktif",
  jumlah_tidak_hadir: "Total siswa tidak hadir",
  jumlah_sakit: "Banyak siswa berstatus SAKIT",
  jumlah_izin: "Banyak siswa berstatus IZIN",
  jumlah_dispensasi: "Banyak siswa berstatus DISPENSASI",
  jumlah_alfa: "Banyak siswa berstatus ALFA",
}

/**
 * Placeholder koleksi per template.
 *
 * Template B dan D sengaja TIDAK mendapat koleksi apa pun: pada kondisi itu
 * daftarnya memang kosong, dan menyediakan placeholder yang pasti kosong hanya
 * mengundang admin memasangnya lalu bingung mengapa tidak muncul.
 */
const TEMPLATE_COLLECTIONS: Record<WhatsAppTemplateKey, WhatsAppCollectionKey[]> = {
  MISSING_PENDING: ["daftar_kelas_belum_rekap"],
  MISSING_COMPLETE: [],
  ABSENT_PRESENT: ["daftar_siswa_tidak_hadir"],
  ABSENT_NONE: [],
}

export function collectionsFor(key: WhatsAppTemplateKey): readonly WhatsAppCollectionKey[] {
  return TEMPLATE_COLLECTIONS[key]
}

/** Semua nama placeholder yang sah untuk satu template. */
export function allowedPlaceholders(key: WhatsAppTemplateKey): Set<string> {
  return new Set<string>([...Object.keys(SCALAR_PLACEHOLDERS), ...TEMPLATE_COLLECTIONS[key]])
}

/** Kelompok placeholder untuk ditampilkan di UI. */
export function placeholderGroups(key: WhatsAppTemplateKey): PlaceholderGroup[] {
  const entry = (name: string, description: string) => ({ name, description })
  const groups: PlaceholderGroup[] = [
    {
      label: "Umum",
      entries: [
        entry("tanggal", SCALAR_PLACEHOLDERS.tanggal),
        entry("waktu", SCALAR_PLACEHOLDERS.waktu),
        entry("nama_sekolah", SCALAR_PLACEHOLDERS.nama_sekolah),
      ],
    },
    {
      label: "Rekap kelas",
      entries: [
        entry("jumlah_kelas", SCALAR_PLACEHOLDERS.jumlah_kelas),
        entry("jumlah_kelas_sudah_rekap", SCALAR_PLACEHOLDERS.jumlah_kelas_sudah_rekap),
        entry("jumlah_kelas_belum_rekap", SCALAR_PLACEHOLDERS.jumlah_kelas_belum_rekap),
      ],
    },
    {
      label: "Kehadiran",
      entries: [
        entry("jumlah_siswa", SCALAR_PLACEHOLDERS.jumlah_siswa),
        entry("jumlah_tidak_hadir", SCALAR_PLACEHOLDERS.jumlah_tidak_hadir),
        entry("jumlah_sakit", SCALAR_PLACEHOLDERS.jumlah_sakit),
        entry("jumlah_izin", SCALAR_PLACEHOLDERS.jumlah_izin),
        entry("jumlah_dispensasi", SCALAR_PLACEHOLDERS.jumlah_dispensasi),
        entry("jumlah_alfa", SCALAR_PLACEHOLDERS.jumlah_alfa),
      ],
    },
  ]

  const collections = TEMPLATE_COLLECTIONS[key]
  if (collections.length > 0) {
    groups.push({
      label: "Daftar",
      entries: collections.map((name) => entry(name, COLLECTION_LABELS[name])),
    })
  }
  return groups
}

/**
 * Pemisah antar-item daftar.
 *
 * Hanya dua bentuk yang didukung, sesuai kebutuhan nyata pesan WhatsApp. Lebih
 * dari itu hanya menambah permukaan yang harus divalidasi tanpa menambah
 * kegunaan.
 */
export type ItemSeparator = "NEWLINE" | "BLANK_LINE"

export const SEPARATOR_LABELS: Record<ItemSeparator, string> = {
  NEWLINE: "Satu baris baru",
  BLANK_LINE: "Satu baris kosong antar-item",
}

export function isItemSeparator(value: unknown): value is ItemSeparator {
  return value === "NEWLINE" || value === "BLANK_LINE"
}

function separatorText(separator: ItemSeparator): string {
  return separator === "BLANK_LINE" ? "\n\n" : "\n"
}

/** Satu template lengkap: teks utama + format item untuk setiap koleksinya. */
export type WhatsAppTemplate = {
  body: string
  items: Partial<Record<WhatsAppCollectionKey, { format: string; separator: ItemSeparator }>>
}

export type WhatsAppTemplateSet = Record<WhatsAppTemplateKey, WhatsAppTemplate>

/**
 * Batas panjang. Angka ini longgar dibanding pesan terpanjang yang masuk akal,
 * dan hanya ada untuk mencegah satu baris konfigurasi tumbuh tak terkendali.
 */
export const MAX_BODY_LENGTH = 4000
export const MAX_ITEM_FORMAT_LENGTH = 500

/** Menemukan seluruh `{{...}}` beserta posisinya. */
const PLACEHOLDER_PATTERN = /\{\{\s*([^}]*?)\s*\}\}/g

export function placeholdersIn(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) found.push(match[1])
  return found
}

export type TemplateError =
  | { kind: "UNKNOWN_PLACEHOLDER"; name: string }
  | { kind: "EMPTY_BODY" }
  | { kind: "TOO_LONG"; limit: number }

export function templateErrorMessage(error: TemplateError): string {
  switch (error.kind) {
    case "UNKNOWN_PLACEHOLDER":
      return `Variabel tidak dikenal: {{${error.name}}}`
    case "EMPTY_BODY":
      return "Template tidak boleh kosong."
    case "TOO_LONG":
      return `Template terlalu panjang; batasnya ${error.limit} karakter.`
  }
}

/**
 * Memvalidasi satu teks terhadap daftar placeholder yang diizinkan.
 *
 * Mengembalikan SEMUA kesalahan sekaligus, bukan hanya yang pertama, supaya
 * admin tidak harus menyimpan berkali-kali untuk menemukan kesalahan berikutnya.
 */
export function validateText(
  text: string,
  allowed: ReadonlySet<string>,
  limit: number,
): TemplateError[] {
  const errors: TemplateError[] = []
  if (text.trim().length === 0) errors.push({ kind: "EMPTY_BODY" })
  if (text.length > limit) errors.push({ kind: "TOO_LONG", limit })
  const seen = new Set<string>()
  for (const name of placeholdersIn(text)) {
    if (allowed.has(name) || seen.has(name)) continue
    seen.add(name)
    errors.push({ kind: "UNKNOWN_PLACEHOLDER", name })
  }
  return errors
}

/** Memvalidasi satu template lengkap beserta format itemnya. */
export function validateTemplate(
  key: WhatsAppTemplateKey,
  template: WhatsAppTemplate,
): TemplateError[] {
  const errors = validateText(template.body, allowedPlaceholders(key), MAX_BODY_LENGTH)
  for (const collection of collectionsFor(key)) {
    const item = template.items[collection]
    if (!item) continue
    const allowed = new Set(Object.keys(ITEM_PLACEHOLDERS[collection]))
    errors.push(...validateText(item.format, allowed, MAX_ITEM_FORMAT_LENGTH))
  }
  return errors
}

/**
 * Mengganti placeholder dengan nilainya.
 *
 * Penggantian dilakukan sekali jalan lewat `replace` dengan fungsi, BUKAN
 * berulang per placeholder. Penggantian berulang akan memindai kembali teks
 * yang baru saja disisipkan, sehingga nama kelas atau keterangan yang kebetulan
 * mengandung `{{...}}` ikut diterjemahkan.
 *
 * Placeholder yang tidak dikenal DIBIARKAN APA ADANYA. Template sudah
 * divalidasi saat disimpan; membiarkannya terlihat jauh lebih mudah
 * didiagnosis daripada menghapusnya diam-diam menjadi ruang kosong.
 */
export function renderText(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole,
  )
}

/** Merender satu koleksi menjadi teks daftar. */
export function renderCollection(
  format: string,
  separator: ItemSeparator,
  items: readonly Readonly<Record<string, string>>[],
): string {
  return items
    .map((item, index) => renderText(format, { ...item, no: String(index + 1) }))
    .join(separatorText(separator))
}

/** Data yang dibutuhkan untuk merender satu pesan. */
export type TemplateContext = {
  scalars: Readonly<Record<string, string>>
  collections: Partial<Record<WhatsAppCollectionKey, Readonly<Record<string, string>>[]>>
}

/**
 * Merender template utama beserta seluruh koleksinya.
 *
 * Koleksi dirender LEBIH DAHULU menjadi string, lalu ikut sebagai nilai biasa
 * dalam satu kali penggantian. Dengan begitu isi daftar tidak pernah dipindai
 * ulang sebagai template.
 */
export function renderTemplate(
  key: WhatsAppTemplateKey,
  template: WhatsAppTemplate,
  context: TemplateContext,
): string {
  const values: Record<string, string> = { ...context.scalars }
  for (const collection of collectionsFor(key)) {
    const item = template.items[collection]
    const rows = context.collections[collection] ?? []
    values[collection] = item ? renderCollection(item.format, item.separator, rows) : ""
  }
  return renderText(template.body, values)
}
