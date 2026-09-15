/**
 * Aturan murni untuk data uji (synthetic) E-UKS khusus development/local.
 *
 * Tidak ada import Prisma di sini supaya:
 * 1. seluruh guard keselamatan dapat diuji sebagai fungsi murni, dan
 * 2. keputusan "boleh menulis atau tidak" diambil SEBELUM koneksi database
 *    dibuka — persis pola `lib/local-test-user.ts`.
 *
 * Setiap guard fail-closed: nilai yang tidak dikenal, URL yang gagal diparse,
 * atau nama database di luar allowlist membatalkan seluruh proses, bukan
 * jatuh ke nilai permisif.
 */

import bmiReference from "@/lib/data/bmi-for-age-reference.json"
import heightReference from "@/lib/data/height-for-age-reference.json"
import { lmsRow, valueFromLms, type Gender } from "@/lib/lms"
import { localDatabaseHosts, localDatabaseNames } from "@/lib/local-test-user"
import {
  addSchoolDays,
  compareSchoolDates,
  requireSchoolDate,
  type SchoolDate,
} from "@/lib/school-date"

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export type EuksTestDataEnv = {
  ALLOW_EUKS_TEST_DATA?: string
  EXPECTED_DEV_DATABASE_NAME?: string
  DATABASE_URL?: string
  NODE_ENV?: string
}

export type EuksTestDataPlan = {
  databaseName: string
  databaseHost: string
}

export type EuksTestDataDecision =
  | { ok: true; plan: EuksTestDataPlan }
  | { ok: false; reason: string }

/** Prefiks pesan penolakan; sengaja seragam agar mudah dicari di log. */
export const REFUSAL_PREFIX = "REFUSED: Synthetic E-UKS generation is not allowed for this database."

function deny(reason: string): EuksTestDataDecision {
  return { ok: false, reason }
}

/**
 * Memutuskan apakah data synthetic E-UKS boleh ditulis ke database tujuan.
 *
 * Lima lapis pemeriksaan, seluruhnya wajib lolos:
 * A. `NODE_ENV` bukan `production`.
 * B. `ALLOW_EUKS_TEST_DATA` bernilai persis `"true"`.
 * C. Host `DATABASE_URL` adalah host mesin developer sendiri. Nama service
 *    Docker sengaja TIDAK diterima: seluruh deployment produksi proyek ini
 *    memakai host service Docker, sehingga menerimanya akan menghapus justru
 *    pembeda yang paling penting.
 * D. Nama database ada pada allowlist development DAN sama persis dengan
 *    `EXPECTED_DEV_DATABASE_NAME` yang wajib diisi operator.
 * E. Kegagalan apa pun di atas berarti abort tanpa satu pun penulisan.
 */
export function planEuksTestData(env: EuksTestDataEnv): EuksTestDataDecision {
  if (env.NODE_ENV === "production") {
    return deny("NODE_ENV=production: data uji E-UKS tidak boleh dibuat pada runtime produksi.")
  }

  if (env.ALLOW_EUKS_TEST_DATA !== "true") {
    return deny('ALLOW_EUKS_TEST_DATA harus bernilai persis "true" untuk mengizinkan pembuatan data uji E-UKS.')
  }

  const rawUrl = env.DATABASE_URL?.trim()
  if (!rawUrl) return deny("DATABASE_URL belum dikonfigurasi.")

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return deny("DATABASE_URL tidak dapat diparse sebagai URL. Dibatalkan tanpa penulisan apa pun.")
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return deny(`Protokol DATABASE_URL "${parsed.protocol}" bukan PostgreSQL.`)
  }

  const host = parsed.hostname.toLowerCase()
  if (!host) return deny("DATABASE_URL tidak memiliki host. Dibatalkan.")
  if (!(localDatabaseHosts as readonly string[]).includes(host)) {
    return deny(
      `Host database "${host}" bukan host lokal. Diizinkan hanya: ${localDatabaseHosts.join(", ")}.`,
    )
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).trim()
  if (!databaseName) return deny("Nama database tidak ada pada DATABASE_URL. Dibatalkan.")
  if (!(localDatabaseNames as readonly string[]).includes(databaseName)) {
    return deny(
      `Nama database "${databaseName}" bukan database development. Diizinkan hanya: ${localDatabaseNames.join(", ")}.`,
    )
  }

  const expected = env.EXPECTED_DEV_DATABASE_NAME?.trim()
  if (!expected) {
    return deny(
      "EXPECTED_DEV_DATABASE_NAME wajib diisi pada .env lokal sebagai konfirmasi eksplisit database tujuan.",
    )
  }
  if (expected !== databaseName) {
    return deny(
      `Database tujuan "${databaseName}" tidak sama dengan EXPECTED_DEV_DATABASE_NAME "${expected}".`,
    )
  }

  return { ok: true, plan: { databaseName, databaseHost: host } }
}

/**
 * Pemeriksaan lapis terakhir setelah koneksi terbuka: nama database yang
 * benar-benar dilayani server harus sama dengan yang diizinkan. Menahan kasus
 * di mana URL terbaca berbeda oleh driver (alias, tunnel, pgbouncer).
 */
export function verifyConnectedDatabase(actual: string, plan: EuksTestDataPlan): void {
  if (actual !== plan.databaseName) {
    throw new Error(
      `${REFUSAL_PREFIX} Server melayani database "${actual}", bukan "${plan.databaseName}".`,
    )
  }
}

/** Filter tunggal untuk seluruh operasi hapus; tidak pernah ditulis inline. */
export const syntheticFilter = { isSynthetic: true } as const

// ---------------------------------------------------------------------------
// RNG deterministik
// ---------------------------------------------------------------------------

/** Hash string → 32-bit, agar seed boleh berupa teks maupun angka. */
export function hashSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export type Rng = {
  /** [0,1) */
  next(): number
  /** Bilangan bulat dalam [min,max]. */
  int(min: number, max: number): number
  /** Bilangan riil dalam [min,max). */
  float(min: number, max: number): number
  /** true dengan peluang `probability`. */
  chance(probability: number): boolean
  /** Satu elemen acak. */
  pick<T>(values: readonly T[]): T
  /** Elemen berbobot; bobot tidak perlu berjumlah 1. */
  weighted<T>(entries: readonly { value: T; weight: number }[]): T
  /** Normal(mean, sd) lewat transformasi Box-Muller. */
  normal(mean: number, sd: number): number
}

/**
 * mulberry32 — PRNG kecil, cepat, dan stabil lintas versi Node. Dipakai
 * sendirian: tidak ada satu pun `Math.random()` pada jalur generasi, sehingga
 * seed yang sama selalu menghasilkan dataset yang sama.
 */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "number" ? seed >>> 0 : hashSeed(seed)) || 1

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: (values) => values[Math.floor(next() * values.length)],
    weighted: (entries) => {
      const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0)
      let threshold = next() * total
      for (const entry of entries) {
        threshold -= Math.max(0, entry.weight)
        if (threshold <= 0) return entry.value
      }
      return entries[entries.length - 1].value
    },
    normal: (mean, sd) => {
      const u = Math.max(next(), 1e-12)
      const v = next()
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
  }
  return rng
}

/** Seed acak untuk dicetak pada ringkasan agar dataset bisa direproduksi. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/** Menerima `--seed=123`, `--seed 123`, angka maupun teks. */
export function parseSeedArgument(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith("--seed=")) return arg.slice("--seed=".length).trim() || null
    if (arg === "--seed") return argv[index + 1]?.trim() || null
  }
  return null
}

// ---------------------------------------------------------------------------
// Katalog keluhan → tindakan
// ---------------------------------------------------------------------------

/**
 * Keluhan khas siswa SMP beserta tindakan yang memang sesuai dengan keluhan
 * itu. Tindakan tidak pernah diacak lintas keluhan: "dikompres hangat" tidak
 * boleh muncul untuk luka lecet, dan tablet tambah darah hanya untuk keluhan
 * yang relevan pada siswa perempuan.
 */
export type ComplaintTemplate = {
  label: string
  weight: number
  /** Batasan jenis kelamin bila keluhan memang spesifik. */
  gender?: Gender
  treatments: readonly string[]
  /** Peluang keluhan berlanjut ke tindak lanjut (dipulangkan, rujuk, dsb). */
  followUpChance: number
  followUps: readonly string[]
}

export const complaintCatalog: readonly ComplaintTemplate[] = [
  {
    label: "Pusing",
    weight: 20,
    treatments: ["Istirahat di UKS", "Minum air putih dan istirahat", "Diberi minyak kayu putih", "Pengukuran tekanan darah"],
    followUpChance: 0.18,
    followUps: ["Diizinkan kembali ke kelas setelah membaik", "Dipulangkan dengan izin wali kelas"],
  },
  {
    label: "Sakit kepala",
    weight: 14,
    treatments: ["Istirahat di UKS", "Kompres dingin di dahi", "Diberi parasetamol sesuai dosis"],
    followUpChance: 0.16,
    followUps: ["Diizinkan kembali ke kelas setelah membaik", "Orang tua dihubungi"],
  },
  {
    label: "Sakit perut",
    weight: 16,
    treatments: ["Istirahat di UKS", "Dikompres hangat pada perut", "Diberi air hangat", "Diberi obat maag sesuai dosis"],
    followUpChance: 0.2,
    followUps: ["Disarankan sarapan sebelum berangkat", "Dipulangkan dengan izin wali kelas"],
  },
  {
    label: "Mual",
    weight: 10,
    treatments: ["Istirahat di UKS", "Diberi air hangat", "Diberi minyak kayu putih"],
    followUpChance: 0.18,
    followUps: ["Diizinkan kembali ke kelas setelah membaik", "Orang tua dihubungi"],
  },
  {
    label: "Lemas",
    weight: 11,
    treatments: ["Istirahat di UKS", "Diberi air gula hangat", "Pengukuran tekanan darah"],
    followUpChance: 0.22,
    followUps: ["Disarankan sarapan sebelum berangkat", "Dipulangkan dengan izin wali kelas"],
  },
  {
    label: "Demam",
    weight: 9,
    treatments: ["Pengukuran suhu tubuh", "Kompres hangat", "Diberi parasetamol sesuai dosis"],
    followUpChance: 0.62,
    followUps: ["Dipulangkan dengan izin wali kelas", "Orang tua dihubungi", "Disarankan periksa ke puskesmas"],
  },
  {
    label: "Batuk pilek",
    weight: 9,
    treatments: ["Istirahat di UKS", "Diberi air hangat", "Diberi masker"],
    followUpChance: 0.2,
    followUps: ["Diizinkan kembali ke kelas setelah membaik", "Disarankan periksa ke puskesmas"],
  },
  {
    label: "Luka lecet",
    weight: 8,
    treatments: ["Luka dibersihkan dan diberi antiseptik", "Ditutup plester", "Perawatan luka ringan"],
    followUpChance: 0.1,
    followUps: ["Diizinkan kembali ke kelas setelah membaik", "Disarankan kontrol luka esok hari"],
  },
  {
    label: "Terkilir",
    weight: 4,
    treatments: ["Kompres dingin pada area cedera", "Istirahat di UKS", "Dipasang perban elastis"],
    followUpChance: 0.35,
    followUps: ["Disarankan periksa ke puskesmas", "Orang tua dihubungi"],
  },
  {
    label: "Mimisan",
    weight: 3,
    treatments: ["Duduk menunduk dan hidung ditekan", "Kompres dingin di pangkal hidung", "Istirahat di UKS"],
    followUpChance: 0.12,
    followUps: ["Diizinkan kembali ke kelas setelah membaik"],
  },
  {
    label: "Sakit gigi",
    weight: 3,
    treatments: ["Kumur air garam hangat", "Diberi parasetamol sesuai dosis"],
    followUpChance: 0.3,
    followUps: ["Disarankan periksa ke puskesmas", "Orang tua dihubungi"],
  },
  {
    label: "Maag",
    weight: 5,
    treatments: ["Diberi obat maag sesuai dosis", "Istirahat di UKS", "Diberi air hangat"],
    followUpChance: 0.24,
    followUps: ["Disarankan sarapan sebelum berangkat", "Dipulangkan dengan izin wali kelas"],
  },
  {
    label: "Nyeri haid",
    weight: 12,
    gender: "PEREMPUAN",
    treatments: ["Istirahat di UKS", "Dikompres hangat pada perut", "Diberi air hangat"],
    followUpChance: 0.3,
    followUps: ["Diizinkan kembali ke kelas setelah membaik", "Dipulangkan dengan izin wali kelas"],
  },
  {
    label: "Anemia ringan",
    weight: 4,
    gender: "PEREMPUAN",
    treatments: ["Diberi tablet tambah darah", "Istirahat di UKS", "Pengukuran tekanan darah"],
    followUpChance: 0.45,
    followUps: ["Disarankan periksa ke puskesmas", "Dipantau pada pemberian tablet tambah darah berikutnya"],
  },
]

/** Keluhan yang boleh muncul untuk satu siswa; jenis kelamin dipatuhi. */
export function complaintsForGender(gender: Gender | null): ComplaintTemplate[] {
  return complaintCatalog.filter((template) => !template.gender || template.gender === gender)
}

// ---------------------------------------------------------------------------
// Profil siswa synthetic
// ---------------------------------------------------------------------------

export type StudentSeedInput = {
  /** "VII" | "VIII" | "IX" seperti tersimpan pada SchoolClass.grade. */
  grade: string
  gender: Gender | null
  birthDate: SchoolDate | null
}

export type StudentDemographics = {
  gender: Gender
  birthDate: SchoolDate
  /** true bila nilai ini baru dibuat generator (bukan data asli yang sudah ada). */
  generatedGender: boolean
  generatedBirthDate: boolean
}

const gradeAgeYears: Record<string, number> = { VII: 12, VIII: 13, IX: 14 }

/**
 * Melengkapi demografi yang masih kosong. Nilai asli tidak pernah ditimpa:
 * kalau `gender`/`birthDate` sudah terisi, nilainya dipakai apa adanya dan
 * ditandai bukan hasil generator sehingga `euks:clear:*` tidak menyentuhnya.
 */
export function planDemographics(
  rng: Rng,
  input: StudentSeedInput,
  referenceDate: SchoolDate,
): StudentDemographics {
  // Undian selalu ditarik, bahkan ketika nilainya nanti tidak dipakai. Dengan
  // begitu jumlah angka yang dikonsumsi RNG tidak bergantung pada seberapa
  // lengkap data siswa, sehingga seed yang sama tetap menghasilkan dataset yang
  // sama meski sebagian siswa sudah punya gender/tanggal lahir asli.
  const drawnGender: Gender = rng.chance(0.5) ? "LAKI_LAKI" : "PEREMPUAN"
  const baseAge = gradeAgeYears[input.grade.trim().toUpperCase()] ?? 13
  const year = Number(referenceDate.slice(0, 4)) - baseAge - rng.int(0, 1)
  const month = rng.int(1, 12)
  const day = rng.int(1, 28)
  const drawnBirthDate = requireSchoolDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  )

  const gender: Gender = input.gender ?? drawnGender
  const birthDate = input.birthDate ?? drawnBirthDate

  return {
    gender,
    birthDate,
    generatedGender: input.gender === null,
    generatedBirthDate: input.birthDate === null,
  }
}

// ---------------------------------------------------------------------------
// Kunjungan UKS
// ---------------------------------------------------------------------------

export type PlannedVisit = {
  occurredAt: SchoolDate
  complaint: string
  treatment: string
  followUp: string | null
}

/**
 * Sebaran jumlah kunjungan per siswa. Sengaja tidak seragam: sekolah nyata
 * punya mayoritas siswa yang tidak pernah ke UKS, sebagian kecil sesekali,
 * dan segelintir "langganan" yang justru menguji halaman detail dan pagination.
 */
export const visitCountDistribution = [
  { value: 0, weight: 54 },
  { value: 1, weight: 24 },
  { value: 2, weight: 11 },
  { value: 3, weight: 5 },
  { value: 4, weight: 3 },
  { value: 6, weight: 2 },
  { value: 9, weight: 1 },
] as const

export function planVisitCount(rng: Rng): number {
  const base = rng.weighted(visitCountDistribution)
  // Kelompok "langganan" diberi variasi supaya tidak semua bernilai persis sama.
  return base >= 6 ? base + rng.int(0, 4) : base
}

/**
 * Kunjungan satu siswa. `schoolDates` sudah bebas hari libur, jadi generator
 * secara struktural tidak mungkin menaruh kunjungan pada hari sekolah libur.
 */
export function planVisits(
  rng: Rng,
  gender: Gender,
  schoolDates: readonly SchoolDate[],
): PlannedVisit[] {
  if (schoolDates.length === 0) return []
  const count = planVisitCount(rng)
  if (count === 0) return []

  const templates = complaintsForGender(gender)
  const weighted = templates.map((template) => ({ value: template, weight: template.weight }))
  // Sebagian siswa memang punya keluhan yang berulang; itulah yang membuat
  // grafik tren terlihat wajar, bukan sebaran rata.
  const recurring = rng.chance(0.45) ? rng.weighted(weighted) : null

  const used = new Set<SchoolDate>()
  const visits: PlannedVisit[] = []
  for (let index = 0; index < count; index += 1) {
    let date: SchoolDate | null = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = schoolDates[rng.int(0, schoolDates.length - 1)]
      if (!used.has(candidate)) {
        date = candidate
        break
      }
    }
    if (!date) continue
    used.add(date)

    const template = recurring && rng.chance(0.6) ? recurring : rng.weighted(weighted)
    visits.push({
      occurredAt: date,
      complaint: template.label,
      treatment: rng.pick(template.treatments),
      followUp: rng.chance(template.followUpChance) ? rng.pick(template.followUps) : null,
    })
  }

  return visits.sort((a, b) => compareSchoolDates(a.occurredAt, b.occurredAt))
}

// ---------------------------------------------------------------------------
// Pengukuran tinggi & berat
// ---------------------------------------------------------------------------

export type PlannedMeasurement = {
  measuredAt: SchoolDate
  heightCm: number
  weightKg: number
}

/**
 * Sebaran z-score IMT/U yang ditargetkan. Dipusatkan sedikit di bawah nol dan
 * diberi ekor supaya seluruh kategori Permenkes benar-benar muncul pada
 * distribusi status gizi — termasuk gizi buruk dan obesitas, yang jarang tetapi
 * harus ada agar tampilan kategorinya teruji.
 */
export function planBmiZ(rng: Rng): number {
  const roll = rng.next()
  if (roll < 0.02) return rng.float(-4, -3.05)
  if (roll < 0.09) return rng.float(-3, -2.05)
  if (roll < 0.85) return rng.float(-2, 1)
  if (roll < 0.95) return rng.float(1.02, 2)
  return rng.float(2.05, 3.6)
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10
}

function ageMonthsBetween(birthDate: SchoolDate, date: SchoolDate): number {
  const [by, bm, bd] = birthDate.split("-").map(Number)
  const [dy, dm, dd] = date.split("-").map(Number)
  let months = (dy - by) * 12 + (dm - bm)
  if (dd < bd) months -= 1
  return Math.max(0, months)
}

/** Tinggi dari kurva TB/U WHO; null bila umur di luar rentang rujukan. */
function heightFromReference(z: number, ageMonths: number, gender: Gender): number | null {
  const row = lmsRow(heightReference, ageMonths, gender)
  return row ? valueFromLms(z, row) : null
}

/** IMT dari kurva IMT/U WHO; null bila umur di luar rentang rujukan. */
function bmiFromReference(z: number, ageMonths: number, gender: Gender): number | null {
  const row = lmsRow(bmiReference, ageMonths, gender)
  return row ? valueFromLms(z, row) : null
}

export const measurementCountDistribution = [
  { value: 0, weight: 6 },
  { value: 1, weight: 12 },
  { value: 2, weight: 24 },
  { value: 3, weight: 30 },
  { value: 4, weight: 18 },
  { value: 6, weight: 10 },
] as const

/**
 * Riwayat pengukuran satu siswa.
 *
 * Konsistensi temporal dijaga secara struktural, bukan diharapkan:
 * - tinggi diambil dari kurva TB/U pada umur tiap tanggal dengan z-score yang
 *   hampir tetap, lalu dipaksa monoton tidak menurun;
 * - berat diturunkan dari IMT/U (berat = IMT × tinggi²), sehingga IMT tidak
 *   pernah diacak terpisah dari tinggi dan berat;
 * - perubahan berat antar pengukuran dibatasi agar bertahap.
 */
export function planMeasurements(
  rng: Rng,
  gender: Gender,
  birthDate: SchoolDate,
  dates: readonly SchoolDate[],
): PlannedMeasurement[] {
  if (dates.length === 0) return []

  const heightZ = Math.max(-3, Math.min(3, rng.normal(0, 1)))
  const bmiZ = planBmiZ(rng)

  const result: PlannedMeasurement[] = []
  let previousHeight = 0
  let previousWeight: number | null = null

  for (const date of dates) {
    const ageMonths = ageMonthsBetween(birthDate, date)
    const height = heightFromReference(heightZ + rng.float(-0.02, 0.02), ageMonths, gender)
    const bmi = bmiFromReference(bmiZ + rng.float(-0.08, 0.08), ageMonths, gender)
    if (height === null || bmi === null) continue

    // Tinggi badan tidak pernah menyusut.
    const nextHeight = Math.max(height, previousHeight + (previousHeight === 0 ? 0 : 0.1))
    previousHeight = nextHeight

    let weight = bmi * (nextHeight / 100) ** 2
    if (previousWeight !== null) {
      const maxDelta = 2.5
      weight = Math.max(previousWeight - maxDelta, Math.min(previousWeight + maxDelta, weight))
    }
    previousWeight = weight

    result.push({
      measuredAt: date,
      heightCm: roundTo1(nextHeight),
      weightKg: roundTo1(weight),
    })
  }

  return result
}

/**
 * Tanggal pengukuran: satu per periode, diambil dari hari sekolah terdekat
 * supaya pengukuran tidak pernah jatuh pada hari libur. Jumlahnya bervariasi
 * antar siswa sehingga ada siswa tanpa data (empty state), siswa dengan satu
 * titik, dan siswa dengan riwayat panjang.
 */
export function planMeasurementDates(
  rng: Rng,
  schoolDates: readonly SchoolDate[],
): SchoolDate[] {
  if (schoolDates.length === 0) return []
  const count = rng.weighted(measurementCountDistribution)
  if (count === 0) return []

  const chosen: SchoolDate[] = []
  const span = schoolDates.length / count
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * span)
    const end = Math.min(schoolDates.length - 1, Math.floor((index + 1) * span) - 1)
    const position = end <= start ? start : rng.int(start, end)
    const date = schoolDates[position]
    if (!chosen.includes(date)) chosen.push(date)
  }
  return chosen.sort(compareSchoolDates)
}

/** Rentang tanggal generator: `days` hari ke belakang dari `end`, inklusif. */
export function windowStart(end: SchoolDate, days: number): SchoolDate {
  return addSchoolDays(end, -(Math.max(1, days) - 1))
}
