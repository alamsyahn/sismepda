"use client"

import { useMemo } from "react"

import type { HeightPoint } from "@/lib/euks"
import {
  HEIGHT_REFERENCE_MAX_MONTHS,
  HEIGHT_REFERENCE_MIN_MONTHS,
  SD_LINES,
  heightReferenceCurves,
} from "@/lib/height-for-age"
import type { Gender } from "@/lib/lms"

/**
 * Grafik KMS: tinggi badan siswa terhadap umur, di atas pita rujukan WHO
 * -3..+3 SD.
 *
 * Digambar sebagai SVG mentah mengikuti chart lain di SISMEPDA (project ini
 * tidak memakai chart library). Pita dihitung dari L/M/S yang sama dengan yang
 * menilai siswa, jadi posisi titik terhadap pita selalu konsisten.
 */
export function EuksKmsChart({
  points,
  gender,
}: {
  points: HeightPoint[]
  gender: Gender | null
}) {
  const curves = useMemo(() => {
    if (!gender || points.length === 0) return []
    // Beri ruang setahun di kiri-kanan agar titik tidak menempel di tepi.
    const ages = points.map((point) => point.ageMonths)
    const from = Math.min(...ages) - 12
    const to = Math.max(...ages) + 12
    return heightReferenceCurves(gender, from, to)
  }, [gender, points])

  if (!gender) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Jenis kelamin siswa belum diisi, sehingga kurva rujukan tidak dapat dipilih.
      </p>
    )
  }

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

      {points.map((point) => (
        <g key={point.id}>
          <circle cx={x(point.ageMonths)} cy={y(point.heightCm)} r="4" fill="var(--primary)" />
          <title>
            {`${point.measuredAt}: ${point.heightCm} cm pada umur ${Math.floor(point.ageMonths / 12)} tahun ${point.ageMonths % 12} bulan`}
          </title>
        </g>
      ))}

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
  )
}
