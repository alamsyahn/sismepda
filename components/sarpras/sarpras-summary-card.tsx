"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  sarprasStatusColors,
  sarprasStatusLabels,
  sarprasStatusOrder,
  statusCount,
  type SarprasStats,
  type SarprasStatus,
} from "@/lib/sarpras"

type Props = {
  stats: SarprasStats
  /** The tab currently shown below, highlighted in the chart. */
  activeStatus: SarprasStatus
  onSelectStatus: (status: SarprasStatus) => void
}

const SIZE = 208
const THICKNESS = 26

/**
 * Donut of the school's sarpras condition, counted in UNITS.
 *
 * Segments are buttons: clicking one switches the priority table below, which
 * is the fastest path from "something is wrong" to "here is the list".
 */
export function SarprasSummaryCard({ stats, activeStatus, onSelectStatus }: Props) {
  const radius = (SIZE - THICKNESS) / 2
  const circumference = 2 * Math.PI * radius
  const center = SIZE / 2
  const visible = sarprasStatusOrder.filter((status) => statusCount(stats, status) > 0)
  const gap = visible.length > 1 ? 3 : 0

  let offset = 0

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Ringkasan Kondisi Sarpras
          </h2>
          <p className="text-sm text-muted-foreground">
            Dihitung per unit terhadap kebutuhan sekolah. Klik salah satu status untuk melihat
            daftarnya.
          </p>
        </div>

        <div className="mt-6 flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:gap-10">
          <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label={`Total sarpras ${stats.total} unit: ${sarprasStatusOrder
                .map((status) => `${sarprasStatusLabels[status]} ${statusCount(stats, status)}`)
                .join(", ")}`}
            >
              <g transform={`rotate(-90 ${center} ${center})`}>
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth={THICKNESS}
                />
                {stats.total > 0 &&
                  sarprasStatusOrder.map((status) => {
                    const value = statusCount(stats, status)
                    if (value <= 0) return null
                    const arc = (value / stats.total) * circumference
                    const dash = Math.max(arc - gap, 0.75)
                    const isActive = status === activeStatus
                    const segment = (
                      <circle
                        key={status}
                        cx={center}
                        cy={center}
                        r={radius}
                        fill="none"
                        stroke={sarprasStatusColors[status]}
                        strokeWidth={isActive ? THICKNESS + 6 : THICKNESS}
                        strokeDasharray={`${dash} ${circumference - dash}`}
                        strokeDashoffset={-offset}
                        strokeLinecap="butt"
                        className="cursor-pointer transition-all duration-300"
                        opacity={isActive ? 1 : 0.85}
                        onClick={() => onSelectStatus(status)}
                      />
                    )
                    offset += arc
                    return segment
                  })}
              </g>
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold leading-none tracking-tight text-foreground tabular-nums">
                {stats.total.toLocaleString("id-ID")}
              </span>
              <span className="mt-1.5 text-xs font-medium text-muted-foreground">Total Sarpras</span>
            </div>
          </div>

          <ul className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {sarprasStatusOrder.map((status) => {
              const value = statusCount(stats, status)
              const pct = stats.total > 0 ? Math.round((value / stats.total) * 100) : 0
              const isActive = status === activeStatus
              return (
                <li key={status}>
                  <button
                    type="button"
                    onClick={() => onSelectStatus(status)}
                    aria-pressed={isActive}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      isActive
                        ? "border-border bg-accent/60"
                        : "border-transparent hover:bg-accent/40",
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: sarprasStatusColors[status] }}
                      aria-hidden
                    />
                    <span className="flex-1 text-sm text-muted-foreground">
                      {sarprasStatusLabels[status]}
                    </span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {value.toLocaleString("id-ID")}
                    </span>
                    <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                      {pct}%
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
