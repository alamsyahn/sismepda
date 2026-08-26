import { PencilLine, PlusCircle, Bell, History } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { ActivityItem } from "@/lib/dashboard-data"

const typeMeta = {
  input: { icon: PlusCircle, className: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]" },
  edit: { icon: PencilLine, className: "bg-[var(--chart-2)]/12 text-[var(--chart-2)]" },
  reminder: { icon: Bell, className: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" },
}

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" />
          Aktivitas Terbaru
        </CardTitle>
        <CardDescription>Riwayat penyimpanan absensi pada tanggal dipilih</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const meta = typeMeta[item.type]
            const Icon = meta.icon
            return (
              <li
                key={item.id}
                className="flex gap-3 rounded-xl border border-border/60 bg-secondary/40 p-3"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    meta.className,
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground text-pretty">
                    <span className="font-semibold">{item.teacher}</span> {item.action}{" "}
                    <span className="font-medium text-primary">{item.className}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {item.time} WIB
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
