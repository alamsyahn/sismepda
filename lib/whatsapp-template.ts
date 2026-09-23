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
import { TEACHER_TAG_PLACEHOLDER, mentionText } from "@/lib/whatsapp-teacher-tag"
import type { WhatsAppMessageType } from "@/lib/whatsapp-schedule"

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
  /**
   * E — rekap kehadiran masih SEMENTARA karena ada kelas yang belum lengkap.
   *
   * Mendahului C dan D: selama masih ada kelas yang belum melengkapi absensi,
   * angka ketidakhadiran belum final, dan mengirimkannya sebagai rekap biasa
   * membuat pembaca menyimpulkan keadaan yang belum tentu benar.
   */
  | "ABSENT_INCOMPLETE"
  /**
   * F — notifikasi satu kunjungan UKS kepada wali kelas.
   *
   * Hanya satu kondisi, karena peristiwanya memang satu: seorang siswa
   * berkunjung. Tidak ada cabang "ada"/"nihil" seperti rekap harian.
   */
  | "EUKS_VISIT"

export const TEMPLATE_KEYS: readonly WhatsAppTemplateKey[] = [
  "MISSING_PENDING",
  "MISSING_COMPLETE",
  "ABSENT_PRESENT",
  "ABSENT_NONE",
  "ABSENT_INCOMPLETE",
  "EUKS_VISIT",
]

/**
 * Kondisi mana yang MUNGKIN terjadi pada satu jenis otomatisasi.
 *
 * Keempat kondisi memang ada sebagai sistem, tetapi satu jenis otomatisasi
 * hanya pernah menghasilkan dua di antaranya: jam pengingat tidak pernah
 * mengirim rekap kehadiran, dan sebaliknya. Menampilkan keempatnya di kedua
 * kartu membuat admin menyunting teks yang tidak akan pernah terkirim dari
 * kartu itu.
 *
 * Ini SEMATA-MATA soal kondisi mana yang relevan untuk satu jenis. Penyimpanan
 * tetap menyimpan keempat kunci apa adanya, sehingga template yang pernah
 * disimpan tidak hilang.
 */
const TYPE_TEMPLATE_KEYS: Record<WhatsAppMessageType, readonly WhatsAppTemplateKey[]> = {
  ATTENDANCE_MISSING: ["MISSING_PENDING", "MISSING_COMPLETE"],
  ATTENDANCE_ABSENT: ["ABSENT_PRESENT", "ABSENT_NONE", "ABSENT_INCOMPLETE"],
  EUKS_VISIT_NOTIFICATION: ["EUKS_VISIT"],
}

export function templateKeysForType(
  type: WhatsAppMessageType,
): readonly WhatsAppTemplateKey[] {
  return TYPE_TEMPLATE_KEYS[type]
}

export const TEMPLATE_LABELS: Record<WhatsAppTemplateKey, string> = {
  MISSING_PENDING: "Pengingat — Belum Semua Rekap",
  MISSING_COMPLETE: "Pengingat — Semua Sudah Rekap",
  ABSENT_PRESENT: "Rekap Kehadiran — Ada yang Tidak Hadir",
  ABSENT_NONE: "Rekap Kehadiran — NIHIL",
  ABSENT_INCOMPLETE: "Rekap Kehadiran — Belum Lengkap",
  EUKS_VISIT: "Kunjungan UKS — Notifikasi Wali Kelas",
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
  ABSENT_INCOMPLETE:
    "Dikirim pada jam rekap kehadiran bila pada saat itu masih ada kelas yang belum melengkapi absensi. Kondisi ini DIDAHULUKAN: selama masih ada kelas belum lengkap, angka ketidakhadiran belum final.",
  EUKS_VISIT:
    "Dikirim ke nomor WhatsApp wali kelas siswa yang bersangkutan ketika petugas UKS meminta notifikasi atas sebuah kunjungan. Tidak terjadwal dan tidak pernah terkirim sendiri.",
}

/**
 * Daftar koleksi yang dapat dirender sebagai daftar.
 *
 * Setiap koleksi punya template ITEM tersendiri, karena bentuk satu barisnya
 * memang milik admin juga, bukan hanya teks di sekelilingnya.
 */
export type WhatsAppCollectionKey =
  | "daftar_kelas_belum_rekap"
  | "daftar_siswa_tidak_hadir"
  | "daftar_sakit"
  | "daftar_izin"
  | "daftar_alfa"
  | "daftar_dispensasi"

export const COLLECTION_LABELS: Record<WhatsAppCollectionKey, string> = {
  daftar_kelas_belum_rekap: "Daftar kelas belum rekap",
  daftar_siswa_tidak_hadir: "Semua siswa tidak hadir",
  daftar_sakit: "Sakit",
  daftar_izin: "Izin",
  daftar_alfa: "Alfa",
  daftar_dispensasi: "Dispensasi",
}

/**
 * Daftar per status dan padanan `bagian_*`-nya.
 *
 * Urutannya adalah urutan tampil pada template bawaan, dan juga urutan
 * pilihan pada editor.
 */
export const ABSENCE_SECTIONS = [
  { status: "SAKIT", heading: "SAKIT", list: "daftar_sakit", section: "bagian_sakit", count: "jumlah_sakit" },
  { status: "IZIN", heading: "IZIN", list: "daftar_izin", section: "bagian_izin", count: "jumlah_izin" },
  { status: "ALFA", heading: "ALFA", list: "daftar_alfa", section: "bagian_alfa", count: "jumlah_alfa" },
  {
    status: "DISPENSASI",
    heading: "DISPENSASI",
    list: "daftar_dispensasi",
    section: "bagian_dispensasi",
    count: "jumlah_dispensasi",
  },
] as const satisfies readonly {
  status: string
  heading: string
  list: WhatsAppCollectionKey
  section: string
  count: string
}[]

/** Placeholder yang berlaku di dalam template ITEM `daftar_kelas_belum_rekap`. */
export const CLASS_ITEM_PLACEHOLDERS = {
  no: "Nomor urut item, mulai dari 1",
  nama_kelas: "Nama kelas, misalnya 7A",
  wali_kelas: "Nama wali kelas; berisi tanda hubung bila kelas belum punya wali",
  jumlah_siswa_belum_diisi: "Banyak siswa di kelas itu yang statusnya masih kosong",
  /**
   * Mention WhatsApp guru yang SEDANG mengajar kelas itu pada saat pesan
   * dikirim, menurut jadwal aktif. Kosong di luar jam pelajaran, pada slot
   * tanpa guru, dan bila nomor gurunya tidak dapat dipakai.
   *
   * BUKAN wali kelas: `{{wali_kelas}}` tetap berarti wali kelas.
   */
  [TEACHER_TAG_PLACEHOLDER]:
    "Mention guru yang sedang mengajar kelas itu saat pesan dikirim; kosong bila sedang bukan jam pelajaran atau nomor gurunya tidak tersedia",
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
  // Daftar per status memuat baris siswa yang sama, hanya sudah tersaring,
  // sehingga variabel itemnya persis sama.
  daftar_sakit: STUDENT_ITEM_PLACEHOLDERS,
  daftar_izin: STUDENT_ITEM_PLACEHOLDERS,
  daftar_alfa: STUDENT_ITEM_PLACEHOLDERS,
  daftar_dispensasi: STUDENT_ITEM_PLACEHOLDERS,
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
  catatan_kelas_belum_rekap:
    "Kalimat catatan bila masih ada kelas yang belum mengisi absensi; kosong bila seluruh kelas sudah selesai",
}

/**
 * Placeholder khusus notifikasi kunjungan UKS.
 *
 * Dipisahkan dari placeholder absensi karena datanya berasal dari satu baris
 * kunjungan, bukan dari laporan harian: menggabungkannya akan menawarkan
 * `{{jumlah_alfa}}` pada pesan yang tidak punya angka itu.
 */
const EUKS_VISIT_PLACEHOLDERS: Record<string, string> = {
  tanggal: "Tanggal kunjungan, misalnya Senin, 16 September 2026",
  nama_sekolah: "Nama sekolah dari Pengaturan Sekolah",
  nama_siswa: "Nama siswa yang berkunjung",
  nama_kelas: "Kelas siswa tersebut",
  wali_kelas: "Nama wali kelas penerima pesan",
  keluhan: "Keluhan yang dicatat petugas UKS",
  tindakan: "Tindakan yang diberikan",
  tindak_lanjut:
    "Tindak lanjut bila diisi; berisi tanda hubung bila petugas mengosongkannya",
  petugas: "Nama petugas yang mencatat kunjungan; tanda hubung bila tidak diketahui",
}

/**
 * Placeholder `bagian_*` — gabungan judul, jumlah, dan daftar satu status.
 *
 * MENGAPA ADA
 *
 * Tanpa ini admin harus menulis sendiri `*SAKIT — {{jumlah_sakit}}*` lalu
 * `{{daftar_sakit}}` untuk setiap status, dan salah satu pasti terlewat ketika
 * ada perubahan. `bagian_*` menyusun keduanya dengan bentuk yang konsisten.
 *
 * Judul TETAP tercetak walaupun jumlahnya nol. Laporan ini juga berfungsi
 * menyatakan secara eksplisit bahwa hari itu memang tidak ada Alfa — berbeda
 * artinya dari bagian yang hilang karena datanya tidak terbaca.
 */
const SECTION_PLACEHOLDERS: Record<string, string> = Object.fromEntries(
  ABSENCE_SECTIONS.map((section) => [
    section.section,
    `Judul *${section.heading} — jumlah* beserta daftarnya; judul tetap muncul walaupun jumlahnya 0`,
  ]),
)

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
  ABSENT_PRESENT: [
    "daftar_siswa_tidak_hadir",
    ...ABSENCE_SECTIONS.map((section) => section.list),
  ],
  ABSENT_NONE: [],
  // Kondisi sementara memuat daftar KELAS yang belum lengkap, bukan daftar
  // siswa: yang perlu ditindak saat itu adalah kelasnya. Angka per status tetap
  // tersedia sebagai skalar, karena memang masih bisa berubah.
  ABSENT_INCOMPLETE: ["daftar_kelas_belum_rekap"],
  // Notifikasi kunjungan berbicara tentang SATU siswa; tidak ada daftar apa pun
  // yang masuk akal di dalamnya.
  EUKS_VISIT: [],
}

/** Apakah kondisi ini milik notifikasi kunjungan UKS? */
function isEuksVisit(key: WhatsAppTemplateKey): boolean {
  return key === "EUKS_VISIT"
}

/** Bagian status yang berlaku pada satu kondisi. */
function sectionsFor(key: WhatsAppTemplateKey): readonly (typeof ABSENCE_SECTIONS)[number][] {
  return key === "ABSENT_PRESENT" ? ABSENCE_SECTIONS : []
}

/** Placeholder `bagian_*` hanya berlaku pada kondisi yang punya daftar siswa. */
function sectionNamesFor(key: WhatsAppTemplateKey): string[] {
  return sectionsFor(key).map((section) => section.section)
}

export function collectionsFor(key: WhatsAppTemplateKey): readonly WhatsAppCollectionKey[] {
  return TEMPLATE_COLLECTIONS[key]
}

/** Semua nama placeholder yang sah untuk satu template. */
export function allowedPlaceholders(key: WhatsAppTemplateKey): Set<string> {
  // Notifikasi kunjungan memakai registry-nya sendiri: variabel absensi tidak
  // punya nilai pada peristiwa ini, dan menawarkannya hanya akan menghasilkan
  // pesan berisi angka nol yang menyesatkan wali kelas.
  if (isEuksVisit(key)) return new Set<string>(Object.keys(EUKS_VISIT_PLACEHOLDERS))
  return new Set<string>([
    ...Object.keys(SCALAR_PLACEHOLDERS),
    ...TEMPLATE_COLLECTIONS[key],
    ...sectionNamesFor(key),
  ])
}

/**
 * Kelompok placeholder untuk ditampilkan di UI.
 *
 * Isinya BERGANTUNG pada kondisi yang sedang disunting. Kartu pengingat tidak
 * perlu melihat variabel rekap kehadiran, dan sebaliknya: daftar panjang berisi
 * variabel yang selalu bernilai nol pada kondisi itu justru menyesatkan.
 */
export function placeholderGroups(key: WhatsAppTemplateKey): PlaceholderGroup[] {
  const entry = (name: string, description: string) => ({ name, description })

  if (isEuksVisit(key)) {
    const euks = (name: string) => entry(name, EUKS_VISIT_PLACEHOLDERS[name])
    return [
      { label: "Umum", entries: [euks("tanggal"), euks("nama_sekolah")] },
      {
        label: "Siswa",
        entries: [euks("nama_siswa"), euks("nama_kelas"), euks("wali_kelas")],
      },
      {
        label: "Kunjungan",
        entries: [euks("keluhan"), euks("tindakan"), euks("tindak_lanjut"), euks("petugas")],
      },
    ]
  }

  const groups: PlaceholderGroup[] = [
    {
      label: "Umum",
      entries: [
        entry("tanggal", SCALAR_PLACEHOLDERS.tanggal),
        entry("waktu", SCALAR_PLACEHOLDERS.waktu),
        entry("nama_sekolah", SCALAR_PLACEHOLDERS.nama_sekolah),
      ],
    },
  ]

  const isAbsence =
    key === "ABSENT_PRESENT" || key === "ABSENT_NONE" || key === "ABSENT_INCOMPLETE"

  if (!isAbsence) {
    groups.push({
      label: "Jumlah",
      entries: [
        entry("jumlah_kelas", SCALAR_PLACEHOLDERS.jumlah_kelas),
        entry("jumlah_kelas_sudah_rekap", SCALAR_PLACEHOLDERS.jumlah_kelas_sudah_rekap),
        entry("jumlah_kelas_belum_rekap", SCALAR_PLACEHOLDERS.jumlah_kelas_belum_rekap),
      ],
    })
  } else {
    groups.push({
      label: "Jumlah",
      entries: [
        entry("jumlah_siswa", SCALAR_PLACEHOLDERS.jumlah_siswa),
        entry("jumlah_tidak_hadir", SCALAR_PLACEHOLDERS.jumlah_tidak_hadir),
        ...ABSENCE_SECTIONS.map((section) =>
          entry(section.count, SCALAR_PLACEHOLDERS[section.count]),
        ),
        // Hanya kondisi sementara yang perlu menyebut berapa kelas yang masih
        // ditunggu; pada dua kondisi rekap lain angka itu selalu nol.
        ...(key === "ABSENT_INCOMPLETE"
          ? [
              entry("jumlah_kelas", SCALAR_PLACEHOLDERS.jumlah_kelas),
              entry(
                "jumlah_kelas_belum_rekap",
                SCALAR_PLACEHOLDERS.jumlah_kelas_belum_rekap,
              ),
              entry(
                "jumlah_kelas_sudah_rekap",
                SCALAR_PLACEHOLDERS.jumlah_kelas_sudah_rekap,
              ),
            ]
          : []),
      ],
    })
  }

  const sections = sectionNamesFor(key)
  if (sections.length > 0) {
    groups.push({
      label: "Bagian siap pakai",
      entries: sections.map((name) => entry(name, SECTION_PLACEHOLDERS[name])),
    })
  }

  const collections = TEMPLATE_COLLECTIONS[key]
  if (collections.length > 0) {
    groups.push({
      label: "Daftar",
      entries: collections.map((name) => entry(name, COLLECTION_LABELS[name])),
    })
  }

  if (isAbsence) {
    groups.push({
      label: "Catatan",
      entries: [
        entry("catatan_kelas_belum_rekap", SCALAR_PLACEHOLDERS.catatan_kelas_belum_rekap),
      ],
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
  /**
   * JID yang menyertai baris daftar, SEJAJAR INDEKS dengan `collections`.
   *
   * MENGAPA TERPISAH DARI BARIS
   *
   * Baris daftar hanya berisi teks yang boleh dilihat admin sebagai variabel.
   * JID bukan variabel: ia metadata protokol yang tidak pernah dicetak. Menaruh
   * keduanya di satu objek akan memunculkan `{{jid}}` di editor dan membuat
   * admin dapat menulis JID ke dalam teks pesan.
   *
   * Metadata ini hanya IKUT TERKIRIM bila format item yang disimpan admin
   * benar-benar memakai placeholder mention-nya; lihat `renderMessage()`.
   */
  mentions?: Partial<Record<WhatsAppCollectionKey, readonly (readonly string[])[]>>
}

/** Teks pesan beserta JID yang harus ikut sebagai metadata mention. */
export type RenderedMessage = {
  text: string
  /** Urut sesuai kemunculan, tanpa duplikat. */
  mentions: string[]
}

/**
 * Merender template utama beserta seluruh koleksinya.
 *
 * Koleksi dirender LEBIH DAHULU menjadi string, lalu ikut sebagai nilai biasa
 * dalam satu kali penggantian. Dengan begitu isi daftar tidak pernah dipindai
 * ulang sebagai template.
 *
 * `bagian_*` disusun dari hasil koleksi yang sama, sehingga angka pada judul
 * tidak mungkin berbeda dengan panjang daftar di bawahnya.
 */
export function renderTemplate(
  key: WhatsAppTemplateKey,
  template: WhatsAppTemplate,
  context: TemplateContext,
): string {
  return renderMessage(key, template, context).text
}

/**
 * Merender template SEKALIGUS mengumpulkan JID mention yang menyertainya.
 *
 * TEMPLATE ADMIN ADALAH SUMBER KEBENARAN BAGI MENTION.
 *
 * JID hanya ikut bila format item yang disimpan admin benar-benar memuat
 * `{{tag_guru_pengajar}}`. Tanpa itu, teks pesan tidak menyebut guru mana pun,
 * dan memanggil mereka lewat metadata berarti memberi notifikasi pribadi atas
 * kalimat yang tidak pernah menyebut namanya.
 *
 * Posisi placeholder tidak pernah diasumsikan: ia diganti seperti variabel item
 * biasa, sehingga admin bebas menaruhnya di awal, tengah, atau akhir baris.
 */
export function renderMessage(
  key: WhatsAppTemplateKey,
  template: WhatsAppTemplate,
  context: TemplateContext,
): RenderedMessage {
  const values: Record<string, string> = { ...context.scalars }
  const mentions: string[] = []

  for (const collection of collectionsFor(key)) {
    const item = template.items[collection]
    const rows = context.collections[collection] ?? []
    if (!item) {
      values[collection] = ""
      continue
    }

    // Mention hanya disusun bila formatnya memang memintanya. Pemeriksaan
    // dilakukan atas nama placeholder yang SUDAH terdaftar, bukan atas teks
    // bebas, sehingga tulisan "@62…" yang diketik admin tidak ikut terhitung.
    const jidRows = context.mentions?.[collection]
    const wanted = placeholdersIn(item.format).includes(TEACHER_TAG_PLACEHOLDER)

    const renderRows = rows.map((row, index) => {
      if (!wanted) return row
      // Baris yang SUDAH membawa nilainya sendiri dipakai apa adanya. Inilah
      // jalur pratinjau: ia memperlihatkan bentuk mention dengan data contoh
      // tanpa pernah menyusun JID sungguhan, sehingga tidak ada jalur dari
      // layar penyuntingan menuju pemanggilan orang.
      if (Object.prototype.hasOwnProperty.call(row, TEACHER_TAG_PLACEHOLDER)) return row
      const jids = jidRows?.[index] ?? []
      for (const jid of jids) if (!mentions.includes(jid)) mentions.push(jid)
      // Tanpa data jadwal, tag menjadi kosong — BUKAN token mentah. Pesan yang
      // memperlihatkan `{{tag_guru_pengajar}}` di grup jauh lebih merusak
      // daripada baris kelas tanpa mention.
      return { ...row, [TEACHER_TAG_PLACEHOLDER]: jids.map(mentionText).join(" ") }
    })

    // Tag yang kosong meninggalkan bekas spasi di tempat ia berdiri —
    // "7B  (kurang 5 anak)" atau spasi menggantung di ujung baris. Bekas itu
    // dirapikan HANYA pada daftar yang memakai tag, sehingga daftar lain tetap
    // tampil persis seperti yang ditulis admin.
    values[collection] = wanted
      ? tidyItemSpacing(
          renderCollection(item.format, item.separator, renderRows),
          item.format.trimStart().startsWith(`{{${TEACHER_TAG_PLACEHOLDER}}}`),
        )
      : renderCollection(item.format, item.separator, renderRows)
  }

  for (const section of sectionsFor(key)) {
    const rows = context.collections[section.list] ?? []
    const heading = `*${section.heading} — ${rows.length}*`
    const list = values[section.list] ?? ""
    // Daftar kosong tidak menambah baris apa pun: judul berdiri sendiri.
    // Inilah yang membuat `*ALFA — 0*` muncul tanpa bullet palsu di bawahnya.
    values[section.section] = list.length > 0 ? `${heading}\n${list}` : heading
  }

  return { text: normalizeBlankLines(renderText(template.body, values)), mentions }
}

/**
 * Membuang bekas spasi yang ditinggalkan variabel item bernilai kosong.
 *
 * Hanya spasi HORIZONTAL yang disentuh, dan hanya yang berlipat atau berada di
 * ujung baris. Baris, pemisah antar-item, dan isi teks tidak pernah berubah.
 */
function tidyItemSpacing(text: string, trimLineStart: boolean): string {
  return text
    .split("\n")
    .map((line) => {
      const tidied = line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "")
      // Indentasi yang sengaja ditulis admin di awal format item dipertahankan;
      // hanya format yang MEMBUKA dengan tag yang boleh kehilangan spasi depan,
      // karena di situ spasi itu jelas bekas tag yang kosong.
      return trimLineStart ? tidied.replace(/^[ \t]+/, "") : tidied
    })
    .join("\n")
}

/**
 * Merapikan baris kosong berlebih.
 *
 * Template bawaan memberi satu baris kosong antar-bagian. Ketika placeholder
 * yang berdiri sendiri pada satu baris menghasilkan teks kosong — terutama
 * `{{catatan_kelas_belum_rekap}}` saat seluruh kelas sudah merekap — baris itu
 * menyisakan celah ganda atau ekor baris kosong. Di WhatsApp celah semacam itu
 * terlihat seperti pesan yang terpotong.
 *
 * Yang dilakukan hanya dua: rentetan tiga baris baru atau lebih dipadatkan
 * menjadi satu baris kosong, dan ekor spasi dibuang. Baris kosong TUNGGAL yang
 * sengaja ditulis admin tetap dipertahankan.
 */
function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trimEnd()
}
