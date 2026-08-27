"use client"

import { BookMarked, CircleDashed, CircleCheck, LoaderCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { DistributionBar, RadialProgress } from "@/components/supervisi/radial-progress"
import { formatPercent } from "@/lib/workbook"
import type { SupervisionOverview } from "@/lib/server-workbook"

function StatLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleCheck
  label: string
  value: number
}) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground tabular-nums">{value}</span>
    </li>
  )
}

export function SupervisionDashboard({
  overall,
  aggregates,
}: {
  overall: SupervisionOverview["overall"]
  aggregates: SupervisionOverview["aggregates"]
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row lg:flex-col">
          <RadialProgress
            value={overall.percent}
            label="Kelengkapan Keseluruhan"
            caption={`${overall.teacherCount} guru`}
            size={184}
            thickness={16}
          />
          <ul className="w-full space-y-2.5">
            <StatLine icon={CircleCheck} label="Lengkap" value={overall.completeTeachers} />
            <StatLine icon={LoaderCircle} label="Proses" value={overall.inProgressTeachers} />
            <StatLine icon={CircleDashed} label="Belum diperiksa" value={overall.unreviewedTeachers} />
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
        {aggregates.map((aggregate) => (
          <Card key={aggregate.id}>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="flex items-start gap-4">
                <RadialProgress
                  value={aggregate.percent}
                  label={`BK${aggregate.number}`}
                  size={92}
                  thickness={9}
                />
                <div className="min-w-0 flex-1 space-y-1 pt-1">
                  <p className="flex items-center gap-1.5 font-semibold text-foreground">
                    <BookMarked className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate">{aggregate.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {aggregate.itemCount} komponen · bobot {aggregate.weight}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Rata-rata kelengkapan {formatPercent(aggregate.percent)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <DistributionBar
                  complete={aggregate.completeTeachers}
                  inProgress={aggregate.inProgressTeachers}
                  unreviewed={aggregate.unreviewedTeachers}
                  label={aggregate.name}
                />
                <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary" aria-hidden />
                    Lengkap {aggregate.completeTeachers}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: "color-mix(in oklab, var(--primary) 42%, transparent)" }}
                      aria-hidden
                    />
                    Proses {aggregate.inProgressTeachers}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-muted ring-1 ring-border" aria-hidden />
                    Belum {aggregate.unreviewedTeachers}
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
