"use client"

import { useMemo, useState } from "react"

import { ChartTooltip, ChartTooltipFrame } from "@/components/e-uks/chart-tooltip"
import {
  HEIGHT_REFERENCE_MAX_MONTHS,
  HEIGHT_REFERENCE_MIN_MONTHS,
  SD_LINES,
  heightReferenceCurves,
} from "@/lib/height-for-age"
import type { KmsPoint } from "@/lib/kms"
import type { Gender } from "@/lib/lms"

/**
 * Grafik KMS: tinggi badan siswa terhadap umur, di atas pita rujukan WHO
 * -3..+3 SD.
 *
 * Digambar sebagai SVG mentah mengikuti chart lain di SISMEPDA (project ini
 * tidak memakai chart library). Pita dihitung dari L/M/S yang sama dengan yang
 * menilai siswa, jadi posisi titik terhadap pita selalu konsisten.
 *
 * Kurva mengikuti `gender` yang dikirim pemanggil; komponen ini tidak memilih
 * sendiri agar penanda "memakai kurva fallback" tidak tercecer di dua tempat.
 */
export function EuksKmsChart({
  points,
  gender,
  selectedId,
  onSelect,
}: {
  points: KmsPoint[]
  gender: Gender | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoveredPoint = points.find((point) => point.id === hoveredId) ?? null

  const curves = useMemo(() => {
    if (!gender || points.length === 0) return []
    // Beri ruang setahun di kiri-kanan agar titik tidak menempel di tepi.
    const ages = points.map((point) => point.ageMonths)
    const from = Math.min(...ages) - 12
    const to = Math.max(...ages) + 12
    return heightReferenceCurves(gender, from, to)
  }, [gender, points])

  if (points.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Belum ada pengukuran dengan tanggal lahir yang lengkap untuk digambarkan.
      </p>
    )
  }

  if (curves.length === 0) {
    const minYears = Math.floor(HEIGHT_REFERENCE_MIN_MONTHS / 12)
    const maxYears = Math.floor(HEIGHT_REFERENCE_MAX_MONTHS / 12)
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Umur siswa di luar rentang tabel rujukan ({minYears}-{maxYears} tahun), sehingga kurva tidak
        digambar.
      </p>
    )
  }

  const width = 720
  const height = 320
  const margin = { top: 16, right: 44, bottom: 36, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const minAge = curves[0].ageMonths
  const maxAge = curves[curves.length - 1].ageMonths
  const ageSpan = maxAge - minAge || 1

  // Domain sumbu Y mencakup seluruh pita DAN seluruh titik siswa, supaya titik
  // di luar +-3 SD tetap terlihat alih-alih terpotong diam-diam.
  const curveValues = curves.flatMap((point) => point.values)
  const studentValues = points.map((point) => point.heightCm)
  const rawMin = Math.min(...curveValues, ...studentValues)
  const rawMax = Math.max(...curveValues, ...studentValues)
  const min = Math.floor(rawMin / 5) * 5
  const max = Math.ceil(rawMax / 5) * 5
  const span = max - min || 1

  const x = (ageMonths: number) => margin.left + ((ageMonths - minAge) / ageSpan) * plotWidth
  const y = (value: number) => margin.top + plotHeight - ((value - min) / span) * plotHeight

  const linePath = (index: number) =>
    curves
      .map((point, i) => `${i === 0 ? "M" : "L"} ${x(point.ageMonths)} ${y(point.values[index])}`)
      .join(" ")

  /** Pita antara dua garis SD, digambar sebagai satu poligon tertutup. */
  const bandPath = (lower: number, upper: number) => {
    const up = curves.map((point) => `${x(point.ageMonths)} ${y(point.values[upper])}`)
    const down = [...curves]
      .reverse()
      .map((point) => `${x(point.ageMonths)} ${y(point.values[lower])}`)
    return `M ${up.join(" L ")} L ${down.join(" L ")} Z`
  }

  const medianIndex = SD_LINES.indexOf(0)

  // Pita mengikuti konvensi KMS: makin jauh dari median makin mencolok.
  const bands = [
    { lower: 0, upper: 1, className: "fill-amber-500/15" },
    { lower: 1, upper: 2, className: "fill-emerald-500/10" },
    { lower: 2, upper: 4, className: "fill-emerald-500/20" },
    { lower: 4, upper: 5, className: "fill-emerald-500/10" },
    { lower: 5, upper: 6, className: "fill-amber-500/15" },
  ]

  // Label tahun penuh pada sumbu X.
  const yearTicks: number[] = []
  for (let month = Math.ceil(minAge / 12) * 12; month <= maxAge; month += 12) {
    yearTicks.push(month)
  }

  const heightTicks: number[] = []
  for (let value = min; value <= max; value += Math.max(5, Math.round(span / 8 / 5) * 5)) {
    heightTicks.push(value)
  }

  return (
    <ChartTooltipFrame>
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto min-h-72 w-full"
      role="img"
      aria-label="Grafik KMS tinggi badan menurut umur terhadap kurva rujukan WHO"
    >
      {bands.map((band) => (
        <path key={`${band.lower}-${band.upper}`} d={bandPath(band.lower, band.upper)} className={band.className} />
      ))}

      {heightTicks.map((tick) => (
        <g key={`h-${tick}`}>
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

      {yearTicks.map((month) => (
        <text
          key={`y-${month}`}
          x={x(month)}
          y={height - 12}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize="11"
        >
          {month / 12}
        </text>
      ))}

      {SD_LINES.map((z, index) => (
        <g key={`sd-${z}`}>
          <path
            d={linePath(index)}
            fill="none"
            stroke={index === medianIndex ? "var(--muted-foreground)" : "var(--border)"}
            strokeWidth={index === medianIndex ? 1.5 : 1}
          />
          <text
            x={width - margin.right + 4}
            y={y(curves[curves.length - 1].values[index]) + 4}
            fill="var(--muted-foreground)"
            fontSize="10"
          >
            {z === 0 ? "Median" : `${z > 0 ? "+" : ""}${z} SD`}
          </text>
        </g>
      ))}

      <path
        d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.ageMonths)} ${y(point.heightCm)}`).join(" ")}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {points.map((point) => {
        const isSelected = point.id === selectedId
        const isHovered = point.id === hoveredId
        const cx = x(point.ageMonths)
        const cy = y(point.heightCm)
        return (
          <g
            key={point.id}
            role="button"
            tabIndex={0}
            aria-label={pointLabel(point)}
            aria-pressed={isSelected}
            className="focus-visible:outline-ring cursor-pointer focus:outline-none focus-visible:outline-2"
            onClick={() => onSelect(point.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect(point.id)
              }
            }}
            onMouseEnter={() => setHoveredId(point.id)}
            onMouseLeave={() => setHoveredId((current) => (current === point.id ? null : current))}
            onFocus={() => setHoveredId(point.id)}
            onBlur={() => setHoveredId((current) => (current === point.id ? null : current))}
          >
            {/* Sasaran sentuh lebih besar dari titiknya, tetapi tidak dibuat
                selebar mungkin: pada layar HP jarak antar titik bisa hanya
                ~10px, sehingga sasaran yang terlalu besar akan menutupi titik
                tetangga. Titik yang berhimpit dijangkau lewat tombol navigasi
                pada panel detail. */}
            <circle cx={cx} cy={cy} r="12" fill="transparent" />
            {isSelected ? (
              <circle cx={cx} cy={cy} r="9" fill="none" stroke="var(--primary)" strokeWidth="2" />
            ) : null}
            <circle
              cx={cx}
              cy={cy}
              r={isSelected || isHovered ? 6 : 4}
              fill="var(--primary)"
              stroke="var(--background)"
              strokeWidth={isSelected ? 2 : 1}
            />
          </g>
        )
      })}

      <text
        x={margin.left}
        y={height - 12}
        textAnchor="start"
        fill="var(--muted-foreground)"
        fontSize="11"
      >
        Umur (tahun)
      </text>
    </svg>

      {/* Tooltip memakai kartu bersama seluruh chart E-UKS. Detail lengkap tetap
          ada di panel bawah chart, jadi perangkat sentuh tidak bergantung pada
          hover. */}
      {hoveredPoint ? (
        <ChartTooltip
          xRatio={x(hoveredPoint.ageMonths) / width}
          yRatio={y(hoveredPoint.heightCm) / height}
          title={hoveredPoint.ageLabel}
          value={`${hoveredPoint.heightCm} cm`}
          rows={[hoveredPoint.band ?? "Di luar tabel rujukan"]}
        />
      ) : null}
    </ChartTooltipFrame>
  )
}

/** Label aksesibilitas satu titik: isi yang sama dengan tooltip. */
function pointLabel(point: KmsPoint): string {
  const position = point.band ? `, posisi ${point.band}` : ", umur di luar tabel rujukan"
  return `Pengukuran ${point.measuredAt}: ${point.heightCm} cm pada umur ${point.ageLabel}${position}`
}
