import { parseDelimitedText } from "@/lib/csv"

// ---------- Prefix / sapaan ----------
// Daftar awal; admin dapat menambahkan nilai baru lewat combobox.
export const defaultPrefixOptions: string[] = [
  "Bpk.",
  "Ibu",
  "Mr.",
  "Mrs.",
  "Dr.",
  "Ust.",
  "Ustazah",
]

// ---------- Helper format ----------

// NIP hanya angka; dipertahankan sebagai string agar nol depan tidak hilang.
export function sanitizeNip(value: string): string {
  return value.replace(/\D/g, "")
}

// Rapikan spasi berlebih pada nama (tanpa mengubah kapitalisasi).
export function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

// Normalisasi nomor telepon untuk disimpan: hapus spasi & tanda hubung.
export function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, "")
}

// Format nomor Indonesia: 08xxxxxxxxxx atau +62xxxxxxxxxx (9-15 digit inti).
const PHONE_PATTERN = /^(\+62|62|0)8\d{7,13}$/

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(normalizePhone(value))
}

// NIP: minimal 1 digit, hanya angka (tidak dibatasi ketat panjangnya).
export function isValidNipFormat(nip: string): boolean {
  return /^\d+$/.test(nip.trim())
}

// Preview nama dengan prefix, mis. "Bpk. Ahmad Santoso".
export function previewName(prefix: string, nama: string): string {
  const p = prefix.trim()
  const n = cleanName(nama)
  return [p, n].filter(Boolean).join(" ")
}

export function splitPrefixedName(value: string): { prefix: string; name: string } {
  const normalized = cleanName(value)
  const prefix = [...defaultPrefixOptions]
    .sort((a, b) => b.length - a.length)
    .find((option) => normalized.toLowerCase().startsWith(`${option.toLowerCase()} `))
  if (!prefix) return { prefix: "", name: normalized }
  return { prefix: normalized.slice(0, prefix.length), name: normalized.slice(prefix.length).trim() }
}

// ---------- Validasi form ----------

export type GuruErrors = {
  nip?: string
  email?: string
  nama?: string
  telepon?: string
  password?: string
  konfirmasi?: string
}

export function validateGuru(values: {
  nip: string
  email: string
  nama: string
  telepon: string
  password: string
  konfirmasi: string
}, registered: RegisteredGuruIdentifiers = EMPTY_REGISTERED_GURU): GuruErrors {
  const errors: GuruErrors = {}
  const nip = values.nip.trim()
  const email = values.email.trim().toLowerCase()
  const nama = values.nama.trim()
  const telepon = values.telepon.trim()

  if (!nip && !email) {
    errors.nip = "Isi minimal salah satu NIP atau email"
    errors.email = "Isi minimal salah satu NIP atau email"
  } else if (nip && !isValidNipFormat(nip)) {
    errors.nip = "NIP hanya boleh berisi angka"
  } else if (nip && registered.nip[nip]) {
    errors.nip = "NIP sudah terdaftar"
  }

  if (email && !isValidEmail(email)) {
    errors.email = "Format email tidak valid"
  } else if (email && registered.email[email]) {
    errors.email = "Email sudah terdaftar"
  }

  if (!nama) {
    errors.nama = "Nama lengkap wajib diisi"
  }

  if (telepon && !isValidPhone(telepon)) {
    errors.telepon = "Format nomor telepon tidak valid"
  }

  if (!values.password) {
    errors.password = "Password wajib diisi"
  } else if (values.password.length < 8) {
    errors.password = "Password minimal 8 karakter"
  }

  if (values.password && values.konfirmasi !== values.password) {
    errors.konfirmasi = "Konfirmasi password tidak sama"
  }

  return errors
}

// ---------- Impor CSV ----------

export type RegisteredGuruIdentifiers = {
  nip: Record<string, string>
  email: Record<string, string>
}

export const EMPTY_REGISTERED_GURU: RegisteredGuruIdentifiers = { nip: {}, email: {} }

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export const GURU_CSV_HEADERS = [
  "nip",
  "email",
  "sapaan",
  "nama_lengkap",
  "nomor_telepon",
  "password",
] as const

const LEGACY_GURU_CSV_HEADERS = ["nip", "sapaan", "nama_lengkap", "nomor_telepon", "password"] as const

export type GuruCsvRowStatus =
  | "valid"
  | "nip_terdaftar"
  | "identifier_kosong"
  | "nip_tidak_valid"
  | "nip_duplikat_file"
  | "email_terdaftar"
  | "email_tidak_valid"
  | "email_duplikat_file"
  | "nama_kosong"
  | "telepon_tidak_valid"
  | "password_kosong"
  | "password_lemah"

export type GuruCsvRow = {
  baris: number
  nip: string
  email: string
  sapaan: string
  nama: string
  telepon: string
  password: string
  status: GuruCsvRowStatus
}

export type GuruCsvParseResult =
  | { ok: false; error: "empty" | "header"; headerFound?: string }
  | {
      ok: true
      rows: GuruCsvRow[]
      valid: number
      duplicateDb: number
      problem: number
      total: number
    }

export function parseGuruCsv(
  text: string,
  registered: RegisteredGuruIdentifiers = EMPTY_REGISTERED_GURU,
  delimiter = ",",
): GuruCsvParseResult {
  const records = parseDelimitedText(text, delimiter)

  if (records.length === 0) {
    return { ok: false, error: "empty" }
  }

  const header = records[0].map((h) => h.trim().toLowerCase())
  const headerMatches = header.length >= GURU_CSV_HEADERS.length && GURU_CSV_HEADERS.every((h, i) => header[i] === h)
  const legacyHeaderMatches = header.length >= LEGACY_GURU_CSV_HEADERS.length && LEGACY_GURU_CSV_HEADERS.every((h, i) => header[i] === h)

  if (!headerMatches && !legacyHeaderMatches) {
    return { ok: false, error: "header", headerFound: records[0].join(delimiter) }
  }

  const dataRecords = records.slice(1)
  if (dataRecords.length === 0) {
    return { ok: false, error: "empty" }
  }

  // Hitung kemunculan identitas untuk deteksi duplikat di dalam file.
  const nipSeen = new Map<string, number>()
  const emailSeen = new Map<string, number>()
  for (const cells of dataRecords) {
    const nip = (cells[0] ?? "").trim()
    const email = headerMatches ? (cells[1] ?? "").trim().toLowerCase() : ""
    if (nip) nipSeen.set(nip, (nipSeen.get(nip) ?? 0) + 1)
    if (email) emailSeen.set(email, (emailSeen.get(email) ?? 0) + 1)
  }

  const rows: GuruCsvRow[] = dataRecords.map((cells, index) => {
    const nip = (cells[0] ?? "").trim()
    const email = headerMatches ? (cells[1] ?? "").trim().toLowerCase() : ""
    const offset = headerMatches ? 1 : 0
    const sapaan = (cells[1 + offset] ?? "").trim()
    const nama = (cells[2 + offset] ?? "").trim()
    const telepon = (cells[3 + offset] ?? "").trim()
    const password = (cells[4 + offset] ?? "").trim()
    const baris = index + 2 // baris 1 adalah header

    let status: GuruCsvRowStatus = "valid"
    if (!nip && !email) {
      status = "identifier_kosong"
    } else if (nip && !isValidNipFormat(nip)) {
      status = "nip_tidak_valid"
    } else if (nip && (nipSeen.get(nip) ?? 0) > 1) {
      status = "nip_duplikat_file"
    } else if (nip && registered.nip[nip]) {
      status = "nip_terdaftar"
    } else if (email && !isValidEmail(email)) {
      status = "email_tidak_valid"
    } else if (email && (emailSeen.get(email) ?? 0) > 1) {
      status = "email_duplikat_file"
    } else if (email && registered.email[email]) {
      status = "email_terdaftar"
    } else if (!nama) {
      status = "nama_kosong"
    } else if (telepon && !isValidPhone(telepon)) {
      status = "telepon_tidak_valid"
    } else if (!password) {
      status = "password_kosong"
    } else if (password.length < 8) {
      status = "password_lemah"
    }

    return { baris, nip, email, sapaan, nama, telepon, password, status }
  })

  const valid = rows.filter((r) => r.status === "valid").length
  const duplicateDb = rows.filter((r) => r.status === "nip_terdaftar" || r.status === "email_terdaftar").length
  const problem = rows.length - valid - duplicateDb

  return {
    ok: true,
    rows,
    valid,
    duplicateDb,
    problem,
    total: rows.length,
  }
}

export const guruCsvStatusMeta: Record<
  GuruCsvRowStatus,
  { label: string; tone: "valid" | "skip" | "error" }
> = {
  valid: { label: "Valid", tone: "valid" },
  nip_terdaftar: { label: "NIP sudah terdaftar", tone: "skip" },
  identifier_kosong: { label: "NIP/email kosong", tone: "error" },
  nip_tidak_valid: { label: "NIP tidak valid", tone: "error" },
  nip_duplikat_file: { label: "NIP duplikat di file", tone: "error" },
  email_terdaftar: { label: "Email sudah terdaftar", tone: "skip" },
  email_tidak_valid: { label: "Email tidak valid", tone: "error" },
  email_duplikat_file: { label: "Email duplikat di file", tone: "error" },
  nama_kosong: { label: "Nama lengkap kosong", tone: "error" },
  telepon_tidak_valid: { label: "Nomor telepon tidak valid", tone: "error" },
  password_kosong: { label: "Password kosong", tone: "error" },
  password_lemah: { label: "Password kurang dari 8 karakter", tone: "error" },
}

export const GURU_CSV_TEMPLATE = `nip,email,sapaan,nama_lengkap,nomor_telepon,password
199203112018012005,,Ibu,Dewi Lestari,,rahasia123
,rudi.hartono@sekolah.sch.id,Bpk.,Rudi Hartono,081234567802,gurubaru88
199508162020122007,siti.aminah@sekolah.sch.id,Ustazah,Siti Aminah,,sekolah2024`
