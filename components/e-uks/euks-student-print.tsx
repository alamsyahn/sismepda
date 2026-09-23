"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { EuksBmiChart } from "@/components/e-uks/euks-bmi-chart"
import { EuksKmsChart } from "@/components/e-uks/euks-kms-chart"
import { resolveKmsReference, kmsReferenceLabel, toKmsPoints } from "@/lib/kms"
import { genderLabels } from "@/lib/student-input"
import type { Gender } from "@/lib/lms"
import {
  formatBmi,
  formatZScore,
  nutritionStatusLabel,
  type BmiPoint,
  type HeightPoint,
  type NutritionStatus,
} from "@/lib/euks"
import type { SickAbsenceRow } from "@/lib/server-euks"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

/**
 * Cetak Pantauan Kesehatan Siswa (A4 potret).
 *
 * Seluruh angka berasal dari props yang sama dengan yang dirender halaman di
 * layar; berkas ini tidak menghitung IMT, z-score, status gizi, maupun rentetan
 * sakit. Grafik IMT dan KMS dipakai ulang apa adanya — keduanya SVG `viewBox`
 * murni sehingga menskala ke lebar kertas tanpa raster dan tanpa terpotong.
 *
 * Pola portalnya sama dengan laporan E-UKS lain: dirender ke `document.body`,
 * `display: none` di layar, dan saat mencetak `@media print` menyembunyikan
 * seluruh anak `body` kecuali portal. Sidebar, pemilih kelas/nama, tombol edit,
 * dan tombol Print sendiri karena itu tidak mungkin ikut tercetak.
 */

/** Baris kunjungan yang benar-benar dipakai laporan ini. */
export type StudentPrintVisit = {
  id: string
  occurredAt: string
  complaint: string
  treatment: string
  followUp: string | null
}

export type StudentPrintData = {
  schoolName: string
  studentName: string
  className: string
  birthDate: string | null
  gender: Gender | null
  status: NutritionStatus | null
  ageYears: number | null
  latestHeightCm: number | null
  latestWeightKg: number | null
  latestBmi: number | null
  series: BmiPoint[]
  heightSeries: HeightPoint[]
  sickAbsences: SickAbsenceRow[]
  visits: StudentPrintVisit[]
  /** Bagian yang boleh dilihat pengguna; mengikuti izin halaman. */
  canMeasurements: boolean
  canSickAbsences: boolean
  canVisits: boolean
}

function formatDate(value: string | null): string {
  const parsed = parseSchoolDate(value)
  return parsed
    ? formatSchoolDate(parsed, { day: "numeric", month: "short", year: "numeric" })
    : "–"
}

/**
 * Tombol Print beserta dokumen cetaknya.
 *
 * `data` null berarti kelas/siswa belum dipilih — tombol tidak dirender sama
 * sekali, sehingga laporan kosong tidak dapat dicetak. Ini mengikuti halaman
 * yang juga baru menampilkan kartu-kartu setelah siswa terpilih.
 */
export function EuksStudentPrintAction({ data }: { data: StudentPrintData | null }) {
  const [mounted, setMounted] = useState(false)
  // Stempel waktu diambil saat tombol ditekan, bukan saat render: nilainya
  // harus waktu cetak sesungguhnya, dan nilai dari render awal akan berbeda
  // antara server dan klien sehingga memicu galat hidrasi.
  const [printedAt, setPrintedAt] = useState<Date | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!printedAt) return

    const root = document.documentElement
    root.setAttribute("data-euks-print", "student-monitoring")

    const cleanup = () => {
      root.removeAttribute("data-euks-print")
      setPrintedAt(null)
    }
    window.addEventListener("afterprint", cleanup, { once: true })

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

  if (!data) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={print} disabled={printedAt !== null}>
        <Printer className="size-4" aria-hidden />
        Print
      </Button>
      {mounted
        ? createPortal(
            <div className="euks-print-portal" aria-hidden>
              <StudentPrintDocument data={data} printedAt={printedAt} />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Isi dokumen cetak. Diekspor terpisah dari tombol agar dapat dirender di luar
 * browser untuk verifikasi, tanpa menyentuh `window.print`.
 */
export function StudentPrintDocument({
  data,
  printedAt,
}: {
  data: StudentPrintData
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

  const reference = resolveKmsReference(data.gender, null)
  const kmsPoints = useMemo(
    () => toKmsPoints(data.heightSeries, reference.gender),
    [data.heightSeries, reference.gender],
  )

  const statusLabel = data.status ? nutritionStatusLabel(data.status) : "–"
  const statusHint =
    data.status?.kind === "known"
      ? `IMT/U ${formatZScore(data.status.z)}${
          data.ageYears !== null ? ` · umur ${data.ageYears} tahun` : ""
        }`
      : undefined

  return (
    <div className="euks-print-root" data-print-doc="student-monitoring">
      <section className="euks-print-section">
        <header className="euks-print-header">
          <div>
            <h1>PANTAUAN KESEHATAN SISWA</h1>
            {data.schoolName ? <p className="euks-print-school">{data.schoolName}</p> : null}
          </div>
          <dl className="euks-print-meta">
            <div>
              <dt>Nama</dt>
              <dd>{data.studentName}</dd>
            </div>
            <div>
              <dt>Kelas</dt>
              <dd>
                {data.className}
                <span className="euks-print-meta-sub">
                  {data.gender ? genderLabels[data.gender] : "Jenis kelamin belum diisi"}
                  {data.birthDate ? ` · lahir ${formatDate(data.birthDate)}` : ""}
                </span>
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

        <div className="euks-print-stats">
          <div className="euks-print-stat">
            <p className="euks-print-stat-label">Status Gizi (berdasarkan IMT)</p>
            <p className="euks-print-stat-value euks-print-stat-text">{statusLabel}</p>
            {statusHint ? <p className="euks-print-stat-hint">{statusHint}</p> : null}
          </div>
          <PrintStat
            label="Tinggi Badan Saat Ini"
            value={data.latestHeightCm === null ? "–" : `${data.latestHeightCm} cm`}
          />
          <PrintStat
            label="Berat Badan Saat Ini"
            value={data.latestWeightKg === null ? "–" : `${data.latestWeightKg} kg`}
          />
          <PrintStat label="IMT" value={formatBmi(data.latestBmi)} />
        </div>

        {data.canSickAbsences ? (
          <article className="euks-print-card euks-print-table-card">
            <h2>Riwayat Ketidakhadiran karena Sakit</h2>
            <p className="euks-print-lead">
              Diambil dari rekap absensi Sismepda. Kolom Berturut-turut menghitung hari sakit
              beruntun dengan mengabaikan hari libur.
            </p>
            {data.sickAbsences.length === 0 ? (
              <p className="euks-print-caption">Tidak ada ketidakhadiran karena sakit.</p>
            ) : (
              <table className="euks-print-students">
                <thead>
                  <tr>
                    <th scope="col">No</th>
                    <th scope="col">Tanggal</th>
                    <th scope="col">Catatan</th>
                    <th scope="col">Berturut-turut</th>
                    <th scope="col">Tindak Lanjut Sekolah</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sickAbsences.map((row, index) => (
                    <tr key={row.id}>
                      <td className="euks-print-num">{index + 1}</td>
                      <td>{row.date}</td>
                      <td>{row.note?.trim() ? row.note : "–"}</td>
                      <td className="euks-print-num">
                        {row.streak >= 2 ? `Hari ke-${row.streak}` : "–"}
                      </td>
                      <td>{row.followUp?.trim() ? row.followUp : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ) : null}

        {data.canVisits ? (
          <article className="euks-print-card euks-print-table-card">
            <h2>Riwayat Siswa Masuk UKS</h2>
            {data.visits.length === 0 ? (
              <p className="euks-print-caption">Belum ada kunjungan UKS untuk siswa ini.</p>
            ) : (
              <table className="euks-print-students">
                <thead>
                  <tr>
                    <th scope="col">No</th>
                    <th scope="col">Tanggal</th>
                    <th scope="col">Keluhan</th>
                    <th scope="col">Tindakan yang Diberikan</th>
                    <th scope="col">Tindak Lanjut</th>
                  </tr>
                </thead>
                <tbody>
                  {data.visits.map((visit, index) => (
                    <tr key={visit.id}>
                      <td className="euks-print-num">{index + 1}</td>
                      <td>{visit.occurredAt}</td>
                      <td>{visit.complaint}</td>
                      <td>{visit.treatment}</td>
                      <td>{visit.followUp?.trim() ? visit.followUp : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ) : null}

        {data.canMeasurements ? (
          <article className="euks-print-card euks-print-chart-card">
            <h2>Grafik IMT</h2>
            <div className="euks-print-chart">
              <EuksBmiChart points={data.series} birthDate={data.birthDate} gender={data.gender} />
            </div>
            {data.series.length === 0 ? null : (
              <table className="euks-print-students">
                <thead>
                  <tr>
                    <th scope="col">No</th>
                    <th scope="col">Tanggal Ukur</th>
                    <th scope="col">Tinggi</th>
                    <th scope="col">Berat</th>
                    <th scope="col">IMT</th>
                    <th scope="col">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((point, index) => (
                    <tr key={point.id}>
                      <td className="euks-print-num">{index + 1}</td>
                      <td>{formatDate(point.measuredAt)}</td>
                      <td className="euks-print-num">{point.heightCm} cm</td>
                      <td className="euks-print-num">{point.weightKg} kg</td>
                      <td className="euks-print-num">{formatBmi(point.bmi)}</td>
                      <td>{point.note?.trim() ? point.note : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ) : null}

        {data.canMeasurements ? (
          <article className="euks-print-card euks-print-chart-card">
            <h2>Grafik KMS</h2>
            <p className="euks-print-lead">
              {kmsReferenceLabel()}
              {reference.isFallback
                ? " · jenis kelamin belum diisi, kurva memakai rujukan bawaan"
                : ` · kurva ${genderLabels[reference.gender].toLowerCase()}`}
            </p>
            <div className="euks-print-chart">
              <EuksKmsChart
                points={kmsPoints}
                gender={reference.gender}
                selectedId={null}
                onSelect={noop}
              />
            </div>
            {kmsPoints.length === 0 ? null : (
              <table className="euks-print-students">
                <thead>
                  <tr>
                    <th scope="col">No</th>
                    <th scope="col">Tanggal Ukur</th>
                    <th scope="col">Umur</th>
                    <th scope="col">Tinggi</th>
                    <th scope="col">Z-Score</th>
                    <th scope="col">Posisi Pita</th>
                  </tr>
                </thead>
                <tbody>
                  {kmsPoints.map((point, index) => (
                    <tr key={point.id}>
                      <td className="euks-print-num">{index + 1}</td>
                      <td>{formatDate(point.measuredAt)}</td>
                      <td>{point.ageLabel}</td>
                      <td className="euks-print-num">{point.heightCm} cm</td>
                      <td className="euks-print-num">
                        {point.zScore === null ? "–" : formatZScore(point.zScore)}
                      </td>
                      <td>{point.band ?? "Di luar rentang rujukan"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ) : null}

        <footer className="euks-print-footer">
          <span>SISMEPDA • E-UKS</span>
          {printedLabel ? <span>Dicetak: {printedLabel}</span> : null}
        </footer>
      </section>
    </div>
  )
}

/** Grafik KMS dalam laporan bersifat statis; tidak ada titik yang dipilih. */
function noop() {}

function PrintStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="euks-print-stat">
      <p className="euks-print-stat-label">{label}</p>
      <p className="euks-print-stat-value">{value}</p>
    </div>
  )
}
