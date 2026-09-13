/**
 * Agregasi tren kesehatan untuk Halaman Utama E-UKS.
 *
 * Seluruh angka diturunkan dari `EuksVisit` — satu-satunya sumber statistik
 * E-UKS. Tidak ada tabel ringkasan yang disimpan, sehingga angka di halaman
 * tidak mungkin basi terhadap log kunjungan.
 *
 * **Keluhan dan tindakan adalah teks bebas.** Modul ini mengelompokkan
 * berdasarkan teks yang dinormalkan (huruf kecil, spasi dirapikan), BUKAN
 * berdasarkan taksonomi klinis. "ISPA" dan "batuk pilek" tetap dihitung
 * terpisah karena aplikasi ini tidak berwenang memutuskan keduanya sama —
 * pemetaan semacam itu adalah keputusan medis. Label yang ditampilkan adalah
 * ejaan yang paling sering dipakai operator, agar tetap terbaca wajar.
 */

import { compareSchoolDates, schoolMonthOf, type SchoolDate, type SchoolMonth } from "@/lib/school-date"

export type TrendVisit = {
  occurredAt: SchoolDate
  complaint: string
  treatment: string
  /**
   * Siswa yang berkunjung. Opsional karena beberapa pemanggil hanya butuh
   * agregasi teks; bila tidak diisi, jumlah siswa per bulan tidak dihitung
   * alih-alih ditebak.
   */
  studentId?: string
}

/** Satu baris peringkat keluhan atau tindakan. */
export type TrendCount = {
  /** Kunci normalisasi — dipakai untuk pengelompokan dan sebagai React key. */
  key: string
  /** Ejaan yang paling sering dipakai operator untuk kelompok ini. */
  label: string
  count: number
  /** Porsi terhadap seluruh kunjungan pada rentang, 0-100. */
  share: number
}

/**
 * Normalisasi untuk pengelompokan: rapikan spasi dan samakan huruf besar-kecil.
 * Sengaja TIDAK melakukan stemming, sinonim, atau pemetaan istilah medis.
 */
export function normalizeTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

type Bucket = { count: number; labels: Map<string, number> }

function tally(values: string[]): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>()
  for (const raw of values) {
    const trimmed = raw.trim().replace(/\s+/g, " ")
    if (trimmed === "") continue
    const key = trimmed.toLowerCase()
    const bucket = buckets.get(key) ?? { count: 0, labels: new Map<string, number>() }
    bucket.count += 1
    bucket.labels.set(trimmed, (bucket.labels.get(trimmed) ?? 0) + 1)
    buckets.set(key, bucket)
  }
  return buckets
}

/** Ejaan terbanyak; seri bila imbang dipecah secara alfabetis agar stabil. */
function dominantLabel(labels: Map<string, number>): string {
  return [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

/**
 * Peringkat teratas, dengan sisanya digabung ke satu baris "Lainnya".
 *
 * `total` adalah pembagi porsi: jumlah seluruh entri yang tidak kosong, bukan
 * hanya yang masuk peringkat, sehingga persentase selalu menjumlah 100%.
 */
export function rankTerms(values: string[], limit: number): TrendCount[] {
  const buckets = tally(values)
  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.count, 0)
  if (total === 0) return []

  const ranked = [...buckets.entries()]
    .map(([key, bucket]) => ({ key, label: dominantLabel(bucket.labels), count: bucket.count }))
    // Urutan stabil: terbanyak dulu, lalu alfabetis supaya hasil tidak berubah
    // antar-render untuk data yang sama.
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const top = ranked.slice(0, limit)
  const rest = ranked.slice(limit)

  const rows: TrendCount[] = top.map((item) => ({
    ...item,
    share: (item.count / total) * 100,
  }))

  if (rest.length > 0) {
    const restCount = rest.reduce((sum, item) => sum + item.count, 0)
    rows.push({
      key: "__lainnya__",
      label: "Lainnya",
      count: restCount,
      share: (restCount / total) * 100,
    })
  }

  return rows
}

/** Satu bulan pada grafik tren, lengkap dengan jumlah siswa berbeda. */
export type MonthlyVisitStat = {
  month: SchoolMonth
  count: number
  /** Siswa berbeda yang berkunjung pada bulan itu. */
  students: number
}

/**
 * Seri bulanan untuk grafik tren: jumlah kunjungan sekaligus siswa berbeda.
 *
 * Dipisahkan dari `monthlyVisitCounts()` supaya bentuk seri lama tetap utuh
 * bagi pemanggil yang hanya butuh jumlah kunjungan. Deret bulannya sama persis
 * — fungsi ini memakai `monthlyVisitCounts()` sebagai sumber, bukan menghitung
 * ulang, sehingga angka kunjungan tidak mungkin berbeda antara keduanya.
 *
 * Siswa berbeda dihitung per bulan, jadi seorang siswa yang berkunjung pada
 * dua bulan terhitung pada masing-masing bulan. Jumlah kolom `students` karena
 * itu TIDAK sama dengan total siswa berkunjung pada periode.
 */
export function monthlyVisitStats(visits: TrendVisit[]): MonthlyVisitStat[] {
  const base = monthlyVisitCounts(visits)
  const students = new Map<string, Set<string>>()

  for (const visit of visits) {
    if (!visit.studentId) continue
    const month = schoolMonthOf(visit.occurredAt)
    const set = students.get(month) ?? new Set<string>()
    set.add(visit.studentId)
    students.set(month, set)
  }

  return base.map((point) => ({
    ...point,
    students: students.get(point.month)?.size ?? 0,
  }))
}

/**
 * Bulan dengan kunjungan terbanyak, atau null bila seluruh bulan nol.
 *
 * Bila ada beberapa bulan dengan jumlah sama, yang paling awal dipilih supaya
 * hasilnya stabil antar-render.
 */
export function peakMonth<T extends { month: SchoolMonth; count: number }>(
  points: T[],
): T | null {
  let best: T | null = null
  for (const point of points) {
    if (point.count === 0) continue
    if (best === null || point.count > best.count) best = point
  }
  return best
}

/**
 * Apakah bulan terakhir pada seri belum genap sebulan.
 *
 * Dihitung dari tanggal kunjungan terakhir yang benar-benar ada di basis data,
 * bukan dari "hari ini": grafik hanya boleh mengklaim datanya sampai tanggal
 * yang memang tercatat. Tanpa penanda ini, bulan berjalan terbaca sebagai
 * penurunan tajam padahal bulannya memang belum selesai.
 */
export function isPartialFinalMonth(lastDate: SchoolDate): boolean {
  const [year, month, day] = lastDate.split("-").map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day < daysInMonth
}

/** Satu bulan pada grafik tren tindakan. */
export type MonthlyCount = {
  month: SchoolMonth
  count: number
}

/**
 * Jumlah kunjungan per bulan, termasuk bulan kosong di tengah rentang.
 *
 * Bulan tanpa kunjungan tetap muncul dengan nilai 0 — kalau dilewati, jeda pada
 * grafik akan terbaca seolah-olah bulan itu tidak pernah ada.
 */
export function monthlyVisitCounts(visits: TrendVisit[]): MonthlyCount[] {
  if (visits.length === 0) return []

  const counts = new Map<string, number>()
  for (const visit of visits) {
    const month = schoolMonthOf(visit.occurredAt)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }

  const months = [...counts.keys()].sort()
  const [firstYear, firstMonth] = months[0].split("-").map(Number)
  const [lastYear, lastMonth] = months[months.length - 1].split("-").map(Number)

  const series: MonthlyCount[] = []
  let year = firstYear
  let month = firstMonth
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`
    series.push({ month: key as SchoolMonth, count: counts.get(key) ?? 0 })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return series
}

/** Kunjungan dalam rentang tanggal, batas ikut terhitung. */
export function visitsBetween(visits: TrendVisit[], from: SchoolDate, to: SchoolDate): TrendVisit[] {
  return visits.filter(
    (visit) =>
      compareSchoolDates(visit.occurredAt, from) >= 0 && compareSchoolDates(visit.occurredAt, to) <= 0,
  )
}

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
]

/** "2026-05" -> "Mei 2026". */
export function formatMonthLabel(month: SchoolMonth): string {
  const [year, index] = month.split("-").map(Number)
  return `${MONTH_LABELS[index - 1]} ${year}`
}

/** "2026-05" -> "Mei" — untuk sumbu grafik yang sudah sempit. */
export function formatMonthShort(month: SchoolMonth): string {
  const index = Number(month.split("-")[1])
  return MONTH_LABELS[index - 1]
}
