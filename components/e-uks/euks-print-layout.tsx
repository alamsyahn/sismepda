"use client"

import { useMemo } from "react"

import { EuksComplaintRanking } from "@/components/e-uks/euks-complaint-ranking"
import { EuksTreatmentComposition } from "@/components/e-uks/euks-treatment-composition"
import { EuksVisitTrendChart } from "@/components/e-uks/euks-visit-trend-chart"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import {
  ALL_GRADES,
  COVERAGE_COLUMN,
  NORMAL_NUTRITION_CATEGORY,
  filterByGrade,
  formatShare,
  nutritionCategoryColor,
  nutritionHeatmap,
  nutritionHeatmapColumnColor,
  nutritionHeatmapColumnLabels,
  nutritionInsights,
  summarizeNutrition,
  type ClassNutritionBucket,
  type NutritionSummary,
} from "@/lib/euks-nutrition"
import { nutritionCategoryLabels } from "@/lib/bmi-for-age"
import type { MonthlyVisitStat, TrendCount } from "@/lib/euks-trends"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

/**
 * Tata letak laporan cetak E-UKS (A4 lanskap).
 *
 * Hanya penyajian: seluruh angka diturunkan dari agregat yang sama dengan
 * seksi di layar (`summarizeNutrition`, `nutritionHeatmap`, peringkat tren yang
 * sudah dihitung server). Tidak ada rumus gizi, ambang, maupun pengelompokan
 * baru di berkas ini.
 *
 * Susunannya sengaja berbeda dari dashboard: kertas tidak punya scroll
 * horizontal dan tidak punya tooltip, jadi kartu disusun mendatar rapat, tabel
 * per kelas dibuat memenuhi lebar, dan setiap sel tetap memuat angka sehingga
 * laporan terbaca walau dicetak hitam-putih.
 */

export type EuksPrintVisitData = {
  periodLabel: string | null
  totalVisits: number
  distinctStudents: number
  monthlyStats: MonthlyVisitStat[]
  months: number
  averagePerMonth: number
  partialFinalMonth: boolean
  /** Kalimat ringkasan tren yang sama dengan yang tampil di layar. */
  trendNote: string | null
  complaints: TrendCount[]
  treatments: TrendCount[]
  /** Tanggal kunjungan terakhir yang tercatat (YYYY-MM-DD). */
  lastVisitDate: string | null
}

function formatLongDate(value: string | null): string | null {
  const parsed = parseSchoolDate(value)
  return parsed
    ? formatSchoolDate(parsed, { day: "numeric", month: "long", year: "numeric" })
    : null
}

/** Label cakupan laporan. */
export function scopeLabel(grade: string): string {
  return !grade || grade === ALL_GRADES ? "Semua siswa" : `Tingkat ${grade}`
}

/** Stempel "Dicetak: ..." mengikuti zona waktu sekolah, bukan zona peramban. */
function usePrintTimestamp(at: Date | null): string | null {
  const { formatTime, timeZoneLabel, dateFromInstant } = useSchoolTimeZone()
  if (!at) return null
  const date = formatSchoolDate(dateFromInstant(at), {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return `${date}, ${formatTime(at)} ${timeZoneLabel}`
}

export function EuksPrintLayout({
  schoolName,
  grade,
  buckets,
  visits,
  printedAt,
}: {
  schoolName: string
  grade: string
  buckets: ClassNutritionBucket[] | null
  visits: EuksPrintVisitData | null
  printedAt: Date | null
}) {
  const summary = useMemo<NutritionSummary | null>(
    () => (buckets && buckets.length > 0 ? summarizeNutrition(filterByGrade(buckets, grade)) : null),
    [buckets, grade],
  )
  const insights = useMemo(() => (summary ? nutritionInsights(summary) : []), [summary])
  const printedLabel = usePrintTimestamp(printedAt)

  return (
    <div className="euks-print-root">
      {summary ? (
        <section className="euks-print-section" data-print-part="nutrition">
          <PrintHeader
            title="LAPORAN STATUS GIZI SISWA"
            schoolName={schoolName}
            dataDate={formatLongDate(summary.latestMeasuredAt)}
            scope={scopeLabel(grade)}
          />
          <NutritionReport summary={summary} insights={insights} />
          <PrintFooter printedLabel={printedLabel} />
        </section>
      ) : null}

      {visits ? (
        <section className="euks-print-section" data-print-part="visits">
          <PrintHeader
            title="LAPORAN RINGKASAN KUNJUNGAN UKS"
            schoolName={schoolName}
            dataDate={formatLongDate(visits.lastVisitDate)}
            scope={visits.periodLabel ? `Periode ${visits.periodLabel}` : "Seluruh riwayat kunjungan"}
          />
          <VisitReport data={visits} />
          <PrintFooter printedLabel={printedLabel} />
        </section>
      ) : null}
    </div>
  )
}

function PrintHeader({
  title,
  schoolName,
  dataDate,
  scope,
}: {
  title: string
  schoolName: string
  dataDate: string | null
  scope: string
}) {
  return (
    <header className="euks-print-header">
      <div>
        <h1>{title}</h1>
        {schoolName ? <p className="euks-print-school">{schoolName}</p> : null}
      </div>
      <dl className="euks-print-meta">
        <div>
          <dt>Data per</dt>
          <dd>{dataDate ?? "Belum tersedia"}</dd>
        </div>
        <div>
          <dt>Cakupan</dt>
          <dd>{scope}</dd>
        </div>
      </dl>
    </header>
  )
}

function PrintFooter({ printedLabel }: { printedLabel: string | null }) {
  return (
    <footer className="euks-print-footer">
      <span>SISMEPDA • E-UKS</span>
      {printedLabel ? <span>Dicetak: {printedLabel}</span> : null}
    </footer>
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

function NutritionReport({
  summary,
  insights,
}: {
  summary: NutritionSummary
  insights: string[]
}) {
  const heatmap = nutritionHeatmap(summary)

  return (
    <>
      <div className="euks-print-stats">
        <PrintStat
          label="Siswa Terukur"
          value={`${summary.measuredStudents} siswa`}
          hint={`${formatShare(summary.coverageShare)} dari ${summary.totalStudents} siswa`}
        />
        <PrintStat
          label={nutritionCategoryLabels[NORMAL_NUTRITION_CATEGORY]}
          value={summary.measuredStudents > 0 ? formatShare(summary.normalShare) : "-"}
          hint={`${summary.normalCount} siswa`}
        />
        <PrintStat
          label="Perlu Perhatian"
          value={summary.measuredStudents > 0 ? formatShare(summary.attentionShare) : "-"}
          hint={`${summary.attentionCount} siswa`}
        />
        <PrintStat
          label="Belum Terukur"
          value={`${summary.unmeasured.total} siswa`}
          hint={
            summary.unmeasured.incomplete > 0
              ? `${summary.unmeasured.noMeasurement} belum pernah diukur · ${summary.unmeasured.incomplete} data belum lengkap`
              : "Belum memiliki data pengukuran yang dapat dianalisis"
          }
        />
      </div>

      <div className="euks-print-columns">
        <article className="euks-print-card">
          <h2>Sebaran Status Gizi Siswa</h2>
          <div className="euks-print-donut-row">
            <PrintDonut summary={summary} />
            <table className="euks-print-list">
              <thead>
                <tr>
                  <th scope="col">Kategori</th>
                  <th scope="col">Siswa</th>
                  <th scope="col">Porsi</th>
                </tr>
              </thead>
              <tbody>
                {summary.categories.map((item) => (
                  <tr key={item.category}>
                    <th scope="row">
                      <span
                        className="euks-print-swatch"
                        style={{ background: nutritionCategoryColor[item.category] }}
                        aria-hidden
                      />
                      {item.label}
                    </th>
                    <td>{item.count}</td>
                    <td>{formatShare(item.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="euks-print-card">
          <h2>Cakupan Data</h2>
          <p className="euks-print-lead">
            <strong>{summary.measuredStudents}</strong> dari {summary.totalStudents} siswa memiliki
            data yang dapat dianalisis.
          </p>
          {summary.unmeasured.reasons.length > 0 ? (
            <ul className="euks-print-kv">
              {summary.unmeasured.reasons.map((reason) => (
                <li key={reason.reason}>
                  <span>{reason.label}</span>
                  <span>{reason.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {insights.length > 0 ? (
            <div className="euks-print-note">
              <p className="euks-print-note-title">Ringkasan</p>
              <ul>
                {insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      </div>

      <article className="euks-print-card euks-print-table-card">
        <h2>Status Gizi per Kelas</h2>
        {heatmap.rows.length === 0 ? (
          <p className="euks-print-empty">Belum ada data pengukuran kesehatan yang dapat ditampilkan.</p>
        ) : (
          <table className="euks-print-heatmap">
            <thead>
              <tr>
                <th scope="col">Kelas</th>
                {heatmap.columns.map((column) => (
                  <th key={column} scope="col">
                    <span
                      className="euks-print-bar"
                      style={{ background: nutritionHeatmapColumnColor[column] }}
                      aria-hidden
                    />
                    {nutritionHeatmapColumnLabels[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmap.rows.map((row) => (
                <tr key={row.classId}>
                  <th scope="row">{row.className}</th>
                  {row.cells.map((cell) => (
                    <td key={cell.column}>
                      {cell.empty ? (
                        <span className="euks-print-cell euks-print-cell-empty">–</span>
                      ) : (
                        <span
                          className="euks-print-cell"
                          style={{
                            // Warna kategori dipertahankan seperti di aplikasi,
                            // dengan kepekatan yang sama (intensitas × 0,5)
                            // supaya teks hitam tetap kontras di atas sel.
                            background: `color-mix(in oklab, ${nutritionHeatmapColumnColor[cell.column]} ${(
                              cell.intensity * 50
                            ).toFixed(1)}%, white)`,
                          }}
                        >
                          {cell.column === COVERAGE_COLUMN
                            ? `${cell.count}/${cell.total}`
                            : formatShare(cell.share)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="euks-print-caption">
          Setiap sel menunjukkan persentase terhadap siswa yang telah terukur pada kelas tersebut.
          Kolom Terukur menunjukkan jumlah siswa yang memiliki data pengukuran dibanding total siswa
          di kelas.
        </p>
      </article>

      <p className="euks-print-caption">
        Angka memakai pengukuran kesehatan terbaru masing-masing siswa. Kategori mengikuti IMT
        menurut umur (WHO 5-19 tahun dengan ambang Permenkes 2/2020). Ini penyajian data, bukan
        diagnosis.
      </p>
    </>
  )
}

/**
 * Donat sebaran untuk kertas: SVG statis dengan geometri yang sama seperti
 * donat di layar, tanpa tooltip dan tanpa keadaan sorot — di kertas keduanya
 * tidak berlaku, dan legenda angka sudah berdiri sebagai tabel di sebelahnya.
 */
function PrintDonut({ summary }: { summary: NutritionSummary }) {
  const total = summary.measuredStudents
  if (total === 0) {
    return <p className="euks-print-empty">Belum ada siswa terukur.</p>
  }

  const size = 200
  const radius = 78
  const stroke = 28
  const center = size / 2
  const circumference = 2 * Math.PI * radius
  const segments = summary.categories.filter((item) => item.count > 0)

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="euks-print-donut"
      role="img"
      aria-label={`Sebaran status gizi dari ${total} siswa terukur`}
    >
      <g transform={`rotate(-90 ${center} ${center})`}>
        {segments.map((item, index) => {
          const before = segments
            .slice(0, index)
            .reduce((sum, prev) => sum + prev.count, 0)
          const dash = Math.max(
            0,
            circumference * (item.count / total) - (segments.length > 1 ? 2 : 0),
          )
          return (
            <circle
              key={item.category}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={nutritionCategoryColor[item.category]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              transform={`rotate(${(before / total) * 360} ${center} ${center})`}
            />
          )
        })}
      </g>
      <text x={center} y={center - 2} textAnchor="middle" fontSize="28" fontWeight="600">
        {total}
      </text>
      <text x={center} y={center + 20} textAnchor="middle" fontSize="12" opacity="0.7">
        Siswa terukur
      </text>
    </svg>
  )
}

function VisitReport({ data }: { data: EuksPrintVisitData }) {
  return (
    <>
      <div className="euks-print-stats">
        <PrintStat
          label="Total Kunjungan"
          value={data.totalVisits.toLocaleString("id-ID")}
          hint={data.periodLabel ?? undefined}
        />
        <PrintStat
          label="Siswa Berkunjung"
          value={data.distinctStudents.toLocaleString("id-ID")}
          hint="Siswa berbeda pada periode ini"
        />
        <PrintStat
          label="Rata-rata per Bulan"
          value={
            data.months > 0
              ? data.averagePerMonth.toLocaleString("id-ID", { maximumFractionDigits: 1 })
              : "-"
          }
          hint={data.months > 0 ? `kunjungan / bulan • ${data.months} bulan` : undefined}
        />
      </div>

      <article className="euks-print-card">
        <h2>Tren Kunjungan UKS</h2>
        <p className="euks-print-caption">
          {data.periodLabel
            ? `Jumlah kunjungan siswa per bulan • ${data.periodLabel}`
            : "Jumlah kunjungan siswa per bulan"}
        </p>
        <div className="euks-print-chart">
          <EuksVisitTrendChart
            points={data.monthlyStats}
            average={data.averagePerMonth}
            partialFinalMonth={data.partialFinalMonth}
          />
        </div>
        {data.trendNote ? <p className="euks-print-caption">{data.trendNote}</p> : null}
      </article>

      <div className="euks-print-columns">
        <article className="euks-print-card">
          <h2>Keluhan Terbanyak</h2>
          <EuksComplaintRanking rows={data.complaints} emptyLabel="Belum ada keluhan tercatat." />
        </article>
        <article className="euks-print-card">
          <h2>Komposisi Tindakan</h2>
          <EuksTreatmentComposition
            rows={data.treatments}
            emptyLabel="Belum ada data tindakan pada pilihan ini."
          />
          <p className="euks-print-caption">
            Komposisi dihitung berdasarkan tindakan yang dicatat pada setiap kunjungan.
          </p>
        </article>
      </div>

      <p className="euks-print-caption">
        Keluhan dan tindakan dikelompokkan menurut teks yang dicatat petugas, bukan menurut
        klasifikasi medis. Satu kunjungan mencatat keluhan dan tindakannya masing-masing, sehingga
        persentase dihitung terhadap seluruh entri yang terisi pada kategori itu.
      </p>
    </>
  )
}
