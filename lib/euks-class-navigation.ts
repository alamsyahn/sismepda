/**
 * State URL halaman Pantauan Kesehatan Kelas.
 *
 * URL adalah satu-satunya sumber kebenaran: kelas terpilih, periode, dan
 * seluruh filter/urutan tabel hidup di query string. Konsekuensinya refresh
 * tidak menghilangkan pilihan, dan kembali dari halaman siswa memulihkan
 * tampilan yang sama tanpa state klien yang perlu disinkronkan.
 *
 * Modul ini murni supaya dipakai bersama oleh server component (membaca
 * `searchParams`) dan komponen klien (menulis ulang query), dan dapat diuji
 * tanpa Next.js.
 */

import {
  defaultClassTableFilters,
  isClassTableSort,
  type ClassTableFilters,
} from "@/lib/euks-class-monitoring"
import { isTrendGranularity, type TrendGranularity } from "@/lib/attendance-trend"

export const CLASS_MONITORING_PATH = "/e-uks/pantauan-kesehatan-kelas"
export const STUDENT_MONITORING_PATH = "/e-uks/pantauan-kesehatan"

export const CLASS_PARAM = "classId"
export const PERIOD_PARAM = "periode"
export const FROM_PARAM = "from"
export const TO_PARAM = "to"
export const SEARCH_PARAM = "q"
export const NUTRITION_PARAM = "gizi"
export const GENDER_PARAM = "jk"
export const ATTENTION_PARAM = "perhatian"
export const SORT_PARAM = "urut"
export const DESC_PARAM = "desc"
export const RETURN_PARAM = "returnTo"

/**
 * Periode memakai granularity tren yang sudah ada di SISMEPDA
 * (`TREND_GRANULARITIES`), bukan definisi semester/tahun ajaran baru. Default
 * "bulanan" — rentang 12 bulan cukup panjang untuk melihat pola tanpa membuat
 * grafik satu kelas terlalu padat.
 */
export const DEFAULT_CLASS_PERIOD: TrendGranularity = "bulanan"

export type ClassMonitoringView = {
  classId: string
  granularity: TrendGranularity
  /** Rentang eksplisit dari URL; null berarti pakai rentang default periode. */
  from: string | null
  to: string | null
  filters: ClassTableFilters
}

type ParamReader = { get(name: string): string | null | undefined }

const text = (params: ParamReader, key: string) => (params.get(key) ?? "").trim()

/** Tanggal ISO sederhana; validasi rentangnya dilakukan pemanggil. */
function dateParam(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export function readClassMonitoringView(params: ParamReader): ClassMonitoringView {
  const granularityValue = text(params, PERIOD_PARAM)
  const sortValue = text(params, SORT_PARAM)

  return {
    classId: text(params, CLASS_PARAM),
    granularity: isTrendGranularity(granularityValue) ? granularityValue : DEFAULT_CLASS_PERIOD,
    from: dateParam(text(params, FROM_PARAM)),
    to: dateParam(text(params, TO_PARAM)),
    filters: {
      search: text(params, SEARCH_PARAM),
      nutrition: text(params, NUTRITION_PARAM),
      gender: text(params, GENDER_PARAM),
      attentionOnly: text(params, ATTENTION_PARAM) === "1",
      sort: isClassTableSort(sortValue) ? sortValue : defaultClassTableFilters.sort,
      descending: text(params, DESC_PARAM) === "1",
    },
  }
}

/**
 * Query string kanonik untuk sebuah tampilan.
 *
 * Nilai default sengaja dihilangkan dari URL supaya tautan tetap pendek dan
 * dua URL yang bermakna sama tidak berbeda teksnya.
 */
export function classMonitoringSearch(view: ClassMonitoringView): string {
  const params = new URLSearchParams()
  if (view.classId) params.set(CLASS_PARAM, view.classId)
  if (view.granularity !== DEFAULT_CLASS_PERIOD) params.set(PERIOD_PARAM, view.granularity)
  if (view.from) params.set(FROM_PARAM, view.from)
  if (view.to) params.set(TO_PARAM, view.to)
  if (view.filters.search) params.set(SEARCH_PARAM, view.filters.search)
  if (view.filters.nutrition) params.set(NUTRITION_PARAM, view.filters.nutrition)
  if (view.filters.gender) params.set(GENDER_PARAM, view.filters.gender)
  if (view.filters.attentionOnly) params.set(ATTENTION_PARAM, "1")
  if (view.filters.sort !== defaultClassTableFilters.sort) params.set(SORT_PARAM, view.filters.sort)
  if (view.filters.descending) params.set(DESC_PARAM, "1")
  const search = params.toString()
  return search ? `?${search}` : ""
}

/** Tautan lengkap ke halaman kelas untuk sebuah tampilan. */
export function classMonitoringHref(view: ClassMonitoringView): string {
  return `${CLASS_MONITORING_PATH}${classMonitoringSearch(view)}`
}

/** Tautan drill-down dari Halaman Utama: kelas saja, sisanya default. */
export function classMonitoringLink(classId: string): string {
  return classMonitoringHref({
    classId,
    granularity: DEFAULT_CLASS_PERIOD,
    from: null,
    to: null,
    filters: defaultClassTableFilters,
  })
}

/**
 * Path internal yang aman untuk dipakai sebagai tujuan "kembali".
 *
 * Hanya path relatif satu garis miring yang diterima. Yang ditolak dan
 * memicu null: URL absolut (`https://jahat.example`), skema apa pun,
 * `//host` yang dibaca peramban sebagai protocol-relative, backslash yang
 * dinormalkan sebagian peramban menjadi garis miring, dan karakter kendali.
 * Dengan begitu `returnTo` tidak dapat menjadi open redirect.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!trimmed.startsWith("/")) return null
  if (trimmed.startsWith("//")) return null
  if (trimmed.includes("\\")) return null
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  if (/^\/[^/?#]*:/.test(trimmed)) return null
  return trimmed
}

/**
 * Jalan pulang yang boleh dipasang pada tombol "Kembali ke <kelas>".
 *
 * Lebih sempit daripada `safeReturnPath()`: selain wajib internal, path-nya
 * harus benar-benar halaman Pantauan Kesehatan Kelas. Tanpa batas ini sebuah
 * tautan yang dibuat-buat bisa memakai tombol kembali untuk mengarahkan
 * petugas ke halaman internal lain yang tidak ada hubungannya.
 */
export function safeClassReturnPath(value: string | null | undefined): string | null {
  const path = safeReturnPath(value)
  if (!path) return null
  const [pathname] = path.split(/[?#]/)
  return pathname === CLASS_MONITORING_PATH ? path : null
}

/**
 * Id elemen baris siswa pada tabel kelas.
 *
 * Dipakai sebagai fragment pada `returnTo` supaya peramban memulihkan posisi
 * gulir ke siswa yang tadi dibuka — cukup dengan perilaku jangkar bawaan,
 * tanpa menyimpan posisi gulir di state tersendiri.
 */
export function studentRowAnchor(studentId: string): string {
  return `siswa-${studentId}`
}

/**
 * Tautan ke Pantauan Kesehatan Siswa yang membawa jalan pulang.
 *
 * `returnTo` berisi URL halaman kelas lengkap dengan periode, filter, dan
 * urutan yang sedang aktif, sehingga tombol kembali memulihkan tampilan yang
 * persis sama — bukan halaman kelas dengan dropdown kosong.
 */
export function studentDetailHref(input: {
  studentId: string
  classId: string
  returnTo: string
}): string {
  const params = new URLSearchParams({
    classId: input.classId,
    studentId: input.studentId,
  })
  const back = safeReturnPath(input.returnTo)
  if (back) params.set(RETURN_PARAM, back)
  return `${STUDENT_MONITORING_PATH}?${params.toString()}`
}
