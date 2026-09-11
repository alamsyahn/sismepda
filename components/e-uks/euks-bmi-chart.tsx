"use client"

import { useMemo } from "react"
import type { BmiPoint } from "@/lib/euks"

/**
 * Line chart of derived IMT over time, drawn as raw SVG to match the existing
 * charts in this project (no chart library is used anywhere in SISMEPDA).
 */
export function EuksBmiChart({ points }: { points: BmiPoint[] }) {
  const series = useMemo(() => points.filter((point) => point.bmi !== null), [points])

  if (series.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Belum ada data pengukuran untuk digambarkan.
      </p>
    )
  }

  const width = 720
  const height = 260
  const margin = { top: 16, right: 16, bottom: 32, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const values = series.map((point) => point.bmi as number)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  // Pad the domain so a flat series does not collapse onto a single line.
  const min = Math.floor(rawMin - 1)
  const max = Math.ceil(rawMax + 1)
  const span = max - min || 1

  const x = (index: number) =>
    margin.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth)
  const y = (value: number) => margin.top + plotHeight - ((value - min) / span) * plotHeight

  const ticks = [0, 1, 2, 3, 4].map((step) => min + (span / 4) * step)
  const path = series.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.bmi as number)}`).join(" ")

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto min-h-56 w-full"
      role="img"
      aria-label="Grafik tren Indeks Massa Tubuh"
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
          <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="11">
            {tick.toFixed(1)}
          </text>
        </g>
      ))}

      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />

      {series.map((point, index) => (
        <g key={point.id}>
          <circle cx={x(index)} cy={y(point.bmi as number)} r="4" fill="var(--primary)" />
          <title>{`${point.measuredAt}: IMT ${(point.bmi as number).toFixed(1)}`}</title>
        </g>
      ))}

      {series.map((point, index) =>
        index === 0 || index === series.length - 1 ? (
          <text
            key={`label-${point.id}`}
            x={x(index)}
            y={height - 10}
            textAnchor={index === 0 ? "start" : "end"}
            fill="var(--muted-foreground)"
            fontSize="11"
          >
            {point.measuredAt}
          </text>
        ) : null,
      )}
    </svg>
  )
}
