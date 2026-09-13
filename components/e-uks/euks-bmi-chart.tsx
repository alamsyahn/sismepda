"use client"

import { useMemo, useState } from "react"

import { ChartTooltip, ChartTooltipFrame, isMousePointer } from "@/components/e-uks/chart-tooltip"
import { nearestIndex } from "@/lib/chart-tooltip"
import type { BmiPoint } from "@/lib/euks"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

/**
 * Line chart of derived IMT over time, drawn as raw SVG to match the existing
 * charts in this project (no chart library is used anywhere in SISMEPDA).
 *
 * Tooltip memakai kartu bersama `ChartTooltip` seperti grafik E-UKS lain, dan
 * hanya menampilkan nilai yang memang ada pada titik itu: tinggi dan berat
 * berasal dari baris pengukuran yang sama, catatan ditampilkan bila terisi.
 */
export function EuksBmiChart({ points }: { points: BmiPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
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
  const coords = series.map((point, index) => ({
    ...point,
    bmiValue: point.bmi as number,
    cx: x(index),
    cy: y(point.bmi as number),
  }))
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.cx} ${point.cy}`).join(" ")
  const baseline = margin.top + plotHeight

  const active = activeIndex === null ? null : (coords[activeIndex] ?? null)

  /** Nearest-x agar titik kecil tetap nyaman dijangkau pointer dan sentuhan. */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
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
        className="h-auto min-h-56 w-full touch-pan-y"
        role="img"
        aria-label="Grafik tren Indeks Massa Tubuh"
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
            <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="11">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />

        {active ? (
          <line
            x1={active.cx}
            x2={active.cx}
            y1={margin.top}
            y2={baseline}
            stroke="var(--primary)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        ) : null}

        {coords.map((point, index) => {
          const isActive = index === activeIndex
          return (
            <g key={point.id}>
              {/* Sasaran fokus transparan: tooltip harus terjangkau lewat
                  keyboard, bukan hanya hover. */}
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
                <title>{describePoint(point.measuredAt, point.bmiValue)}</title>
              </circle>
              {isActive ? (
                <circle cx={point.cx} cy={point.cy} r="9" fill="var(--primary)" opacity="0.18" />
              ) : null}
              <circle
                cx={point.cx}
                cy={point.cy}
                r={isActive ? 6 : 4}
                fill="var(--primary)"
                stroke="var(--background)"
                strokeWidth={isActive ? 2 : 1}
              />
            </g>
          )
        })}

        {coords.map((point, index) =>
          index === 0 || index === series.length - 1 ? (
            <text
              key={`label-${point.id}`}
              x={point.cx}
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

      {active ? (
        <ChartTooltip
          xRatio={active.cx / width}
          yRatio={active.cy / height}
          title={formatMeasuredAt(active.measuredAt)}
          value={`IMT ${active.bmiValue.toFixed(1)}`}
          rows={[`${active.heightCm} cm · ${active.weightKg} kg`]}
          note={active.note ?? undefined}
        />
      ) : null}
    </ChartTooltipFrame>
  )
}

function describePoint(measuredAt: string, bmi: number): string {
  return `${measuredAt}: IMT ${bmi.toFixed(1)}`
}

/** Tanggal panjang; bila tidak dapat diurai, tampilkan apa adanya. */
function formatMeasuredAt(measuredAt: string): string {
  const parsed = parseSchoolDate(measuredAt)
  if (!parsed) return measuredAt
  return formatSchoolDate(parsed, { day: "numeric", month: "long", year: "numeric" })
}
