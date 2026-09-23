"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { nutritionCategoryLabels } from "@/lib/bmi-for-age"
import {
  formatAge,
  genderShortLabel,
  type ClassMonitoringSummary,
  type ClassStudentHealthRow,
} from "@/lib/euks-class-monitoring"
import { formatShare } from "@/lib/euks-nutrition"
import type { TrendGranularity } from "@/lib/attendance-trend"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

/**
 * Cetak Pantauan Kesehatan Kelas (A4 potret).
 *
 * Satu sumber data: `summary` yang dipakai laporan ini adalah objek yang sama
 * dengan yang dirender dashboard di layar, sehingga angka cetak tidak mungkin
 * berbeda dari angka yang sedang dilihat pengguna. Tidak ada permintaan
 * jaringan, agregasi, maupun ambang gizi baru di berkas ini — seluruhnya
 * penyajian ulang.
 *
 * Laporan dirender lewat portal ke `document.body` dan disembunyikan di layar.
 * Saat mencetak, `@media print` menyembunyikan seluruh anak `body` kecuali
 * portal, jadi sidebar, topbar, dropdown filter, dan tombol mustahil ikut
 * tercetak tanpa menandai satu per satu elemen aplikasi.
 *
 * Tabel siswa dicetak lengkap (`summary.rows`), bukan hasil saringan tabel di
 * layar: filter dan urutan tabel adalah alat telusur di layar, sedangkan
 * laporan kelas harus utuh agar layak disimpan sebagai dokumen sekolah.
 */

/** Label periode; dipakai bersama oleh dashboard dan laporan cetak. */
export const periodLabels: Record<TrendGranularity, string> = {
  harian: "30 hari terakhir",
  mingguan: "12 minggu terakhir",
  bulanan: "12 bulan terakhir",
  semester: "Sejak awal semester",
}

export type ClassPrintMeta = {
  /** Nama sekolah dari master data; kosong berarti tidak ditampilkan. */
  schoolName: string
  granularity: TrendGranularity
  /** Rentang tanggal periode terpilih (YYYY-MM-DD). */
  from: string
  to: string
}

function formatLongDate(value: string | null): string | null {
  const parsed = parseSchoolDate(value)
  return parsed
    ? formatSchoolDate(parsed, { day: "numeric", month: "long", year: "numeric" })
    : null
}

function formatShortDate(value: string | null): string | null {
  const parsed = parseSchoolDate(value)
  return parsed
    ? formatSchoolDate(parsed, { day: "numeric", month: "short", year: "numeric" })
    : null
}

/**
 * Tombol Print beserta dokumen cetaknya.
 *
 * `summary` null berarti kelas belum dipilih (atau tidak ditemukan), dan tombol
 * tidak dirender sama sekali — laporan kosong tidak pernah bisa dicetak. Itu
 * mengikuti pola halaman ini yang juga baru memunculkan seluruh kartu ringkasan
 * setelah kelas terpilih.
 */
export function EuksClassPrintAction({
  summary,
  meta,
}: {
  summary: ClassMonitoringSummary | null
  meta: ClassPrintMeta
}) {
  const [mounted, setMounted] = useState(false)
  // Waktu cetak diambil saat tombol ditekan, bukan saat render: stempelnya
  // harus waktu cetak, dan nilai dari render awal akan berbeda antara server
  // dan klien sehingga memicu galat hidrasi.
  const [printedAt, setPrintedAt] = useState<Date | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!printedAt) return

    const root = document.documentElement
    root.setAttribute("data-euks-print", "class-monitoring")

    const cleanup = () => {
      root.removeAttribute("data-euks-print")
      setPrintedAt(null)
    }
    window.addEventListener("afterprint", cleanup, { once: true })

    // Dua frame: satu menerapkan atribut lingkup, satu lagi memastikan laporan
    // benar-benar sudah dilukis sebelum dialog cetak mengambil cuplikannya.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => window.print())
    })

    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      window.removeEventListener("afterprint", cleanup)
      root.removeAttribute("data-euks-print")
    }
  }, [printedAt])

  const print = useCallback(() => {
    setPrintedAt((current) => current ?? new Date())
  }, [])

  if (!summary) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={print} disabled={printedAt !== null}>
        <Printer className="size-4" aria-hidden />
        Print
      </Button>
      {mounted
        ? createPortal(
            <div className="euks-print-portal" aria-hidden>
              <ClassPrintDocument summary={summary} meta={meta} printedAt={printedAt} />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Isi dokumen cetak. Diekspor terpisah dari tombol agar dapat dirender di luar
 * browser (uji render statis) tanpa menyentuh `window.print`.
 */
export function ClassPrintDocument({
  summary,
  meta,
  printedAt,
}: {
  summary: ClassMonitoringSummary
  meta: ClassPrintMeta
  printedAt: Date | null
}) {
  const { formatTime, timeZoneLabel, dateFromInstant } = useSchoolTimeZone()

  const printedLabel = useMemo(() => {
    if (!printedAt) return null
    const date = formatSchoolDate(dateFromInstant(printedAt), {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    return `${date}, ${formatTime(printedAt)} ${timeZoneLabel}`
  }, [printedAt, dateFromInstant, formatTime, timeZoneLabel])

  const rangeLabel = useMemo(() => {
    const from = formatShortDate(meta.from)
    const to = formatShortDate(meta.to)
    return from && to ? `${from} – ${to}` : null
  }, [meta.from, meta.to])

  const longestSickStreakCount = summary.rows.filter(
    (row) => row.longestSickStreak >= 3,
  ).length

  return (
    <div className="euks-print-root" data-print-doc="class-monitoring">
      <section className="euks-print-section" data-print-part="class-monitoring">
        <header className="euks-print-header">
          <div>
            <h1>PANTAUAN KESEHATAN KELAS</h1>
            {meta.schoolName ? (
              <p className="euks-print-school">{meta.schoolName}</p>
            ) : null}
          </div>
          <dl className="euks-print-meta">
            <div>
              <dt>Kelas</dt>
              <dd>{summary.className}</dd>
            </div>
            <div>
              <dt>Periode</dt>
              <dd>
                {periodLabels[meta.granularity]}
                {rangeLabel ? <span className="euks-print-meta-sub">{rangeLabel}</span> : null}
              </dd>
            </div>
            {printedLabel ? (
              <div>
                <dt>Dicetak</dt>
                <dd>{printedLabel}</dd>
              </div>
            ) : null}
          </dl>
        </header>

        <div className="euks-print-stats euks-print-stats-5">
          <PrintStat label="Siswa" value={`${summary.totalStudents}`} />
          <PrintStat label="Hari Sakit" value={`${summary.totalSickDays}`} />
          <PrintStat label="Kunjungan UKS" value={`${summary.totalVisits}`} />
          <PrintStat label="Perlu Perhatian" value={`${summary.attentionCount}`} />
          <PrintStat
            label="Kelengkapan Data"
            value={`${summary.assessableStudents}/${summary.totalStudents}`}
            hint="dapat dinilai"
          />
        </div>

        <div className="euks-print-columns">
          <article className="euks-print-card">
            <h2>Distribusi Status Gizi</h2>
            <p className="euks-print-lead">
              Berdasarkan IMT menurut umur (IMT/U) dari pengukuran terbaru tiap siswa.
            </p>
            <table className="euks-print-list">
              <thead>
                <tr>
                  <th scope="col">Kategori</th>
                  <th scope="col">Siswa</th>
                  <th scope="col">Porsi</th>
                </tr>
              </thead>
              <tbody>
                {summary.distribution.map((slice) => (
                  <tr key={slice.key}>
                    <th scope="row">
                      <span
                        className="euks-print-swatch"
                        style={{ background: slice.color }}
                        aria-hidden
                      />
                      {slice.label}
                    </th>
                    <td>{slice.count}</td>
                    <td>{formatShare(slice.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="euks-print-card">
            <h2>Kelengkapan Data Kesehatan</h2>
            <p className="euks-print-lead">
              Data dapat dinilai{" "}
              <strong>
                {summary.assessableStudents} / {summary.totalStudents}
              </strong>{" "}
              — {formatShare(summary.completenessShare)}
            </p>
            {summary.completenessReasons.length === 0 ? (
              <p className="euks-print-caption">
                Seluruh siswa kelas ini sudah dapat dinilai status gizinya.
              </p>
            ) : (
              <ul className="euks-print-kv">
                {summary.completenessReasons.map((item) => (
                  <li key={item.reason}>
                    <span>{item.label}</span>
                    <span>{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>

        <div className="euks-print-columns">
          <article className="euks-print-card">
            <h2>Tren Ketidakhadiran karena Sakit</h2>
            <PrintTrend
              items={summary.sickTrend.map((bucket) => ({
                key: bucket.key,
                label: bucket.label,
                value: bucket.sickDays,
                hint: `${bucket.students} siswa`,
              }))}
              emptyMessage="Belum ada ketidakhadiran karena sakit pada periode ini."
              unit="hari"
            />
            <p className="euks-print-caption">
              {longestSickStreakCount} siswa mengalami sakit 3 hari berturut-turut atau lebih
              pada periode ini.
            </p>
          </article>

          <article className="euks-print-card">
            <h2>Tren Kunjungan UKS</h2>
            <PrintTrend
              items={summary.visitTrend.map((bucket) => ({
                key: bucket.key,
                label: bucket.label,
                value: bucket.visits,
              }))}
              emptyMessage="Belum ada kunjungan UKS pada periode ini."
              unit="kunjungan"
            />
            <p className="euks-print-caption">
              Hanya kunjungan siswa kelas {summary.className}.
            </p>
          </article>
        </div>

        <article className="euks-print-card">
          <h2>Keluhan Terbanyak</h2>
          {summary.complaints.length === 0 ? (
            <p className="euks-print-caption">
              Belum ada keluhan tercatat dari kelas ini pada periode terpilih.
            </p>
          ) : (
            <ul className="euks-print-kv">
              {summary.complaints.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <span>{item.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="euks-print-caption">
            Keluhan apa adanya dari catatan kunjungan; tidak ada penyamaan istilah medis.
          </p>
        </article>

        <article className="euks-print-card euks-print-table-card">
          <h2>Data Kesehatan Siswa — {summary.className}</h2>
          <StudentPrintTable rows={summary.rows} />
          <p className="euks-print-caption">
            Seluruh siswa kelas dicetak, tanpa mengikuti filter dan urutan tabel di layar.
            Sakit dan Masuk UKS mengikuti periode terpilih; tinggi, berat, IMT, dan status gizi
            memakai pengukuran terbaru tiap siswa.
          </p>
        </article>

        <footer className="euks-print-footer">
          <span>SISMEPDA • E-UKS</span>
          {printedLabel ? <span>Dicetak: {printedLabel}</span> : null}
        </footer>
      </section>
    </div>
  )
}

function PrintStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="euks-print-stat">
      <p className="euks-print-stat-label">{label}</p>
      <p className="euks-print-stat-value">{value}</p>
      {hint ? <p className="euks-print-stat-hint">{hint}</p> : null}
    </div>
  )
}

/**
 * Tren sebagai batang mendatar bernilai.
 *
 * Grafik batang vertikal di layar mengandalkan tinggi piksel dan tooltip; di
 * kertas keduanya tidak tersedia, jadi setiap bucket dicetak sebagai baris
 * berlabel dengan angkanya. Panjang batang tetap memberi bentuk tren, tetapi
 * angka di setiap baris membuat laporan tetap terbaca saat dicetak hitam-putih.
 */
function PrintTrend({
  items,
  emptyMessage,
  unit,
}: {
  items: { key: string; label: string; value: number; hint?: string }[]
  emptyMessage: string
  unit: string
}) {
  if (items.length === 0 || items.every((item) => item.value === 0)) {
    return <p className="euks-print-caption">{emptyMessage}</p>
  }
  const max = Math.max(1, ...items.map((item) => item.value))

  return (
    <ul className="euks-print-trend">
      {items.map((item) => (
        <li key={item.key}>
          <span className="euks-print-trend-label">{item.label}</span>
          <span className="euks-print-trend-track">
            <span
              className="euks-print-trend-fill"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </span>
          <span className="euks-print-trend-value">
            {item.value} {unit}
            {item.hint ? <span className="euks-print-trend-hint"> · {item.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function StudentPrintTable({ rows }: { rows: ClassStudentHealthRow[] }) {
  if (rows.length === 0) {
    return <p className="euks-print-caption">Kelas ini belum memiliki siswa aktif.</p>
  }

  return (
    <table className="euks-print-students">
      <thead>
        <tr>
          <th scope="col">No</th>
          <th scope="col">Nama Lengkap</th>
          <th scope="col">L/P</th>
          <th scope="col">Umur</th>
          <th scope="col">Sakit</th>
          <th scope="col">UKS</th>
          <th scope="col">Tinggi</th>
          <th scope="col">Berat</th>
          <th scope="col">IMT</th>
          <th scope="col">Status Gizi</th>
          <th scope="col">Terakhir Diukur</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.studentId}>
            <td className="euks-print-num">{index + 1}</td>
            <th scope="row">{row.name}</th>
            <td>{row.gender === null ? "–" : genderShortLabel(row.gender)}</td>
            <td>{formatAge(row.ageYears)}</td>
            <td className="euks-print-num">{row.sickDays}</td>
            <td className="euks-print-num">{row.visits}</td>
            <td className="euks-print-num">
              {row.heightCm === null ? "–" : `${row.heightCm.toLocaleString("id-ID")} cm`}
            </td>
            <td className="euks-print-num">
              {row.weightKg === null ? "–" : `${row.weightKg.toLocaleString("id-ID")} kg`}
            </td>
            <td className="euks-print-num">
              {row.bmi === null
                ? "–"
                : row.bmi.toLocaleString("id-ID", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
            </td>
            <td>
              {row.category === null
                ? "Belum dapat dinilai"
                : nutritionCategoryLabels[row.category]}
            </td>
            <td>{formatLongDate(row.measuredAt) ?? "Belum pernah diukur"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
