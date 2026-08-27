import { CheckCircle2, Clock3, School, TrendingDown, TrendingUp, UserCheck } from "lucide-react"
import { cn } from "@/lib/utils"

type SummaryCardsProps = {
  totalClasses: number
  submittedCount: number
  notSubmittedCount: number
  attendanceRate: number
  totalStudentsAll: number
  onTimeCount: number
  attendanceDelta: number | null
}

export function SummaryCards({
  totalClasses,
  submittedCount,
  notSubmittedCount,
  attendanceRate,
  totalStudentsAll,
  onTimeCount,
  attendanceDelta,
}: SummaryCardsProps) {
  const stats = [
    {
      label: "Total Kelas",
      value: totalClasses,
      caption: `${totalStudentsAll} siswa terdaftar`,
      icon: School,
      iconTone: "bg-primary/10 text-primary",
    },
    {
      label: "Sudah Input",
      value: submittedCount,
      caption: `${totalClasses > 0 ? Math.round((submittedCount / totalClasses) * 100) : 0}% kelas selesai`,
      icon: CheckCircle2,
      iconTone: "bg-success/10 text-success-foreground",
      trend: submittedCount > 0
        ? { direction: onTimeCount === submittedCount ? "up" as const : "down" as const, text: `${onTimeCount}/${submittedCount} tepat waktu` }
        : undefined,
    },
    {
      label: "Belum Input",
      value: notSubmittedCount,
      caption: notSubmittedCount > 0 ? "Perlu tindak lanjut" : "Semua kelas selesai",
      icon: Clock3,
      iconTone: "bg-danger/10 text-danger-foreground",
      trend: notSubmittedCount > 0 ? { direction: "down" as const, text: "menunggu" } : undefined,
    },
    {
      label: "Tingkat Kehadiran",
      value: `${attendanceRate}%`,
      caption: "Dari kelas yang sudah input",
      icon: UserCheck,
      iconTone: "bg-info/10 text-info-foreground",
      trend: submittedCount === 0 || attendanceDelta === null
        ? undefined
        : {
            direction: attendanceDelta >= 0 ? "up" as const : "down" as const,
            text: `${attendanceDelta > 0 ? "+" : ""}${attendanceDelta}% dibanding hari masuk sebelumnya`,
          },
    },
  ]

  return (
    <dl className="grid overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon
        const TrendIcon = stat.trend?.direction === "up" ? TrendingUp : TrendingDown

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
              <span className={cn("flex size-10 items-center justify-center rounded-xl", stat.iconTone)} aria-hidden>
                <Icon className="size-5" />
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {stat.trend ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    stat.trend.direction === "up"
                      ? "bg-success/10 text-success-foreground"
                      : "bg-danger/10 text-danger-foreground",
                  )}
                >
                  <TrendIcon className="size-3" />
                  {stat.trend.text}
                </span>
              ) : null}
              <p className="text-xs text-muted-foreground">{stat.caption}</p>
            </div>
          </div>
        )
      })}
    </dl>
  )
}
