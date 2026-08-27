"use client"

/**
 * Single-value radial progress, drawn with the same SVG approach as DonutChart.
 * Colour alone never carries meaning: every consumer pairs it with a label.
 */
export function RadialProgress({
  value,
  label,
  size = 168,
  thickness = 14,
  caption,
  tone = "primary",
}: {
  value: number
  label: string
  size?: number
  thickness?: number
  caption?: string
  tone?: "primary" | "muted"
}) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  const dash = (clamped / 100) * circumference
  const stroke = tone === "primary" ? "var(--primary)" : "var(--muted-foreground)"
  const display = Number.isInteger(clamped) ? `${clamped}%` : `${clamped.toFixed(1)}%`

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: ${display}`}
      >
        <g transform={`rotate(-90 ${center} ${center})`}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={thickness}
          />
          {clamped > 0 ? (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={stroke}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference - dash}`}
              className="motion-safe:transition-all motion-safe:duration-700"
            />
          ) : null}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <span
          className="font-bold leading-none tracking-tight text-foreground tabular-nums"
          style={{ fontSize: Math.max(size / 6, 18) }}
        >
          {display}
        </span>
        <span className="mt-1.5 text-xs font-medium text-muted-foreground text-balance">{label}</span>
        {caption ? <span className="mt-0.5 text-[11px] text-muted-foreground">{caption}</span> : null}
      </div>
    </div>
  )
}

/**
 * Distribution of teachers across the three completion states.
 * Uses one hue at three strengths so it stays legible in light and dark themes.
 */
export function DistributionBar({
  complete,
  inProgress,
  unreviewed,
  label,
}: {
  complete: number
  inProgress: number
  unreviewed: number
  label: string
}) {
  const total = complete + inProgress + unreviewed
  const segments = [
    { key: "complete", value: complete, color: "var(--primary)" },
    { key: "inProgress", value: inProgress, color: "color-mix(in oklab, var(--primary) 42%, transparent)" },
    { key: "unreviewed", value: unreviewed, color: "var(--muted)" },
  ]

  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${label}: ${complete} lengkap, ${inProgress} proses, ${unreviewed} belum diperiksa`}
    >
      {total > 0
        ? segments.map((segment) =>
            segment.value > 0 ? (
              <div
                key={segment.key}
                className="h-full motion-safe:transition-all motion-safe:duration-700"
                style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }}
              />
            ) : null,
          )
        : null}
    </div>
  )
}
