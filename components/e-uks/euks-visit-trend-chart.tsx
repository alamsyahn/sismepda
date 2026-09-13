"use client"

import { useState } from "react"

import { ChartTooltip, ChartTooltipFrame, isMousePointer } from "@/components/e-uks/chart-tooltip"
import { nearestIndex } from "@/lib/chart-tooltip"
import {
  formatMonthLabel,
  formatMonthShort,
  peakMonth,
  type MonthlyVisitStat,
} from "@/lib/euks-trends"

/**
 * Tren kunjungan UKS per bulan sebagai garis dengan isian lembut.
 *
 * Menggantikan kolom batang: bentuk garis membaca sebagai *pergerakan dari
 * waktu ke waktu*, sedangkan batang membaca sebagai kumpulan kategori yang
 * berdiri sendiri. Angkanya sama persis — seri yang digambar tetap keluaran
 * `monthlyVisitStats()`, yang deret bulannya berasal dari `monthlyVisitCounts()`.
 *
 * SVG mentah, mengikuti chart E-UKS lain; tidak ada pustaka grafik yang
 * ditambahkan. Warna memakai token tema (`--euks-accent`, `--border`,
 * `--muted-foreground`) supaya mode terang dan gelap sama-sama terbaca, dan
 * seluruh nilai juga tersedia sebagai teks/`<title>` sehingga informasinya
 * tidak bergantung pada warna.
 *
 * Komponen klien semata-mata karena tooltip interaktif; angka yang digambar
 * tetap dihitung di server dan tidak ada permintaan baru saat berinteraksi.
 */
export function EuksVisitTrendChart({
  points,
  average,
  partialFinalMonth = false,
}: {
  points: MonthlyVisitStat[]
  /** Rata-rata kunjungan per bulan; digambar sebagai garis acuan tipis. */
  average: number
  /** Bulan terakhir belum genap sebulan — ditandai agar tidak menyesatkan. */
  partialFinalMonth?: boolean
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (points.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Belum ada kunjungan untuk digambarkan.
      </p>
    )
  }

  const width = 720
  const height = 260
  const margin = { top: 20, right: 20, bottom: 36, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const maxCount = Math.max(...points.map((point) => point.count), average)
  // Domain minimal 1 supaya seri yang seluruhnya nol tidak membagi dengan nol.
  const max = Math.max(1, Math.ceil(maxCount / 5) * 5)

  // Satu titik saja tidak punya jarak antar-titik; taruh di tengah supaya
  // garisnya tidak menempel pada sumbu.
  const x = (index: number) =>
    points.length === 1
      ? margin.left + plotWidth / 2
      : margin.left + (plotWidth / (points.length - 1)) * index
  const y = (value: number) => margin.top + plotHeight - (value / max) * plotHeight

  const coords = points.map((point, index) => ({ ...point, cx: x(index), cy: y(point.count) }))
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.cx} ${point.cy}`).join(" ")
  const baseline = margin.top + plotHeight
  const area = `${line} L${coords[coords.length - 1].cx} ${baseline} L${coords[0].cx} ${baseline} Z`

  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio)))]
  const peak = peakMonth(points)
  // Label bulan menumpuk bila bulannya banyak; ambil sebagian saja.
  const labelEvery = Math.ceil(points.length / 12)

  const isPartialAt = (index: number) => partialFinalMonth && index === points.length - 1

  const describe = (point: MonthlyVisitStat, index: number) => {
    const partial = isPartialAt(index)
    const visitors = point.students > 0 ? `, ${point.students} siswa` : ""
    return `${formatMonthLabel(point.month)}: ${point.count} kunjungan${visitors}${
      partial ? " (bulan berjalan, belum genap)" : ""
    }`
  }

  const active = activeIndex === null ? null : (coords[activeIndex] ?? null)

  /**
   * Nearest-x: hover/tap di mana pun pada bidang grafik menyorot bulan
   * terdekat. Titik data hanya berjarak beberapa piksel pada layar HP, jadi
   * mengharuskan pointer tepat di atas titik akan membuat tooltip hampir tidak
   * terjangkau.
   */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    // Rasio lebar render dan rasio viewBox identik karena SVG diskalakan
    // linear, jadi tidak perlu mengubah satuan lebih dahulu.
    setActiveIndex(
      nearestIndex(
        coords.map((point) => point.cx / width),
        (event.clientX - box.left) / box.width,
      ),
    )
  }

  return (
    <ChartTooltipFrame>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto min-h-56 w-full touch-pan-y overflow-visible"
        role="img"
        aria-label={`Tren kunjungan UKS per bulan. ${points
          .map((point, index) => describe(point, index))
          .join("; ")}.`}
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={(event) => {
          if (isMousePointer(event)) setActiveIndex(null)
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeDasharray="4 4"
            />
            <text
              x={margin.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              fill="var(--muted-foreground)"
              fontSize="11"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Garis acuan rata-rata: sekunder, jadi tipis dan putus-putus. Gunanya
            agar bulan di atas/bawah rata-rata terbaca tanpa menghitung. */}
        {average > 0 ? (
          <g>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={y(average)}
              y2={y(average)}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 5"
              strokeWidth="1"
              opacity="0.7"
            />
            <text
              x={width - margin.right}
              y={y(average) - 6}
              textAnchor="end"
              fill="var(--muted-foreground)"
              fontSize="10"
            >
              {`Rata-rata ${formatNumber(average)}/bulan`}
            </text>
          </g>
        ) : null}

        <path d={area} fill="var(--euks-accent)" opacity="0.12" />
        <path
          d={line}
          fill="none"
          stroke="var(--euks-accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Guideline vertikal titik aktif: halus, hanya untuk mengaitkan
            tooltip dengan label bulannya. */}
        {active ? (
          <line
            x1={active.cx}
            x2={active.cx}
            y1={margin.top}
            y2={baseline}
            stroke="var(--euks-accent)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        ) : null}

        {coords.map((point, index) => {
          const isPeak = peak !== null && point.month === peak.month
          const isActive = index === activeIndex
          return (
            <g key={point.month}>
              {/* Sasaran fokus tetap ada per titik supaya tooltip terjangkau
                  lewat keyboard, bukan hanya pointer. */}
              <circle
                cx={point.cx}
                cy={point.cy}
                r="14"
                fill="transparent"
                tabIndex={0}
                className="focus-visible:outline-ring focus:outline-none focus-visible:outline-2"
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
              >
                <title>{describe(point, index)}</title>
              </circle>
              {isActive ? (
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r="9"
                  fill="var(--euks-accent)"
                  opacity="0.18"
                />
              ) : null}
              <circle
                cx={point.cx}
                cy={point.cy}
                r={isActive ? 5.5 : isPeak ? 5.5 : 3.5}
                fill={isActive || isPeak ? "var(--euks-accent)" : "var(--card)"}
                stroke="var(--euks-accent)"
                strokeWidth={isActive ? 2.5 : 2}
              />
              {isPeak ? (
                <text
                  x={point.cx}
                  y={point.cy - 12}
                  textAnchor="middle"
                  fill="var(--euks-accent-muted)"
                  fontSize="10"
                  fontWeight="600"
                >
                  Tertinggi
                </text>
              ) : null}
              {index % labelEvery === 0 || index === points.length - 1 ? (
                <text
                  x={point.cx}
                  y={height - 12}
                  textAnchor="middle"
                  fill={isActive ? "var(--foreground)" : "var(--muted-foreground)"}
                  fontSize="11"
                  fontWeight={isActive ? "600" : undefined}
                >
                  {`${formatMonthShort(point.month)}${isPartialAt(index) ? "*" : ""}`}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>

      {active && activeIndex !== null ? (
        <ChartTooltip
          xRatio={active.cx / width}
          yRatio={active.cy / height}
          title={formatMonthLabel(active.month)}
          value={`${active.count} kunjungan`}
          rows={[
            // Hanya ditampilkan bila memang ada; 0 siswa berarti kunjungan
            // bulan itu tidak berasal dari siswa yang sedang disaring.
            ...(active.students > 0 ? [`${active.students} siswa berbeda`] : []),
            ...(peak !== null && active.month === peak.month ? ["Bulan tertinggi"] : []),
          ]}
          note={
            isPartialAt(activeIndex)
              ? "Bulan berjalan — data belum genap sebulan."
              : undefined
          }
        />
      ) : null}
    </ChartTooltipFrame>
  )
}

function formatNumber(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 })
}
