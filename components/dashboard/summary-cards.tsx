import { School, CheckCircle2, Clock3, UserCheck, TrendingUp, TrendingDown } from "lucide-react"
import { Card } from "@/components/ui/card"
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
  const cards = [
    {
      label: "Total Kelas",
      value: totalClasses,
      caption: `${totalStudentsAll} siswa terdaftar`,
      icon: School,
      gradient: "from-[var(--chart-3)]/15 to-[var(--chart-3)]/5",
      iconBg: "bg-[var(--chart-3)]/15 text-[var(--chart-3)]",
    },
    {
      label: "Sudah Input",
      value: submittedCount,
      caption: `${totalClasses > 0 ? Math.round((submittedCount / totalClasses) * 100) : 0}% kelas selesai`,
      icon: CheckCircle2,
      gradient: "from-[var(--chart-1)]/15 to-[var(--chart-1)]/5",
      iconBg: "bg-[var(--chart-1)]/15 text-[var(--chart-1)]",
      trend: submittedCount > 0 ? { dir: onTimeCount === submittedCount ? "up" as const : "down" as const, text: `${onTimeCount}/${submittedCount} tepat waktu` } : undefined,
    },
    {
      label: "Belum Input",
      value: notSubmittedCount,
      caption: notSubmittedCount > 0 ? "Perlu tindak lanjut" : "Semua kelas selesai",
      icon: Clock3,
      gradient: "from-[var(--chart-5)]/15 to-[var(--chart-5)]/5",
      iconBg: "bg-[var(--chart-5)]/15 text-[var(--chart-5)]",
      trend: notSubmittedCount > 0 ? { dir: "down" as const, text: "menunggu" } : undefined,
    },
    {
      label: "Tingkat Kehadiran",
      value: `${attendanceRate}%`,
      caption: "Dari kelas yang sudah input",
      icon: UserCheck,
      gradient: "from-[var(--chart-2)]/15 to-[var(--chart-2)]/5",
      iconBg: "bg-[var(--chart-2)]/15 text-[var(--chart-2)]",
      trend: attendanceDelta === null ? undefined : { dir: attendanceDelta >= 0 ? "up" as const : "down" as const, text: `${attendanceDelta > 0 ? "+" : ""}${attendanceDelta}% vs hari masuk sebelumnya` },
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        const TrendIcon = card.trend?.dir === "up" ? TrendingUp : TrendingDown
        return (
          <Card
            key={card.label}
            className={cn(
              "relative overflow-hidden border-border/60 bg-gradient-to-br p-5 shadow-sm transition-shadow hover:shadow-md",
              card.gradient,
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                  {card.value}
                </p>
              </div>
              <span className={cn("flex size-11 items-center justify-center rounded-2xl", card.iconBg)}>
                <Icon className="size-5" />
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {card.trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    card.trend.dir === "up"
                      ? "bg-[var(--chart-1)]/15 text-[var(--chart-1)]"
                      : "bg-[var(--chart-5)]/15 text-[var(--chart-5)]",
                  )}
                >
                  <TrendIcon className="size-3" />
                  {card.trend.text}
                </span>
              )}
              <p className="text-xs text-muted-foreground">{card.caption}</p>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
