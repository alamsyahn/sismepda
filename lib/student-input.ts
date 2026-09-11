import { parseDelimitedText } from "@/lib/csv"

const NISN_PATTERN = /^\d{10}$/
const NIS_PATTERN = /^\d+$/

export function isValidNisFormat(nis: string): boolean {
  return NIS_PATTERN.test(nis.trim())
}

export function isValidNisnFormat(nisn: string): boolean {
  return NISN_PATTERN.test(nisn.trim())
}

// ---------- Demografi (tanggal lahir & jenis kelamin) ----------

export const GENDER_VALUES = ["LAKI_LAKI", "PEREMPUAN"] as const
export type GenderValue = (typeof GENDER_VALUES)[number]

export const genderLabels: Record<GenderValue, string> = {
  LAKI_LAKI: "Laki-laki",
  PEREMPUAN: "Perempuan",
}

/**
 * Terima penulisan jenis kelamin yang lazim dipakai operator sekolah pada file
 * CSV (L/P, "Laki-laki", "Perempuan") dan kembalikan nilai enum.
 * Mengembalikan null untuk input kosong, dan undefined bila tidak dikenali —
 * dua hal berbeda: kosong itu sah, tidak dikenali itu galat.
 */
export function parseGender(value: string): GenderValue | null | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (!normalized) return null
  if (["l", "lk", "lakilaki", "pria", "male", "m"].includes(normalized)) return "LAKI_LAKI"
  if (["p", "pr", "perempuan", "wanita", "female", "f"].includes(normalized)) return "PEREMPUAN"
  return undefined
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/

/**
 * Terima YYYY-MM-DD (format input date HTML) maupun DD/MM/YYYY yang umum
 * dipakai di Indonesia, dan kembalikan bentuk baku YYYY-MM-DD.
 * Tanggal yang tidak ada di kalender (mis. 31/02) ditolak, bukan digeser.
 */
export function parseBirthDate(value: string): string | null | undefined {
  const trimmed = value.trim()
  if (!trimmed) return null

  let year: number
  let month: number
  let day: number

  const iso = ISO_DATE.exec(trimmed)
  const local = LOCAL_DATE.exec(trimmed)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else if (local) {
    day = Number(local[1])
    month = Number(local[2])
    year = Number(local[3])
  } else {
    return undefined
  }

  const date = new Date(Date.UTC(year, month - 1, day))
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  if (!valid) return undefined

  const pad = (input: number) => String(input).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}`
}

// ---------- Validasi form manual ----------

export type ManualErrors = {
  nis?: string
  nisn?: string
  nama?: string
  kelas?: string
  tanggalLahir?: string
  jenisKelamin?: string
}

export function validateManual(values: {
  nis: string
  nisn: string
  nama: string
  kelas: string
  tanggalLahir?: string
  jenisKelamin?: string
}, classOptions: string[] = [], registered: RegisteredStudentIdentifiers = EMPTY_REGISTERED_STUDENT): ManualErrors {
  const errors: ManualErrors = {}
  const nis = values.nis.trim()
  const nisn = values.nisn.trim()
  const nama = values.nama.trim()

  if (!nis && !nisn) {
    errors.nis = "Isi minimal salah satu NIS atau NISN"
    errors.nisn = "Isi minimal salah satu NIS atau NISN"
  } else if (nis && !isValidNisFormat(nis)) {
    errors.nis = "NIS hanya boleh berisi angka"
  } else if (nis && registered.nis[nis]) {
    errors.nis = "NIS sudah terdaftar pada siswa lain"
  }

  if (nisn && !isValidNisnFormat(nisn)) {
    errors.nisn = "NISN harus terdiri dari 10 digit angka"
  } else if (nisn && registered.nisn[nisn]) {
    errors.nisn = "NISN sudah terdaftar pada siswa lain"
  }

  if (!nama) {
    errors.nama = "Nama lengkap wajib diisi"
  }

  if (!values.kelas) {
    errors.kelas = "Kelas wajib dipilih"
  } else if (!classOptions.some((item) => item.toLowerCase() === values.kelas.toLowerCase())) {
    errors.kelas = "Kelas tidak ditemukan"
  }

  // Keduanya opsional: hanya divalidasi bila diisi.
  if (values.tanggalLahir) {
    const parsed = parseBirthDate(values.tanggalLahir)
    if (parsed === undefined) {
      errors.tanggalLahir = "Tanggal lahir tidak valid"
    } else if (parsed !== null && parsed > new Date().toISOString().slice(0, 10)) {
      errors.tanggalLahir = "Tanggal lahir tidak boleh di masa depan"
    }
  }

  if (values.jenisKelamin && parseGender(values.jenisKelamin) === undefined) {
    errors.jenisKelamin = "Jenis kelamin tidak dikenali"
  }

  return errors
}

// ---------- Parsing & validasi CSV ----------

export type RegisteredStudentIdentifiers = {
  nis: Record<string, RegisteredStudent>
  nisn: Record<string, RegisteredStudent>
}

export type RegisteredStudent = {
  id: string
  nis: string | null
  nisn: string | null
  name: string
}

export const EMPTY_REGISTERED_STUDENT: RegisteredStudentIdentifiers = { nis: {}, nisn: {} }

export function buildRegisteredStudentIdentifiers(students: RegisteredStudent[]): RegisteredStudentIdentifiers {
  return {
    nis: Object.fromEntries(students.filter((student) => student.nis).map((student) => [student.nis, student])),
    nisn: Object.fromEntries(students.filter((student) => student.nisn).map((student) => [student.nisn, student])),
  }
}

export type CsvImportBehavior = "skip" | "update"

export const CSV_HEADERS = ["nis", "nisn", "nama_lengkap", "kelas"] as const
const LEGACY_CSV_HEADERS = ["nisn", "nama_lengkap", "kelas"] as const

/**
 * Kolom demografi bersifat opsional dan dicari berdasarkan NAMA header, bukan
 * posisi, sehingga file CSV lama yang hanya memuat empat kolom wajib tetap
 * terbaca tanpa perubahan.
 */
export const OPTIONAL_CSV_HEADERS = ["tanggal_lahir", "jenis_kelamin"] as const

export type CsvRowStatus =
  | "valid"
  | "tanggal_lahir_tidak_valid"
  | "jenis_kelamin_tidak_valid"
  | "update_nisn"
  | "update_nis"
  | "identifier_conflict"
  | "identifier_kosong"
  | "nis_terdaftar"
  | "nis_tidak_valid"
  | "nis_duplikat_file"
  | "nisn_terdaftar"
  | "nisn_tidak_valid"
  | "nisn_duplikat_file"
  | "nama_kosong"
  | "kelas_kosong"
  | "kelas_tidak_ditemukan"

export type CsvRow = {
  baris: number
  nis: string
  nisn: string
  nama: string
  kelas: string
  /** Sudah dibakukan ke YYYY-MM-DD; null bila kolom kosong/tidak ada. */
  tanggalLahir: string | null
  jenisKelamin: GenderValue | null
  status: CsvRowStatus
}

export type CsvParseResult =
  | { ok: false; error: "empty" | "header" ; headerFound?: string }
  | {
      ok: true
      rows: CsvRow[]
      valid: number
      update: number
      ready: number
      duplicateDb: number
      problem: number
      total: number
    }

export function parseCsv(
  text: string,
  classOptions: string[] = [],
  registered: RegisteredStudentIdentifiers = EMPTY_REGISTERED_STUDENT,
  delimiter = ",",
  behavior: CsvImportBehavior = "skip",
): CsvParseResult {
  const records = parseDelimitedText(text, delimiter)

  if (records.length === 0) {
    return { ok: false, error: "empty" }
  }

  const header = records[0].map((h) => h.trim().toLowerCase())
  const headerMatches = header.length >= CSV_HEADERS.length && CSV_HEADERS.every((item, index) => header[index] === item)
  const legacyHeaderMatches = header.length >= LEGACY_CSV_HEADERS.length && LEGACY_CSV_HEADERS.every((item, index) => header[index] === item)

  if (!headerMatches && !legacyHeaderMatches) {
    return { ok: false, error: "header", headerFound: records[0].join(delimiter) }
  }

  // Indeks kolom opsional dicari lewat nama header agar file lama tetap sah.
  const birthDateIndex = header.indexOf("tanggal_lahir")
  const genderIndex = header.indexOf("jenis_kelamin")

  const dataRecords = records.slice(1)
  if (dataRecords.length === 0) {
    return { ok: false, error: "empty" }
  }

  // Hitung kemunculan NIS/NISN untuk deteksi duplikat di dalam file.
  const nisSeen = new Map<string, number>()
  const nisnSeen = new Map<string, number>()
  for (const cells of dataRecords) {
    const nis = headerMatches ? (cells[0] ?? "").trim() : ""
    const nisn = (cells[headerMatches ? 1 : 0] ?? "").trim()
    if (nis) nisSeen.set(nis, (nisSeen.get(nis) ?? 0) + 1)
    if (nisn) nisnSeen.set(nisn, (nisnSeen.get(nisn) ?? 0) + 1)
  }

  const rows: CsvRow[] = dataRecords.map((cells, index) => {
    const offset = headerMatches ? 1 : 0
    const nis = headerMatches ? (cells[0] ?? "").trim() : ""
    const nisn = (cells[offset] ?? "").trim()
    const nama = (cells[1 + offset] ?? "").trim()
    const kelas = (cells[2 + offset] ?? "").trim()
    const baris = index + 2 // baris 1 adalah header
    const nisnMatch = nisn ? registered.nisn[nisn] : undefined
    const nisMatch = nis ? registered.nis[nis] : undefined

    const rawBirthDate = birthDateIndex >= 0 ? (cells[birthDateIndex] ?? "").trim() : ""
    const rawGender = genderIndex >= 0 ? (cells[genderIndex] ?? "").trim() : ""
    const parsedBirthDate = parseBirthDate(rawBirthDate)
    const parsedGender = parseGender(rawGender)

    let status: CsvRowStatus = "valid"
    if (!nis && !nisn) {
      status = "identifier_kosong"
    } else if (nis && !isValidNisFormat(nis)) {
      status = "nis_tidak_valid"
    } else if (nis && (nisSeen.get(nis) ?? 0) > 1) {
      status = "nis_duplikat_file"
    } else if (nisn && !isValidNisnFormat(nisn)) {
      status = "nisn_tidak_valid"
    } else if (nisn && (nisnSeen.get(nisn) ?? 0) > 1) {
      status = "nisn_duplikat_file"
    } else if (nisnMatch && nisMatch && nisnMatch.id !== nisMatch.id) {
      status = "identifier_conflict"
    } else if (!nama) {
      status = "nama_kosong"
    } else if (!kelas) {
      status = "kelas_kosong"
    } else if (!classOptions.some((item) => item.toLowerCase() === kelas.toLowerCase())) {
      status = "kelas_tidak_ditemukan"
    } else if (parsedBirthDate === undefined) {
      status = "tanggal_lahir_tidak_valid"
    } else if (parsedGender === undefined) {
      status = "jenis_kelamin_tidak_valid"
    } else if (nisnMatch || nisMatch) {
      status = behavior === "skip"
        ? (nisnMatch ? "nisn_terdaftar" : "nis_terdaftar")
        : (nisnMatch ? "update_nisn" : "update_nis")
    }

    return {
      baris,
      nis,
      nisn,
      nama,
      kelas,
      tanggalLahir: parsedBirthDate ?? null,
      jenisKelamin: parsedGender ?? null,
      status,
    }
  })

  const valid = rows.filter((r) => r.status === "valid").length
  const update = rows.filter((r) => r.status === "update_nisn" || r.status === "update_nis").length
  const duplicateDb = rows.filter((r) => r.status === "nis_terdaftar" || r.status === "nisn_terdaftar").length
  const problem = rows.length - valid - update - duplicateDb

  return {
    ok: true,
    rows,
    valid,
    update,
    ready: valid + update,
    duplicateDb,
    problem,
    total: rows.length,
  }
}

export const csvStatusMeta: Record<
  CsvRowStatus,
  { label: string; tone: "valid" | "update" | "skip" | "error" }
> = {
  valid: { label: "Siswa baru", tone: "valid" },
  update_nisn: { label: "Akan diperbarui (NISN)", tone: "update" },
  update_nis: { label: "Akan diperbarui (NIS)", tone: "update" },
  identifier_conflict: { label: "Konflik NIS dan NISN", tone: "error" },
  identifier_kosong: { label: "NIS/NISN kosong", tone: "error" },
  nis_terdaftar: { label: "NIS sudah terdaftar", tone: "skip" },
  nis_tidak_valid: { label: "NIS tidak valid", tone: "error" },
  nis_duplikat_file: { label: "NIS duplikat di file", tone: "error" },
  nisn_terdaftar: { label: "NISN sudah terdaftar", tone: "skip" },
  nisn_tidak_valid: { label: "NISN tidak valid", tone: "error" },
  nisn_duplikat_file: { label: "NISN duplikat di file", tone: "error" },
  nama_kosong: { label: "Nama lengkap kosong", tone: "error" },
  kelas_kosong: { label: "Kelas kosong", tone: "error" },
  kelas_tidak_ditemukan: { label: "Kelas tidak ditemukan", tone: "error" },
  tanggal_lahir_tidak_valid: { label: "Tanggal lahir tidak valid", tone: "error" },
  jenis_kelamin_tidak_valid: { label: "Jenis kelamin tidak dikenali", tone: "error" },
}

// Kolom tanggal_lahir dan jenis_kelamin opsional: baris tetap sah bila kosong.
export const CSV_TEMPLATE = `nis,nisn,nama_lengkap,kelas,tanggal_lahir,jenis_kelamin
1001,0090001111,Ahmad Fauzan,VII A,2013-05-17,L
1002,,Aisyah Putri Ramadhani,VII A,2013-11-02,P
,0090003333,Bagas Aditya Pratama,VII B,,`
