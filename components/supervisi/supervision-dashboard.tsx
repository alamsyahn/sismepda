"use client"

import { BookCheck, CircleDashed, Link2Off, ListChecks, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPercent, progressColor } from "@/lib/workbook"
import type { SupervisionOverview } from "@/lib/server-workbook"

export function SupervisionDashboard({
  overall,
  aggregates,
}: {
  overall: SupervisionOverview["overall"]
  aggregates: SupervisionOverview["aggregates"]
}) {
  const stats = [
    {
      label: "Guru Disupervisi",
      value: overall.teacherCount,
      caption: "Peserta aktif dalam cakupan",
      icon: Users,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Sudah Lengkap",
      value: overall.completeTeachers,
      caption: `${formatPercent(overall.percent)} kelengkapan sekolah`,
      icon: BookCheck,
      tone: "bg-success/10 text-success-foreground",
    },
    {
      label: "Dalam Proses",
      value: overall.inProgressTeachers,
      caption: "Masih ada komponen yang perlu dilengkapi",
      icon: ListChecks,
      tone: "bg-info/10 text-info-foreground",
    },
    {
      label: "Belum Diperiksa",
      value: overall.unreviewedTeachers,
      caption: `${overall.missingLinkTeachers} guru belum melengkapi tautan`,
      icon: overall.missingLinkTeachers > 0 ? Link2Off : CircleDashed,
      tone: "bg-danger/10 text-danger-foreground",
    },
  ]

  return (
    <div className="space-y-5">
      <dl className="grid overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon
          return (
            <div
              key={stat.label}
              className={cn(
                "p-4 sm:p-5",
                index > 0 && "border-t border-border/70 sm:border-t-0",
                index % 2 === 1 && "sm:border-l",
                index >= 2 && "sm:border-t xl:border-t-0",
                index > 0 && "xl:border-l",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <dt className="text-sm font-medium text-muted-foreground">{stat.label}</dt>
                  <dd className="text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-3xl">
                    {stat.value}
                  </dd>
                </div>
                <span className={cn("flex size-10 items-center justify-center rounded-xl", stat.tone)} aria-hidden>
                  <Icon className="size-5" />
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{stat.caption}</p>
            </div>
          )
        })}
      </dl>

      <section aria-labelledby="workbook-comparison-title" className="space-y-3">
        <div>
          <h2 id="workbook-comparison-title" className="text-lg font-semibold tracking-tight text-foreground">
            Kelengkapan per buku kerja
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bandingkan cakupan pemeriksaan dan temukan buku kerja yang paling membutuhkan perhatian.
          </p>
        </div>
        <div className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-4">
          {aggregates.map((aggregate) => (
            <article key={aggregate.id} className="bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{aggregate.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {aggregate.itemCount} komponen · bobot {aggregate.weight}%
                  </p>
                </div>
                <span className="text-lg font-semibold text-foreground tabular-nums">
                  {formatPercent(aggregate.percent)}
                </span>
              </div>
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`Kelengkapan ${aggregate.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={aggregate.percent}
              >
                <div
                  className="h-full rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-700 motion-safe:ease-out"
                  style={{ width: `${aggregate.percent}%`, backgroundColor: progressColor(aggregate.percent) }}
                />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Lengkap</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{aggregate.completeTeachers}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Proses</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{aggregate.inProgressTeachers}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Belum</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{aggregate.unreviewedTeachers}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
