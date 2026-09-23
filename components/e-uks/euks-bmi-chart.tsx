"use client"

import { useMemo, useState } from "react"

import { ChartTooltip, ChartTooltipFrame, isMousePointer } from "@/components/e-uks/chart-tooltip"
import { BMI_SD_LINES, nutritionCategoryLabels } from "@/lib/bmi-for-age"
import { nearestIndex } from "@/lib/chart-tooltip"
import type { BmiPoint } from "@/lib/euks"
import { formatZScore } from "@/lib/euks"
import {
  bmiChartDomain,
  buildBmiChart,
  type BmiChartModel,
  type BmiChartPoint,
} from "@/lib/euks-bmi-chart"
import { NUTRITION_CATEGORY_ORDER, nutritionCategoryColor } from "@/lib/euks-nutrition"
import type { Gender } from "@/lib/lms"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"

/**
 * Grafik tren IMT siswa di atas zona status gizi IMT-menurut-umur (IMT/U).
 *
 * Digambar sebagai SVG mentah seperti grafik E-UKS lain (project ini tidak
 * memakai chart library). Zona dan garis batas berasal dari
 * `lib/euks-bmi-chart.ts`, yang memakai tabel L/M/S dan ambang Permenkes yang
 * sama dengan kartu status gizi — sehingga warna zona, badge tooltip, dan
 * kartu status mustahil saling bertentangan.
 *
 * Ambang IMT anak tidak konstan: batasnya bergantung umur dan jenis kelamin,
 * jadi zona digambar per bulan umur, bukan sebagai garis mendatar tetap.
 */
export function EuksBmiChart({
  points,
  birthDate = null,
  gender = null,
}: {
  points: BmiPoint[]
  birthDate?: string | null
  gender?: Gender | null
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const model = useMemo(
    () => buildBmiChart(points, birthDate, gender),
    [points, birthDate, gender],
  )

  if (model.points.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Belum ada data pengukuran untuk digambarkan.
      </p>
    )
  }

  const width = 720
  const height = 280
  // Ruang kanan disediakan untuk label -3/-2/+1/+2 SD hanya bila zona digambar.
  const margin = { top: 16, right: model.segments.length > 0 ? 40 : 16, bottom: 32, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const { min, max } = bmiChartDomain(model)
  const span = max - min || 1
  const daySpan = model.endDay - model.startDay || 1

  const x = (day: number) => margin.left + ((day - model.startDay) / daySpan) * plotWidth
  const y = (value: number) => margin.top + plotHeight - ((value - min) / span) * plotHeight

  const coords = model.points.map((point) => ({
    ...point,
    cx: x(point.day),
    cy: y(point.bmi),
  }))
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.cx} ${point.cy}`).join(" ")
  const baseline = margin.top + plotHeight
  const ticks = [0, 1, 2, 3, 4].map((step) => min + (span / 4) * step)

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
    <div className="space-y-3">
      <ChartTooltipFrame>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto min-h-56 w-full touch-pan-y"
          role="img"
          aria-label="Grafik tren Indeks Massa Tubuh terhadap zona status gizi IMT menurut umur"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={(event) => {
            if (isMousePointer(event)) setActiveIndex(null)
          }}
        >
          {/* Zona kategori paling belakang, lalu garis batas, lalu garis siswa. */}
          <ZoneLayer model={model} x={x} y={y} min={min} max={max} />

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

          <BoundaryLayer model={model} x={x} y={y} labelX={width - margin.right + 3} />

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
            // Warna titik mengikuti kategorinya; tanpa kategori tetap memakai
            // warna utama supaya tidak menyiratkan status yang belum dinilai.
            const fill = point.category ? nutritionCategoryColor[point.category] : "var(--primary)"
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
                  <title>{describePoint(point)}</title>
                </circle>
                {isActive ? <circle cx={point.cx} cy={point.cy} r="9" fill={fill} opacity="0.22" /> : null}
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={isActive ? 6 : 4}
                  fill={fill}
                  stroke="var(--background)"
                  strokeWidth={isActive ? 2 : 1}
                />
              </g>
            )
          })}

          {coords.map((point, index) =>
            index === 0 || index === coords.length - 1 ? (
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
            value={`IMT ${active.bmi.toFixed(1)}${active.category ? ` · ${nutritionCategoryLabels[active.category]}` : ""}`}
            rows={tooltipRows(active)}
            note={active.note ?? undefined}
          />
        ) : null}
      </ChartTooltipFrame>

      {model.segments.length > 0 ? (
        <Legend />
      ) : (
        <p className="text-muted-foreground text-xs">
          {unavailableZoneMessage(model)}
        </p>
      )}
    </div>
  )
}

/**
 * Zona kategori sebagai deret persegi per bulan umur.
 *
 * Bentuk tangga disengaja: ambang Permenkes memakai umur dalam bulan penuh,
 * sehingga batasnya memang tetap sepanjang satu bulan umur.
 */
function ZoneLayer({
  model,
  x,
  y,
  min,
  max,
}: {
  model: BmiChartModel
  x: (day: number) => number
  y: (value: number) => number
  min: number
  max: number
}) {
  if (model.segments.length === 0) return null

  return (
    <g aria-hidden>
      {model.segments.map((segment) => {
        const left = x(segment.startDay)
        const right = x(segment.endDay)
        const widthPx = Math.max(right - left, 0)
        if (widthPx === 0) return null
        // Batas tiap kategori, dari bawah ke atas: [min, -3, -2, +1, +2, max].
        const edges = [min, ...segment.values, max]
        return (
          <g key={segment.ageMonths}>
            {NUTRITION_CATEGORY_ORDER.map((category, index) => {
              const lower = edges[index]
              const upper = edges[index + 1]
              const top = y(Math.max(lower, upper))
              const bottom = y(Math.min(lower, upper))
              const zoneHeight = bottom - top
              if (!(zoneHeight > 0)) return null
              return (
                <rect
                  key={category}
                  x={left}
                  y={top}
                  width={widthPx}
                  height={zoneHeight}
                  fill={nutritionCategoryColor[category]}
                  // Sangat lembut: zona hanya boleh menjadi latar, garis IMT
                  // siswa tetap visual utama.
                  fillOpacity={category === "gizi_baik" ? 0.08 : 0.12}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/** Garis batas -3, -2, +1, +2 SD sebagai garis tangga tipis, plus labelnya. */
function BoundaryLayer({
  model,
  x,
  y,
  labelX,
}: {
  model: BmiChartModel
  x: (day: number) => number
  y: (value: number) => number
  labelX: number
}) {
  if (model.segments.length === 0) return null
  const last = model.segments[model.segments.length - 1]

  return (
    <g aria-hidden>
      {BMI_SD_LINES.map((z, index) => {
        const commands = model.segments.flatMap((segment, position) => {
          const value = y(segment.values[index])
          return position === 0
            ? [`M ${x(segment.startDay)} ${value}`, `L ${x(segment.endDay)} ${value}`]
            : [`L ${x(segment.startDay)} ${value}`, `L ${x(segment.endDay)} ${value}`]
        })
        return (
          <g key={`sd-${z}`}>
            <path
              d={commands.join(" ")}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity="0.55"
            />
            {/* Label hanya muncul bila ada ruang kanan; pada layar sempit teks
                ikut mengecil bersama viewBox sehingga tidak menumpuk data. */}
            <text x={labelX} y={y(last.values[index]) + 3.5} fill="var(--muted-foreground)" fontSize="9">
              {z > 0 ? `+${z}` : z} SD
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Legenda kategori; dibuat wrap agar tidak memaksa scroll pada layar sempit. */
function Legend() {
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {NUTRITION_CATEGORY_ORDER.map((category) => (
        <li key={category} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: nutritionCategoryColor[category] }}
          />
          {nutritionCategoryLabels[category]}
        </li>
      ))}
    </ul>
  )
}

/**
 * Baris tooltip: hanya nilai yang memang tersedia pada titik itu. Z-score
 * ditampilkan apa adanya dari calculator existing, tidak pernah diperkirakan.
 */
function tooltipRows(point: BmiChartPoint): string[] {
  const rows: string[] = []
  if (point.zScore !== null) rows.push(`Z-score ${formatZScore(point.zScore)}`)
  rows.push(`${point.heightCm} cm · ${point.weightKg} kg`)
  if (point.ageLabel) rows.push(`Usia ${point.ageLabel}`)
  return rows
}

/** Label aksesibilitas satu titik: isi yang sama dengan tooltip. */
function describePoint(point: BmiChartPoint): string {
  const status = point.category ? `, ${nutritionCategoryLabels[point.category]}` : ""
  return `${point.measuredAt}: IMT ${point.bmi.toFixed(1)}${status}`
}

function unavailableZoneMessage(model: BmiChartModel): string {
  switch (model.zonesUnavailable) {
    case "no_birth_date":
      return "Zona status gizi tidak dapat dihitung karena tanggal lahir siswa belum diisi."
    case "no_gender":
      return "Zona status gizi tidak dapat dihitung karena jenis kelamin siswa belum diisi."
    case "age_out_of_range":
      return "Zona status gizi tidak digambar karena umur siswa di luar rentang rujukan IMT/U (5-19 tahun)."
    default:
      return "Zona status gizi tidak dapat dihitung karena data antropometri siswa belum lengkap."
  }
}

/** Tanggal panjang; bila tidak dapat diurai, tampilkan apa adanya. */
function formatMeasuredAt(measuredAt: string): string {
  const parsed = parseSchoolDate(measuredAt)
  if (!parsed) return measuredAt
  return formatSchoolDate(parsed, { day: "numeric", month: "long", year: "numeric" })
}
