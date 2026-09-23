"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { formatSchoolDate, fromPrismaDate } from "@/lib/school-date"
import type { EuksVisitRow } from "@/lib/server-euks"

/** Identitas dokumen cetak; nama sekolah berasal dari pengaturan, tidak ditulis tetap. */
export type VisitPrintMeta = {
  schoolName: string | null
  visits: EuksVisitRow[]
}

function visitDate(value: Date): string {
  return formatSchoolDate(fromPrismaDate(value), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/** Rentang tanggal seluruh riwayat, dibaca dari data yang benar-benar dicetak. */
function periodLabel(visits: EuksVisitRow[]): string {
  if (visits.length === 0) return "—"
  // readEuksVisits mengurutkan terbaru lebih dulu.
  const newest = visits[0].occurredAt
  const oldest = visits[visits.length - 1].occurredAt
  const from = visitDate(oldest)
  const to = visitDate(newest)
  return from === to ? from : `${from} – ${to}`
}

/**
 * Dokumen cetak Riwayat Kunjungan UKS.
 *
 * Diekspor terpisah dari tombol agar dapat dirender di luar browser
 * (uji render statis) tanpa menyentuh `window.print`.
 */
export function VisitPrintDocument({
  data,
  printedAt,
}: {
  data: VisitPrintMeta
  printedAt: Date
}) {
  const { formatTime, timeZoneLabel, dateFromInstant } = useSchoolTimeZone()
  const { schoolName, visits } = data

  /**
   * Ringkasan dihitung dari baris yang dicetak, bukan dari query baru:
   * dokumen dan tabelnya wajib bercerita hal yang sama.
   */
  const summary = useMemo(() => {
    const students = new Set<string>()
    const classes = new Set<string>()
    const complaints = new Map<string, number>()
    let withFollowUp = 0

    for (const visit of visits) {
      students.add(visit.studentId)
      classes.add(visit.className)
      if (visit.followUp && visit.followUp.trim().length > 0) withFollowUp++
      const key = visit.complaint.trim()
      if (key.length > 0) complaints.set(key, (complaints.get(key) ?? 0) + 1)
    }

    const topComplaints = [...complaints.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id"))
      .slice(0, 5)

    return {
      total: visits.length,
      students: students.size,
      classes: classes.size,
      withFollowUp,
      topComplaints,
    }
  }, [visits])

  const printedDate = formatSchoolDate(dateFromInstant(printedAt), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <div className="euks-print-root" lang="id">
      <header className="euks-print-header">
        {schoolName ? <p className="euks-print-school">{schoolName}</p> : null}
        <h1 className="euks-print-title">RIWAYAT KUNJUNGAN UKS</h1>
        <p className="euks-print-subtitle">Periode {periodLabel(visits)}</p>
      </header>

      <section className="euks-print-card euks-print-stats">
        <div className="euks-print-stat">
          <span className="euks-print-stat-label">Total Kunjungan</span>
          <span className="euks-print-stat-value">{summary.total}</span>
        </div>
        <div className="euks-print-stat">
          <span className="euks-print-stat-label">Siswa Berkunjung</span>
          <span className="euks-print-stat-value">{summary.students}</span>
        </div>
        <div className="euks-print-stat">
          <span className="euks-print-stat-label">Kelas Terlibat</span>
          <span className="euks-print-stat-value">{summary.classes}</span>
        </div>
        <div className="euks-print-stat">
          <span className="euks-print-stat-label">Dengan Tindak Lanjut</span>
          <span className="euks-print-stat-value">{summary.withFollowUp}</span>
        </div>
      </section>

      {summary.topComplaints.length > 0 ? (
        <section className="euks-print-card euks-print-keep">
          <h2 className="euks-print-section-title">Keluhan Terbanyak</h2>
          <ul className="euks-print-complaints">
            {summary.topComplaints.map(([name, count]) => (
              <li key={name}>
                <span className="euks-print-complaint-name">{name}</span>
                <span className="euks-print-complaint-count">{count}&times;</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="euks-print-card euks-print-table-card">
        <h2 className="euks-print-section-title">Daftar Kunjungan</h2>
        <table className="euks-print-visits">
          <thead>
            <tr>
              <th className="euks-print-col-no">No</th>
              <th className="euks-print-col-date">Tanggal</th>
              <th className="euks-print-col-name">Nama Siswa</th>
              <th className="euks-print-col-class">Kelas</th>
              <th>Keluhan</th>
              <th>Tindakan yang Diberikan</th>
              <th>Tindak Lanjut</th>
              <th className="euks-print-col-officer">Dicatat oleh</th>
            </tr>
          </thead>
          <tbody>
            {visits.length === 0 ? (
              <tr>
                <td colSpan={8} className="euks-print-empty-cell">
                  Belum ada kunjungan UKS yang tercatat.
                </td>
              </tr>
            ) : (
              visits.map((visit, index) => (
                <tr key={visit.id}>
                  <td className="euks-print-col-no">{index + 1}</td>
                  <td className="euks-print-col-date">{visitDate(visit.occurredAt)}</td>
                  <td className="euks-print-col-name">{visit.studentName}</td>
                  <td className="euks-print-col-class">{visit.className}</td>
                  <td>{visit.complaint}</td>
                  <td>{visit.treatment}</td>
                  <td>{visit.followUp?.trim() ? visit.followUp : "—"}</td>
                  <td className="euks-print-col-officer">{visit.recordedByName ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <footer className="euks-print-footer">
        Dicetak {printedDate} pukul {formatTime(printedAt)} {timeZoneLabel}
      </footer>
    </div>
  )
}

/**
 * Tombol cetak Riwayat Kunjungan UKS.
 *
 * Mencetak SELURUH riwayat yang dimuat halaman, bukan sebagian: dokumen
 * arsip sekolah harus utuh, sedangkan tabel layar hanyalah alat telusur.
 */
export function EuksVisitPrintAction({ data }: { data: VisitPrintMeta }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handlePrint = useCallback(() => {
    const root = document.documentElement
    root.setAttribute("data-euks-print", "visit-history")
    const clear = () => root.removeAttribute("data-euks-print")
    window.addEventListener("afterprint", clear, { once: true })
    window.print()
  }, [])

  const printedAt = useMemo(() => new Date(), [])

  return (
    <>
      <Button variant="outline" onClick={handlePrint} className="shrink-0">
        <Printer className="size-4" />
        Cetak
      </Button>
      {mounted
        ? createPortal(
            <div className="euks-print-portal" aria-hidden="true">
              <VisitPrintDocument data={data} printedAt={printedAt} />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
