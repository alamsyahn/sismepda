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

  const describe = (point: MonthlyVisitStat, index: number) => {
    const partial = partialFinalMonth && index === points.length - 1
    const visitors = point.students > 0 ? `, ${point.students} siswa` : ""
    return `${formatMonthLabel(point.month)}: ${point.count} kunjungan${visitors}${
      partial ? " (bulan berjalan, belum genap)" : ""
    }`
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto min-h-56 w-full overflow-visible"
      role="img"
      aria-label={`Tren kunjungan UKS per bulan. ${points
        .map((point, index) => describe(point, index))
        .join("; ")}.`}
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

      {coords.map((point, index) => {
        const isPeak = peak !== null && point.month === peak.month
        const isPartial = partialFinalMonth && index === points.length - 1
        return (
          <g key={point.month}>
            {/* Sasaran sentuh lebar dan transparan supaya tooltip juga
                terjangkau pada layar sentuh, bukan hanya lewat hover. */}
            <circle cx={point.cx} cy={point.cy} r="14" fill="transparent" tabIndex={0}>
              <title>{describe(point, index)}</title>
            </circle>
            <circle
              cx={point.cx}
              cy={point.cy}
              r={isPeak ? 5.5 : 3.5}
              fill={isPeak ? "var(--euks-accent)" : "var(--card)"}
              stroke="var(--euks-accent)"
              strokeWidth="2"
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
                fill="var(--muted-foreground)"
                fontSize="11"
              >
                {`${formatMonthShort(point.month)}${isPartial ? "*" : ""}`}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function formatNumber(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 })
}
