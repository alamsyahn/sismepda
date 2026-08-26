"use client"

export type DonutSegment = {
  label: string
  value: number
  color: string
}

type DonutChartProps = {
  segments: DonutSegment[]
  centerLabel: string
  centerValue: string
  size?: number
  thickness?: number
}

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  size = 172,
  thickness = 20,
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2
  const nonZero = segments.filter((s) => s.value > 0)
  // Small consistent gap (in px along the arc) between visible segments.
  const gap = nonZero.length > 1 ? 3 : 0

  let offset = 0

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${centerLabel}: ${centerValue}`}
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
            {total > 0 &&
              segments.map((segment) => {
                if (segment.value <= 0) return null
                const fraction = segment.value / total
                const arc = fraction * circumference
                const dash = Math.max(arc - gap, 0.75)
                const circle = (
                  <circle
                    key={segment.label}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={thickness}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                    className="transition-all duration-500"
                  />
                )
                offset += arc
                return circle
              })}
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none tracking-tight text-foreground">
            {centerValue}
          </span>
          <span className="mt-1 text-xs font-medium text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-1">
        {segments.map((segment) => {
          const pct = total > 0 ? Math.round((segment.value / total) * 100) : 0
          return (
            <li key={segment.label} className="flex items-center gap-2.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: segment.color }}
                aria-hidden
              />
              <span className="flex-1 text-sm text-muted-foreground">{segment.label}</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {segment.value}
              </span>
              <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                {pct}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
