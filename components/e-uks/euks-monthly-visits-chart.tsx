"use client"

import { formatMonthLabel, formatMonthShort, type MonthlyCount } from "@/lib/euks-trends"

/**
 * Jumlah kunjungan UKS per bulan, mengikuti struktur wireframe 03.
 *
 * SVG mentah agar konsisten dengan chart lain di SISMEPDA. Wireframe
 * menggambar kolom bertumpuk per jenis tindakan, tetapi tindakan pada
 * `EuksVisit` adalah teks bebas tanpa kategori tetap, sehingga tumpukan itu
 * menuntut taksonomi yang belum ada. Yang digambar adalah total per bulan;
 * rincian tindakan tetap tersedia sebagai peringkat di kartu sebelahnya.
 */
export function EuksMonthlyVisitsChart({ points }: { points: MonthlyCount[] }) {
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        Belum ada kunjungan untuk digambarkan.
      </p>
    )
  }

  const width = 720
  const height = 260
  const margin = { top: 16, right: 16, bottom: 36, left: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom

  const maxCount = Math.max(...points.map((point) => point.count))
  // Domain minimal 1 supaya bulan yang semuanya nol tidak membagi dengan nol.
  const max = Math.max(1, Math.ceil(maxCount / 5) * 5)

  const slot = plotWidth / points.length
  const barWidth = Math.min(48, slot * 0.6)
  const x = (index: number) => margin.left + slot * index + (slot - barWidth) / 2
  const y = (value: number) => margin.top + plotHeight - (value / max) * plotHeight

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio))
  const uniqueTicks = [...new Set(ticks)]

  // Label tiap bulan menumpuk kalau bulannya banyak; ambil sebagian saja.
  const labelEvery = Math.ceil(points.length / 12)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto min-h-56 w-full"
      role="img"
      aria-label="Grafik jumlah kunjungan UKS per bulan"
    >
      {uniqueTicks.map((tick) => (
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

      {points.map((point, index) => (
        <g key={point.month}>
          <rect
            x={x(index)}
            y={y(point.count)}
            width={barWidth}
            height={Math.max(0, margin.top + plotHeight - y(point.count))}
            rx="3"
            fill="var(--primary)"
          />
          <title>{`${formatMonthLabel(point.month)}: ${point.count} kunjungan`}</title>
          {index % labelEvery === 0 ? (
            <text
              x={x(index) + barWidth / 2}
              y={height - 12}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize="11"
            >
              {formatMonthShort(point.month)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  )
}
