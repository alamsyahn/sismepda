import { ListChecks, Clock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ClassRecord } from "@/lib/dashboard-data"

export function ClassProgress({ records }: { records: ClassRecord[] }) {
  const groups = (["VII", "VIII", "IX"] as const)
    .map((grade) => ({ grade, records: records.filter((record) => record.grade === grade) }))
    .filter((group) => group.records.length > 0)
  const gridColumns = groups.length === 1 ? "md:grid-cols-1" : groups.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4 text-primary" />
          Progress Input per Kelas
        </CardTitle>
        <CardDescription>Persentase siswa yang sudah tercatat kehadirannya</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`grid grid-cols-1 gap-x-8 gap-y-6 ${gridColumns}`}>
          {groups.map((group) => (
            <section key={group.grade} className="space-y-3.5">
              <h3 className="text-sm font-semibold text-foreground">Kelas {group.grade}</h3>
              <ul className="space-y-3.5">
                {group.records.map((c) => {
                  const recorded = c.submitted ? c.hadir + c.sakit + c.izin + c.alfa + c.dispensasi : 0
                  const pct = c.totalStudents > 0 ? Math.round((recorded / c.totalStudents) * 100) : 0
                  const barColor = c.submitted ? "var(--chart-1)" : "var(--chart-5)"
                  return (
                    <li key={c.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-foreground">{c.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {c.submitted ? <span className="tabular-nums">{c.submittedAt} WIB</span> : <span className="flex items-center gap-1 font-medium text-[var(--chart-5)]"><Clock className="size-3" />Menunggu</span>}
                          <span className="font-semibold text-foreground tabular-nums">{pct}%</span>
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
